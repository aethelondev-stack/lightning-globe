import type { Plugin, ViteDevServer } from 'vite';

export interface RegionalStrike {
  id: string;
  lat: number;
  lon: number;
  time: number;
  source: 'singapore_nea' | 'japan_jma' | 'finland_fmi';
  peakCurrent?: number;
  type?: 'CG' | 'IC';
}

/**
 * viteRegionalFeedsPlugin: Ingests real-time lightning strike observations
 * from three verified zero-registration public government APIs:
 * 1. Singapore NEA (Meteorological Service Singapore) - Data.gov.sg (2-min cadence)
 * 2. Japan Meteorological Agency (JMA) LIDEN Network (5-min cadence)
 * 3. Finland Finnish Meteorological Institute (FMI) NORDLIS WFS (1-min cadence)
 *
 * Provides real ground-network coverage for Southeast Asia, East Asia/Japan, and Arctic/Northern Europe.
 */
export function viteRegionalFeedsPlugin(): Plugin {
  const cachedSingapore: RegionalStrike[] = [];
  const cachedJapan: RegionalStrike[] = [];
  const cachedFinland: RegionalStrike[] = [];

  const processedIds = new Set<string>();

  let singaporeStatus: 'LIVE' | 'STALE' | 'OFFLINE' = 'OFFLINE';
  let japanStatus: 'LIVE' | 'STALE' | 'OFFLINE' = 'OFFLINE';
  let finlandStatus: 'LIVE' | 'STALE' | 'OFFLINE' = 'OFFLINE';

  // --- 1. Singapore NEA Ingestion ---
  async function pollSingapore(): Promise<void> {
    try {
      const res = await fetch('https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) {
        singaporeStatus = 'STALE';
        return;
      }
      const data = await res.json();
      const records = data?.data?.records || [];
      if (!records || records.length === 0) return;

      const latestRecord = records[0];
      const readings = latestRecord?.item?.readings || [];
      const obsTimeStr = latestRecord?.datetime || latestRecord?.updatedTimestamp;
      const recordTime = obsTimeStr ? new Date(obsTimeStr).getTime() : Date.now();

      for (let i = 0; i < readings.length; i++) {
        const r = readings[i];
        const lat = typeof r.location?.latitude === 'number' ? r.location.latitude : (typeof r.latitude === 'number' ? r.latitude : null);
        const lon = typeof r.location?.longitude === 'number' ? r.location.longitude : (typeof r.longitude === 'number' ? r.longitude : null);
        if (lat === null || lon === null) continue;

        const strikeTime = r.datetime ? new Date(r.datetime).getTime() : recordTime;
        const id = `nea_${lat.toFixed(3)}_${lon.toFixed(3)}_${strikeTime}`;

        if (!processedIds.has(id)) {
          processedIds.add(id);
          const strikeType: 'CG' | 'IC' = r.type === 'C' ? 'IC' : 'CG';
          cachedSingapore.push({
            id,
            lat,
            lon,
            time: strikeTime,
            source: 'singapore_nea',
            type: strikeType,
            peakCurrent: strikeType === 'CG' ? 30 : 15
          });
        }
      }

      // Maintain buffer size
      if (cachedSingapore.length > 500) cachedSingapore.splice(0, cachedSingapore.length - 500);
      singaporeStatus = 'LIVE';
    } catch {
      singaporeStatus = 'STALE';
    }
  }

  // --- 2. Japan JMA LIDEN Ingestion ---
  async function pollJapan(): Promise<void> {
    try {
      const timesRes = await fetch('https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N3.json', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!timesRes.ok) {
        japanStatus = 'STALE';
        return;
      }
      const times = await timesRes.json();
      if (!Array.isArray(times) || times.length === 0) return;

      // Find the most recent target time that includes 'liden' and is an observation (basetime === validtime)
      const target = times.find(
        (t: any) => t.elements && t.elements.some((e: string) => e.includes('liden')) && t.basetime === t.validtime
      ) || times[0];

      if (!target?.basetime || !target?.validtime) return;

      const geojsonUrl = `https://www.jma.go.jp/bosai/jmatile/data/nowc/${target.basetime}/none/${target.validtime}/surf/liden/data.geojson?id=liden`;
      const geoRes = await fetch(geojsonUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });

      if (!geoRes.ok) {
        japanStatus = 'STALE';
        return;
      }

      const geoData = await geoRes.json();
      const features = geoData?.features || [];

      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;
        const [lon, lat] = coords;

        const tStr = f.properties?.obstimeJST || target.validtime;
        let strikeTime = Date.now();
        if (typeof tStr === 'string' && tStr.length >= 14) {
          const clean = tStr.replace(/[^\d]/g, '');
          if (clean.length >= 14) {
            const yr = parseInt(clean.slice(0, 4), 10);
            const mo = parseInt(clean.slice(4, 6), 10) - 1;
            const da = parseInt(clean.slice(6, 8), 10);
            const hr = parseInt(clean.slice(8, 10), 10);
            const mi = parseInt(clean.slice(10, 12), 10);
            const se = parseInt(clean.slice(12, 14), 10);
            strikeTime = Date.UTC(yr, mo, da, hr - 9, mi, se);
          }
        }

        const fid = f.properties?.id || `jma_${lat.toFixed(3)}_${lon.toFixed(3)}_${strikeTime}`;
        if (!processedIds.has(fid)) {
          processedIds.add(fid);
          // LIDEN type: 1 = CG, 2 = CC/IC
          const typeCode = f.properties?.type;
          const strikeType: 'CG' | 'IC' = typeCode === 2 ? 'IC' : 'CG';
          cachedJapan.push({
            id: fid,
            lat,
            lon,
            time: strikeTime,
            source: 'japan_jma',
            type: strikeType,
            peakCurrent: strikeType === 'CG' ? 35 : 18
          });
        }
      }

      if (cachedJapan.length > 500) cachedJapan.splice(0, cachedJapan.length - 500);
      japanStatus = 'LIVE';
    } catch {
      japanStatus = 'STALE';
    }
  }

  // --- 3. Finland FMI WFS Ingestion ---
  async function pollFinland(): Promise<void> {
    try {
      const now = new Date();
      const start = new Date(Date.now() - 30 * 60 * 1000); // last 30 minutes
      const url = `https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::lightning::simple&starttime=${start.toISOString()}&endtime=${now.toISOString()}`;

      const res = await fetch(url, {
        headers: { Accept: 'application/xml, text/xml' },
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        finlandStatus = 'STALE';
        return;
      }

      const xmlText = await res.text();
      const strokeMap = new Map<string, { lat: number; lon: number; time: number; peakCurrent: number; isCloud: boolean }>();

      const elementRegex = /<BsWfs:BsWfsElement\s+gml:id=["']BsWfsElement\.(\d+)\.\d+["']>([\s\S]*?)<\/BsWfs:BsWfsElement>/g;
      let match: RegExpExecArray | null;
      while ((match = elementRegex.exec(xmlText)) !== null) {
        const strokeId = match[1];
        const body = match[2];

        if (!strokeMap.has(strokeId)) {
          const posMatch = body.match(/<gml:pos>\s*([-\d.]+)\s+([-\d.]+)\s*<\/gml:pos>/);
          const timeMatch = body.match(/<BsWfs:Time>\s*([^\s<]+)\s*<\/BsWfs:Time>/);
          if (posMatch && timeMatch) {
            strokeMap.set(strokeId, {
              lat: parseFloat(posMatch[1]),
              lon: parseFloat(posMatch[2]),
              time: new Date(timeMatch[1]).getTime(),
              peakCurrent: 25,
              isCloud: false
            });
          }
        }

        const pNameMatch = body.match(/<BsWfs:ParameterName>\s*([^\s<]+)\s*<\/BsWfs:ParameterName>/);
        const pValMatch = body.match(/<BsWfs:ParameterValue>\s*([^\s<]+)\s*<\/BsWfs:ParameterValue>/);
        if (pNameMatch && pValMatch && strokeMap.has(strokeId)) {
          const entry = strokeMap.get(strokeId)!;
          const val = parseFloat(pValMatch[1]);
          if (pNameMatch[1] === 'peak_current' && !isNaN(val)) {
            entry.peakCurrent = Math.abs(val);
          }
          if (pNameMatch[1] === 'cloud_indicator' && !isNaN(val)) {
            entry.isCloud = Math.round(val) === 1;
          }
        }
      }

      for (const [strokeId, s] of strokeMap.entries()) {
        const fid = `fmi_${strokeId}_${s.time}`;
        if (!processedIds.has(fid)) {
          processedIds.add(fid);
          cachedFinland.push({
            id: fid,
            lat: s.lat,
            lon: s.lon,
            time: s.time,
            source: 'finland_fmi',
            type: s.isCloud ? 'IC' : 'CG',
            peakCurrent: s.peakCurrent
          });
        }
      }

      if (cachedFinland.length > 500) cachedFinland.splice(0, cachedFinland.length - 500);
      finlandStatus = 'LIVE';
    } catch {
      finlandStatus = 'STALE';
    }
  }

  async function pollAllRegional(): Promise<void> {
    await Promise.allSettled([
      pollSingapore(),
      pollJapan(),
      pollFinland()
    ]);

    if (processedIds.size > 20000) {
      processedIds.clear();
    }
  }

  return {
    name: 'vite-plugin-regional-feeds',
    configureServer(server: ViteDevServer) {
      // Run first poll on startup
      pollAllRegional().catch(console.error);

      // Poll regional feeds every 60 seconds
      setInterval(() => {
        pollAllRegional().catch(console.error);
      }, 60000);

      server.middlewares.use('/api/regional/latest', (req, res) => {
        const url = new URL(req.url || '', 'http://localhost');
        const sourceFilter = url.searchParams.get('source');
        const sinceStr = url.searchParams.get('since');
        const since = sinceStr ? parseInt(sinceStr, 10) : 0;

        let allStrikes: RegionalStrike[] = [];
        if (sourceFilter === 'singapore_nea') {
          allStrikes = cachedSingapore;
        } else if (sourceFilter === 'japan_jma') {
          allStrikes = cachedJapan;
        } else if (sourceFilter === 'finland_fmi') {
          allStrikes = cachedFinland;
        } else {
          // Combined regional feeds
          allStrikes = [...cachedSingapore, ...cachedJapan, ...cachedFinland];
        }

        allStrikes.sort((a, b) => a.time - b.time);

        let resultStrikes = allStrikes;
        if (since > 0) {
          resultStrikes = allStrikes.filter((s) => s.time > since);
        } else {
          // Cold-Start Smoothing: cap initial slice to 30 most recent strikes
          resultStrikes = allStrikes.slice(-30);
        }

        const payload = {
          provider: 'Regional Ground Networks (Singapore NEA, Japan JMA, Finland FMI)',
          timestamp: Date.now(),
          sources: {
            singapore: { count: cachedSingapore.length, status: singaporeStatus },
            japan: { count: cachedJapan.length, status: japanStatus },
            finland: { count: cachedFinland.length, status: finlandStatus }
          },
          count: resultStrikes.length,
          strikes: resultStrikes
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(JSON.stringify(payload));
      });

      console.log('🌏 [REGIONAL FEEDS] Open Regional Feeds API mounted at /api/regional/latest');
    }
  };
}
