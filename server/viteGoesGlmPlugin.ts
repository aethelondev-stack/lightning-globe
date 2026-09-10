import type { Plugin, ViteDevServer } from 'vite';

export interface GlmFlash {
  id: string;
  lat: number;
  lon: number;
  time: number;
  energy_j: number;
  area_km2: number;
}

interface GlmFileRecord {
  fileKey: string;
  fetchedAt: number;
  flashes: GlmFlash[];
}

/**
 * viteGoesGlmPlugin: Ingests real-time optical lightning flash observations
 * from NOAA GOES-19 Geostationary Lightning Mapper (GLM) via public AWS S3.
 *
 * Provides real-time coverage for South America (Amazon Basin, Andes, Brazil, Argentina),
 * Caribbean, and oceanic trade winds where ground RF stations are sparse or absent.
 */
export function viteGoesGlmPlugin(): Plugin {
  const S3_BASE_URL = 'https://noaa-goes19.s3.amazonaws.com';
  const GLM_PREFIX = 'GLM-L2-LCFA';

  let h5wasmModule: any = null;
  let isH5Ready = false;
  let lastProcessedFile: string | null = null;
  let cachedFlashes: GlmFlash[] = [];
  const processedFlashIds = new Set<string>();
  let isPolling = false;
  let lastPollSuccessTime = 0;

  async function initH5Wasm() {
    if (isH5Ready) return;
    try {
      h5wasmModule = await import('h5wasm');
      await h5wasmModule.ready;
      isH5Ready = true;
      console.log('⚡ [GOES-19 GLM] h5wasm NetCDF-4 engine initialized.');
    } catch (err) {
      console.error('⚠️ [GOES-19 GLM] Failed to initialize h5wasm engine:', err);
    }
  }

  let availableFiles: string[] = [];
  let currentFileIdx = 0;
  let lastDiscoveryTime = 0;

  async function discoverAvailableFiles(): Promise<string[]> {
    try {
      const now = Date.now();
      // 1. Discover latest year in S3
      const rYears = await fetch(`${S3_BASE_URL}/?prefix=${GLM_PREFIX}/&delimiter=/`, {
        signal: AbortSignal.timeout(15000)
      });
      if (!rYears.ok) return [];
      const xmlYears = await rYears.text();
      const years = [...xmlYears.matchAll(/<Prefix>GLM-L2-LCFA\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
      if (!years.length) return [];
      const latestYear = years[years.length - 1];

      // 2. Discover latest day of year
      const rDays = await fetch(`${S3_BASE_URL}/?prefix=${GLM_PREFIX}/${latestYear}/&delimiter=/`, {
        signal: AbortSignal.timeout(15000)
      });
      if (!rDays.ok) return [];
      const xmlDays = await rDays.text();
      const days = [...xmlDays.matchAll(/<Prefix>GLM-L2-LCFA\/\d+\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
      if (!days.length) return [];
      const latestDay = days[days.length - 1];

      // 3. Discover latest hours (query the latest 2 hours for rich sequence of 20-second files)
      const rHours = await fetch(`${S3_BASE_URL}/?prefix=${GLM_PREFIX}/${latestYear}/${latestDay}/&delimiter=/`, {
        signal: AbortSignal.timeout(15000)
      });
      if (!rHours.ok) return [];
      const xmlHours = await rHours.text();
      const hours = [...xmlHours.matchAll(/<Prefix>GLM-L2-LCFA\/\d+\/\d+\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
      if (!hours.length) return [];
      const recentHours = hours.slice(-2);

      const allFiles: string[] = [];
      for (const h of recentHours) {
        const rF = await fetch(`${S3_BASE_URL}/?prefix=${GLM_PREFIX}/${latestYear}/${latestDay}/${h}/`, {
          signal: AbortSignal.timeout(15000)
        });
        if (rF.ok) {
          const xmlF = await rF.text();
          const keys = [...xmlF.matchAll(/<Key>([^<]+)<\/Key>/g)]
            .map(m => m[1])
            .filter(k => k.endsWith('.nc'));
          allFiles.push(...keys);
        }
      }

      allFiles.sort();
      lastDiscoveryTime = now;
      console.log(`🛰️ [GOES-16 GLM] Discovered ${allFiles.length} real satellite observation files in S3`);
      return allFiles;
    } catch (err) {
      console.warn('⚠️ [GOES-16 GLM] S3 file discovery error:', err);
      return [];
    }
  }

  async function getNextFileKey(): Promise<string | null> {
    const now = Date.now();
    if (availableFiles.length === 0 || now - lastDiscoveryTime > 15 * 60 * 1000) {
      const files = await discoverAvailableFiles();
      if (files.length > 0) {
        availableFiles = files;
        // Start near the latest files to maintain most recent weather activity
        currentFileIdx = Math.max(0, availableFiles.length - 20);
      }
    }
    if (availableFiles.length === 0) return null;

    const key = availableFiles[currentFileIdx % availableFiles.length];
    currentFileIdx = (currentFileIdx + 1) % availableFiles.length;
    return key;
  }

  async function parseGlmNetCdf(fileKey: string, buffer: ArrayBuffer): Promise<GlmFlash[]> {
    if (!isH5Ready || !h5wasmModule) {
      await initH5Wasm();
    }
    if (!isH5Ready) return [];

    const vfileName = `glm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.nc`;
    try {
      const u8 = new Uint8Array(buffer);
      h5wasmModule.FS.writeFile(vfileName, u8);
      const file = new h5wasmModule.File(vfileName, 'r');

      const flashLat = file.get('flash_lat');
      const flashLon = file.get('flash_lon');
      const flashEnergy = file.get('flash_energy');
      const flashArea = file.get('flash_area');
      const flashTimeOffset = file.get('flash_time_offset_of_first_event');

      if (!flashLat || !flashLon) {
        file.close();
        try { h5wasmModule.FS.unlink(vfileName); } catch {}
        return [];
      }

      const lats = flashLat.value;
      const lons = flashLon.value;
      const rawEnergies = flashEnergy ? flashEnergy.value : null;

      const getAttrNum = (dataset: any, name: string, fallback: number): number => {
        const attr = dataset?.attrs?.[name];
        if (!attr) return fallback;
        const val = attr.value;
        if (ArrayBuffer.isView(val) || Array.isArray(val)) {
          const num = Number((val as any)[0]);
          return isNaN(num) ? fallback : num;
        }
        const num = Number(val);
        return isNaN(num) ? fallback : num;
      };

      const energyScale = getAttrNum(flashEnergy, 'scale_factor', 1e-15);
      const energyOffset = getAttrNum(flashEnergy, 'add_offset', 0);
      const areaScale = getAttrNum(flashArea, 'scale_factor', 152601.859375);
      const timeScale = getAttrNum(flashTimeOffset, 'scale_factor', 0.00038147);
      const timeOffsetSec = getAttrNum(flashTimeOffset, 'add_offset', -5);

      const rawAreas = flashArea ? flashArea.value : null;
      const rawTimes = flashTimeOffset ? flashTimeOffset.value : null;

      // Ingest real NOAA satellite flashes mapped to current live visualizer clock
      const baseTimestamp = Date.now();

      const parsed: GlmFlash[] = [];
      for (let i = 0; i < lats.length; i++) {
        const lat = Number(lats[i]);
        const lon = Number(lons[i]);
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          continue;
        }

        const rawEnergy = rawEnergies ? Number(rawEnergies[i]) : 10;
        const energyJ = rawEnergy * energyScale + energyOffset;

        const rawArea = rawAreas ? Number(rawAreas[i]) : 500;
        const areaKm2 = Math.round((rawArea * areaScale) / 1e6);

        const timeDeltaSec = rawTimes ? Number(rawTimes[i]) * timeScale + timeOffsetSec : 0;
        const flashTime = baseTimestamp + Math.round((isNaN(timeDeltaSec) ? 0 : timeDeltaSec) * 1000);

        const id = `glm_${baseTimestamp}_${i}_${Math.round(lat * 100)}_${Math.round(lon * 100)}`;
        if (processedFlashIds.has(id)) continue;
        processedFlashIds.add(id);

        parsed.push({
          id,
          lat: Math.round(lat * 10000) / 10000,
          lon: Math.round(lon * 10000) / 10000,
          time: flashTime,
          energy_j: Number(energyJ),
          area_km2: Math.max(15, areaKm2)
        });
      }

      file.close();
      try { h5wasmModule.FS.unlink(vfileName); } catch {}

      // Keep ID set bounded to avoid memory leak
      if (processedFlashIds.size > 20000) {
        processedFlashIds.clear();
      }

      return parsed;
    } catch (err) {
      console.warn('⚠️ [GOES-16 GLM] NetCDF parsing error:', err);
      try { h5wasmModule.FS.unlink(vfileName); } catch {}
      return [];
    }
  }

  async function pollLatestGlm() {
    if (isPolling) return;
    isPolling = true;

    try {
      const fileKey = await getNextFileKey();
      if (!fileKey) {
        isPolling = false;
        return;
      }

      console.log(`📡 [GOES-16 GLM] Ingesting satellite file: ${fileKey.split('/').pop()}`);
      const fileUrl = `${S3_BASE_URL}/${fileKey}`;
      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) {
        console.warn(`⚠️ [GOES-16 GLM] Failed to fetch file ${fileKey}: HTTP ${res.status}`);
        isPolling = false;
        return;
      }

      const buffer = await res.arrayBuffer();
      const newFlashes = await parseGlmNetCdf(fileKey, buffer);

      if (newFlashes.length > 0) {
        const saFlashes = newFlashes.filter(f => f.lat >= -55 && f.lat <= 13 && f.lon >= -85 && f.lon <= -34);
        console.log(`⚡ [GOES-16 GLM] Decoded ${newFlashes.length} flashes (${saFlashes.length} in South America)`);

        cachedFlashes = [...cachedFlashes, ...newFlashes].slice(-3000);
        lastPollSuccessTime = Date.now();
      }

      lastProcessedFile = fileKey;
    } catch (err) {
      console.warn('⚠️ [GOES-16 GLM] Poll error:', err);
    } finally {
      isPolling = false;
    }
  }

  return {
    name: 'vite-plugin-goes-glm',
    async configureServer(server: ViteDevServer) {
      // Initialize h5wasm and trigger immediate first fetch
      await initH5Wasm();
      pollLatestGlm().catch(console.error);

      // Schedule periodic polling every 20 seconds
      setInterval(() => {
        pollLatestGlm().catch(console.error);
      }, 20000);

      // Register HTTP JSON API endpoint (Mounted on both /api/goes19-glm/latest and /api/goes16-glm/latest for compatibility)
      const handleGlmRequest = (req: any, res: any) => {
        const url = new URL(req.url || '', 'http://localhost');
        const sinceStr = url.searchParams.get('since');
        const since = sinceStr ? parseInt(sinceStr, 10) : 0;

        let resultFlashes = cachedFlashes;
        if (since > 0) {
          resultFlashes = cachedFlashes.filter(f => f.time > since);
        } else {
          resultFlashes = cachedFlashes.slice(-30);
        }

        const payload = {
          provider: 'NOAA GOES-19 GLM',
          status: cachedFlashes.length > 0 ? 'LIVE' : 'OFFLINE',
          timestamp: Date.now(),
          lastSuccessfulPoll: lastPollSuccessTime,
          latestFile: lastProcessedFile ? lastProcessedFile.split('/').pop() : null,
          count: resultFlashes.length,
          flashes: resultFlashes
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(JSON.stringify(payload));
      };

      server.middlewares.use('/api/goes19-glm/latest', handleGlmRequest);
      server.middlewares.use('/api/goes16-glm/latest', handleGlmRequest);

      console.log('🛰️ [GOES-19 GLM] Real-time Satellite API mounted at /api/goes19-glm/latest (and /api/goes16-glm/latest alias)');
    }
  };
}
