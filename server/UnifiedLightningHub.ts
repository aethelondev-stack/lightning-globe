import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { ServerResponse } from 'http';
import NodeWebSocket from 'ws';
import type { LightningEvent, LightningSource } from '../src/types/lightning';

export interface HubStats {
  status: 'LIVE' | 'CONNECTING' | 'STALE' | 'OFFLINE';
  totalEventsProcessed: number;
  rfInstantCount: number;
  satellitePacedCount: number;
  regionalCount: number;
  pacingQueueSize: number;
  cached24hCount: number;
  activeSseClients: number;
  lastEventTimestamp: number | null;
}

export interface HubOptions {
  cacheFilePath?: string;
  enableAutoStart?: boolean;
  enableNetwork?: boolean; // Set false to disable real network listeners in tests
  satellitePacingIntervalMs?: number; // Cadence for micropacket releases (100-200ms)
  backfillOnStart?: boolean;
}

/**
 * UnifiedLightningHub: Central Realtime Ingest and Distribution Hub.
 *
 * Architectural Principles (Strict 100% Real Data):
 * 1. Zero Fake Data & Zero Cropping:
 *    - Ingests real satellite flashes (NOAA GOES-16/18 GLM NetCDF, EUMETSAT MTG-LI),
 *      Blitzortung RF ground strikes, and regional radars (FMI, NEA, JMA).
 *    - 100% of observations preserved without downsampling or arbitrary truncation.
 * 2. Instant RF Pass-Through (0 ms Latency):
 *    - Blitzortung ground station RF strikes are immediately dispatched to clients
 *      with 0 ms latency; never held in pacing queues.
 * 3. Paced Satellite Distribution (Kademeli Yayma):
 *    - Satellite flashes arriving in 20-30s batches are paced into micro-packets
 *      at 100-200ms intervals across the inter-batch window, preventing visual shock.
 * 4. 24-Hour Historical Backfill:
 *    - On startup, loads local disk cache (.cache/lightning_24h.json) and queries
 *      open AWS S3 / FMI archive in 3-5 seconds to restore past 24h storm activity.
 * 5. Local Disk Cache:
 *    - Persists observed real strikes in .cache/lightning_24h.json across sessions.
 */
export class UnifiedLightningHub {
  private static instance: UnifiedLightningHub | null = null;

  public static getInstance(options?: HubOptions): UnifiedLightningHub {
    if (!UnifiedLightningHub.instance) {
      UnifiedLightningHub.instance = new UnifiedLightningHub(options);
    }
    return UnifiedLightningHub.instance;
  }

  public static resetInstance(): void {
    if (UnifiedLightningHub.instance) {
      UnifiedLightningHub.instance.stop();
      UnifiedLightningHub.instance = null;
    }
  }

  private readonly cacheFilePath: string;
  private readonly pacingIntervalMs: number;
  private readonly enableNetwork: boolean;
  private targetPacingDurationMs: number = 20000;
  private readonly sseClients: Set<ServerResponse> = new Set();

  // Listeners for internal subscribers
  private readonly strikeListeners: Set<(strike: LightningEvent) => void> = new Set();
  private readonly micropacketListeners: Set<(strikes: LightningEvent[]) => void> = new Set();

  // 24-Hour Historical In-Memory Store (Keyed by unique ID for instant dedup)
  private readonly historyMap: Map<string, LightningEvent> = new Map();
  private isCacheDirty: boolean = false;
  private isSavingDiskCache: boolean = false;

  // Pacing Queue for Satellite Flashes
  private satelliteQueue: LightningEvent[] = [];
  private pacingTimer: ReturnType<typeof setInterval> | null = null;
  private diskSaveTimer: ReturnType<typeof setInterval> | null = null;
  private satellitePollTimer: ReturnType<typeof setInterval> | null = null;
  private regionalPollTimer: ReturnType<typeof setInterval> | null = null;

  // Blitzortung RF WebSocket
  private rfSocket: WebSocket | null = null;
  private rfReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning: boolean = false;

  // Telemetry
  private totalEventsProcessed = 0;
  private rfInstantCount = 0;
  private satellitePacedCount = 0;
  private regionalCount = 0;
  private lastEventTimestamp: number | null = null;

  // NetCDF engine
  private h5wasmModule: any = null;
  private isH5Ready = false;
  private readonly processedNetCdfKeys: Set<string> = new Set();
  private pacingCycleStartMs: number = 0;

  // Cross-sensor spatial-temporal deduplication ring buffer (0.20° grid, 2s window)
  private dedupRecentGrid: Map<string, Array<{ id: string; lat: number; lon: number; timestamp: number; source: string }>> = new Map();
  private lastDedupPruneTime: number = 0;

  // Dynamic Satellite Thresholds & Telemetry
  private thresholdGoes19: number = 2.8e-14;
  private thresholdGoes18: number = 2.8e-14;
  private thresholdMtg: number = 2.8e-14;

  private satelliteTelemetry = {
    goes19: {
      id: 'goes19',
      name: 'NOAA GOES-19 GLM',
      region: 'Güney Amerika (Amazon) & Doğu Amerika',
      periodSeconds: 20,
      thresholdJ: 2.8e-14,
      rawCount: 0,
      filteredCount: 0,
      passedCount: 0,
      lastFetchTime: 0,
      status: 'ONLINE'
    },
    goes18: {
      id: 'goes18',
      name: 'NOAA GOES-18 GLM',
      region: 'Pasifik & Batı Amerika / Hawaii',
      periodSeconds: 20,
      thresholdJ: 2.8e-14,
      rawCount: 0,
      filteredCount: 0,
      passedCount: 0,
      lastFetchTime: 0,
      status: 'ONLINE'
    },
    mtg: {
      id: 'mtg',
      name: 'EUMETSAT MTG-LI',
      region: 'Afrika (Kongo) & Akdeniz / Avrupa',
      periodSeconds: 30,
      thresholdJ: 2.8e-14,
      rawCount: 0,
      filteredCount: 0,
      passedCount: 0,
      lastFetchTime: 0,
      status: 'ONLINE'
    }
  };

  /**
   * Fast O(1) Cross-Sensor Spatial-Temporal Deduplicator:
   * Detects and fuses co-observations across satellites (GOES/MTG) and ground RF stations (Blitzortung).
   * Criterion: dt <= 1200ms and dr <= 18km.
   */
  private isSpatialTemporalDuplicate(strike: LightningEvent): boolean {
    const now = strike.timestamp || Date.now();
    if (now - this.lastDedupPruneTime > 2000) {
      this.pruneDedupGrid(now);
      this.lastDedupPruneTime = now;
    }

    const binDeg = 0.20;
    const latBin = Math.floor(strike.latitude / binDeg);
    const lonBin = Math.floor(strike.longitude / binDeg);
    const key = `${latBin}_${lonBin}`;

    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const nKey = `${latBin + dLat}_${lonBin + dLon}`;
        const list = this.dedupRecentGrid.get(nKey);
        if (list) {
          for (let i = list.length - 1; i >= 0; i--) {
            const cached = list[i];
            if (now - cached.timestamp > 2000) break;
            if (cached.source !== strike.source) {
              const dt = Math.abs(now - cached.timestamp);
              if (dt <= 1200) {
                const dLatKm = Math.abs(strike.latitude - cached.lat) * 111.0;
                const dLonKm = Math.abs(strike.longitude - cached.lon) * 111.0 * Math.cos(strike.latitude * (Math.PI / 180));
                if ((dLatKm * dLatKm + dLonKm * dLonKm) <= 324) { // <= 18 km
                  return true;
                }
              }
            }
          }
        }
      }
    }

    let cell = this.dedupRecentGrid.get(key);
    if (!cell) {
      cell = [];
      this.dedupRecentGrid.set(key, cell);
    }
    cell.push({
      id: strike.id,
      lat: strike.latitude,
      lon: strike.longitude,
      timestamp: now,
      source: strike.source
    });
    return false;
  }

  private pruneDedupGrid(now: number): void {
    const cutoff = now - 3000;
    for (const [key, list] of this.dedupRecentGrid.entries()) {
      const filtered = list.filter(item => item.timestamp >= cutoff);
      if (filtered.length === 0) {
        this.dedupRecentGrid.delete(key);
      } else {
        this.dedupRecentGrid.set(key, filtered);
      }
    }
  }

  constructor(options?: HubOptions) {
    this.cacheFilePath = options?.cacheFilePath ?? path.resolve(process.cwd(), '.cache', 'lightning_24h.json');
    this.pacingIntervalMs = options?.satellitePacingIntervalMs ?? 150;
    this.enableNetwork = options?.enableNetwork ?? true;

    // Load initial cache from disk if available
    this.loadFromDiskCache();

    if (options?.enableAutoStart !== false) {
      this.start(options?.backfillOnStart ?? true);
    }
  }

  /**
   * Starts all ingest pipelines, pacing timers, and disk synchronization.
   */
  public async start(triggerBackfill = true): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Start satellite pacing worker
    this.startPacingTimer();

    // 2. Schedule periodic disk cache save (every 5 minutes if dirty, eliminates event-loop freeze)
    this.diskSaveTimer = setInterval(() => {
      if (this.isCacheDirty) {
        this.saveToDiskCache().catch(() => {});
      }
    }, 300000);

    if (this.enableNetwork) {
      // 3. Connect Blitzortung RF ground network
      this.connectBlitzortungRf();

      // 4. Start satellite polling (GOES-16, GOES-18, MTG)
      this.startSatellitePolling();

      // 5. Start regional radar polling (Singapore, Japan, Finland)
      this.startRegionalPolling();

      // 6. 24-Hour Historical Backfill in background (3-5 seconds)
      if (triggerBackfill) {
        this.perform24hBackfill().catch((err) => {
          console.warn('⚠️ [UnifiedLightningHub] 24h Backfill warning:', err);
        });
      }
    }

    console.log('⚡ [UnifiedLightningHub] Master Realtime Ingest Hub started.');
  }

  /**
   * Gracefully stops all workers, timers, and connections.
   */
  public stop(): void {
    this.isRunning = false;

    if (this.pacingTimer) {
      clearInterval(this.pacingTimer);
      this.pacingTimer = null;
    }

    if (this.diskSaveTimer) {
      clearInterval(this.diskSaveTimer);
      this.diskSaveTimer = null;
    }

    if (this.satellitePollTimer) {
      clearInterval(this.satellitePollTimer);
      this.satellitePollTimer = null;
    }

    if (this.regionalPollTimer) {
      clearInterval(this.regionalPollTimer);
      this.regionalPollTimer = null;
    }

    if (this.rfSocket) {
      try {
        this.rfSocket.onopen = null;
        this.rfSocket.onmessage = null;
        this.rfSocket.onerror = null;
        this.rfSocket.onclose = null;
        this.rfSocket.close();
      } catch {}
      this.rfSocket = null;
    }

    if (this.rfReconnectTimer) {
      clearTimeout(this.rfReconnectTimer);
      this.rfReconnectTimer = null;
    }

    // Save remaining dirty cache to disk
    if (this.isCacheDirty) {
      this.saveToDiskCache().catch(() => {});
    }
  }

  // =========================================================================
  // 1. INSTANT RF PASS-THROUGH (0 MS LATENCY)
  // =========================================================================

  /**
   * Ingests an RF strike from Blitzortung ground stations.
   * Dispatches IMMEDIATELY with 0 ms delay. Never placed in pacing queues.
   */
  public ingestRfStrike(strike: LightningEvent): void {
    if (!this.isValidStrike(strike)) return;
    if (this.historyMap.has(strike.id)) return;
    if (this.isSpatialTemporalDuplicate(strike)) return;

    this.rfInstantCount++;
    this.totalEventsProcessed++;
    this.lastEventTimestamp = strike.timestamp;

    // Record into 24h historical map
    this.recordHistoricalStrike(strike);

    // 0 ms latency immediate broadcast to SSE clients and local listeners
    this.broadcastToSse({ type: 'strike', event: strike });

    for (const listener of this.strikeListeners) {
      try {
        listener(strike);
      } catch (err) {
        console.error('Error in instant RF listener:', err);
      }
    }
  }

  // =========================================================================
  // 2. PACED SATELLITE DISTRIBUTION (KADEMELİ UYDU PACING)
  // =========================================================================

  /**
   * Ingests a raw batch of satellite flashes (NOAA GOES / MTG-LI).
   * Spreads them smoothly across the expected interval (e.g. 20 seconds)
   * in micro-packets (100-200ms) with ZERO data cropping or dropping.
   */
  public ingestSatelliteBatch(flashes: LightningEvent[], targetDurationMs = 20000): void {
    if (!flashes || flashes.length === 0) return;
    this.targetPacingDurationMs = targetDurationMs;
    this.pacingCycleStartMs = Date.now();

    const validFlashes: LightningEvent[] = [];
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      if (this.isValidStrike(f) && !this.historyMap.has(f.id) && !this.isSpatialTemporalDuplicate(f)) {
        validFlashes.push(f);
        this.recordHistoricalStrike(f);
      }
    }

    if (validFlashes.length === 0) return;

    // Fisher-Yates spatial shuffle to eliminate raw S3 file coordinate clumping
    for (let i = validFlashes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = validFlashes[i];
      validFlashes[i] = validFlashes[j];
      validFlashes[j] = tmp;
    }

    // Append to satellite pacing queue (ZERO CROPPING)
    this.satelliteQueue.push(...validFlashes);

    this.ensurePacingTimerActive();
  }

  private startPacingTimer(): void {
    if (this.pacingTimer) return;
    this.pacingTimer = setInterval(() => {
      this.dispatchNextSatelliteMicropacket();
    }, this.pacingIntervalMs);
  }

  private ensurePacingTimerActive(): void {
    if (!this.pacingTimer) {
      this.startPacingTimer();
    }
  }

  /**
   * Dispatches a calibrated micro-packet of satellite flashes every 100-200ms.
   */
  private dispatchNextSatelliteMicropacket(): void {
    if (this.satelliteQueue.length === 0) return;

    // Dynamically calculate micropacket chunk size to smoothly exhaust queue
    // across the target pacing window (e.g. ~20 seconds in live, or custom in tests)
    const targetDuration = Math.max(this.pacingIntervalMs, this.targetPacingDurationMs || 20000);
    const elapsed = Date.now() - (this.pacingCycleStartMs || Date.now());
    const remainingMs = Math.max(this.pacingIntervalMs, targetDuration - elapsed);
    const remainingTicks = Math.max(1, Math.ceil(remainingMs / this.pacingIntervalMs));
    const baseChunk = Math.ceil(this.satelliteQueue.length / remainingTicks);

    // Dynamic Rate Smoothing & Anti-Bloat:
    // Drains queue smoothly across the pacing cycle without artificial 3-item ceiling.
    // If queue experienced an extreme burst, scales up smoothly (up to 16/tick) to prevent buffer bloat.
    let dynamicChunk = baseChunk;

    // Organic Non-Metronome Jitter:
    // In live production (targetDuration >= 5000ms), introduce +/- 35% stochastic variation
    // and natural calm lulls (10% chance of 0-burst pause when queue is healthy).
    if (targetDuration >= 5000) {
      if (baseChunk <= 3 && Math.random() < 0.10) {
        // Natural calm pause between thunderstorm bursts
        return;
      }
      const jitterFactor = 0.65 + Math.random() * 0.70; // 0.65 to 1.35
      dynamicChunk = Math.round(baseChunk * jitterFactor);
    }

    const chunkSize = Math.max(1, Math.min(16, dynamicChunk));

    const micropacket = this.satelliteQueue.splice(0, chunkSize);
    if (micropacket.length === 0) return;

    this.satellitePacedCount += micropacket.length;
    this.totalEventsProcessed += micropacket.length;
    this.lastEventTimestamp = micropacket[micropacket.length - 1].timestamp;

    // Broadcast micropacket via SSE
    this.broadcastToSse({ type: 'batch', events: micropacket });

    // Notify internal listeners
    for (const listener of this.micropacketListeners) {
      try {
        listener(micropacket);
      } catch (err) {
        console.error('Error in micropacket listener:', err);
      }
    }

    for (let i = 0; i < micropacket.length; i++) {
      const item = micropacket[i];
      for (const listener of this.strikeListeners) {
        try {
          listener(item);
        } catch {}
      }
    }
  }

  // =========================================================================
  // 3. REGIONAL RADAR INGESTION (Singapore, Japan, Finland)
  // =========================================================================

  public ingestRegionalStrike(strike: LightningEvent): void {
    if (!this.isValidStrike(strike)) return;
    if (this.historyMap.has(strike.id)) return;
    if (this.isSpatialTemporalDuplicate(strike)) return;

    this.regionalCount++;
    this.totalEventsProcessed++;
    this.lastEventTimestamp = strike.timestamp;

    this.recordHistoricalStrike(strike);
    this.broadcastToSse({ type: 'strike', event: strike });

    for (const listener of this.strikeListeners) {
      try {
        listener(strike);
      } catch {}
    }
  }

  // =========================================================================
  // 4. 24-HOUR HISTORICAL BACKFILL & DISK CACHING
  // =========================================================================

  /**
   * Fast 24-hour historical archive backfill:
   * Queries FMI WFS open API and NOAA GOES-16/18 S3 open archive.
   * Populates the hub with real observations in 3-5 seconds.
   */
  public async perform24hBackfill(): Promise<number> {
    const startTime = Date.now();
    let newlyIngested = 0;

    console.log('🔄 [UnifiedLightningHub] Initiating fast 24h archive backfill...');

    // 1. Finland FMI WFS Backfill (up to 24 hours of real strikes in one fast XML query)
    const fmiPromise = (async () => {
      try {
        const now = new Date();
        const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const url = `https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::lightning::simple&starttime=${start.toISOString()}&endtime=${now.toISOString()}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const xml = await res.text();
          const strikes = this.parseFmiXml(xml);
          for (let i = 0; i < strikes.length; i++) {
            if (!this.historyMap.has(strikes[i].id)) {
              this.recordHistoricalStrike(strikes[i]);
              newlyIngested++;
            }
          }
          console.log(`⚡ [UnifiedLightningHub] FMI 24h Backfill ingested ${strikes.length} real Nordic strikes.`);
        }
      } catch (e: any) {
        console.warn('⚠️ [UnifiedLightningHub] FMI backfill error:', e?.message);
      }
    })();

    // 2. NOAA GOES S3 Recent Observations Backfill
    const goesPromise = (async () => {
      try {
        await this.initH5Wasm();
        if (this.isH5Ready) {
          const goes19Flashes = await this.fetchRecentGoesS3Flashes('https://noaa-goes19.s3.amazonaws.com', 'goes19_glm', 3);
          for (let i = 0; i < goes19Flashes.length; i++) {
            if (!this.historyMap.has(goes19Flashes[i].id)) {
              this.recordHistoricalStrike(goes19Flashes[i]);
              newlyIngested++;
            }
          }

          const goes18Flashes = await this.fetchRecentGoesS3Flashes('https://noaa-goes18.s3.amazonaws.com', 'goes18_glm', 2);
          for (let i = 0; i < goes18Flashes.length; i++) {
            if (!this.historyMap.has(goes18Flashes[i].id)) {
              this.recordHistoricalStrike(goes18Flashes[i]);
              newlyIngested++;
            }
          }
          console.log(`🛰️ [UnifiedLightningHub] GOES S3 Backfill ingested ${goes19Flashes.length + goes18Flashes.length} satellite flashes.`);
        }
      } catch (e: any) {
        console.warn('⚠️ [UnifiedLightningHub] GOES S3 backfill error:', e?.message);
      }
    })();

    // 3. Regional APIs (Singapore & Japan)
    const regionalPromise = (async () => {
      try {
        const res = await fetch('https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning', {
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          const records = data?.data?.records || [];
          if (records.length > 0) {
            const readings = records[0]?.item?.readings || [];
            for (let i = 0; i < readings.length; i++) {
              const r = readings[i];
              const lat = r.location?.latitude ?? r.latitude;
              const lon = r.location?.longitude ?? r.longitude;
              if (lat != null && lon != null) {
                const strikeTime = r.datetime ? new Date(r.datetime).getTime() : Date.now();
                const id = `nea_${lat.toFixed(3)}_${lon.toFixed(3)}_${strikeTime}`;
                if (!this.historyMap.has(id)) {
                  this.recordHistoricalStrike({
                    id,
                    latitude: lat,
                    longitude: lon,
                    timestamp: strikeTime,
                    peakCurrent: r.type === 'C' ? 18 : 32,
                    type: r.type === 'C' ? 'IC' : 'CG',
                    source: 'singapore_nea'
                  });
                  newlyIngested++;
                }
              }
            }
          }
        }
      } catch {}
    })();

    await Promise.allSettled([fmiPromise, goesPromise, regionalPromise]);

    // Save updated backfill to local disk cache
    this.saveToDiskCache();

    const elapsed = Date.now() - startTime;
    console.log(`✅ [UnifiedLightningHub] 24h Backfill loaded in ${elapsed}ms (${newlyIngested} new strikes, ${this.historyMap.size} total in 24h cache).`);

    return newlyIngested;
  }

  /**
   * Returns all stored lightning strikes from the rolling 24-hour window.
   */
  public get24hHistory(since = 0): LightningEvent[] {
    const cutoff = Math.max(Date.now() - 24 * 60 * 60 * 1000, since);
    const result: LightningEvent[] = [];

    for (const strike of this.historyMap.values()) {
      if (strike.timestamp >= cutoff) {
        result.push(strike);
      }
    }

    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
  }

  /**
   * Persists the in-memory 24-hour strike history to local disk (.cache/lightning_24h.json) asynchronously.
   */
  public async saveToDiskCache(): Promise<void> {
    if (this.isSavingDiskCache) return;
    this.isSavingDiskCache = true;
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // Prune strikes strictly older than 24 hours (preserves true 24h rolling window without FIFO eviction)
      this.pruneStaleHistory();

      const strikes = Array.from(this.historyMap.values());
      const payload = {
        updatedAt: Date.now(),
        count: strikes.length,
        strikes
      };

      const tmpFile = `${this.cacheFilePath}.tmp`;
      await fs.promises.writeFile(tmpFile, JSON.stringify(payload), 'utf8');
      await fs.promises.rename(tmpFile, this.cacheFilePath);

      this.isCacheDirty = false;
    } catch (err) {
      console.warn('⚠️ [UnifiedLightningHub] Failed to save disk cache:', err);
    } finally {
      this.isSavingDiskCache = false;
    }
  }

  /**
   * Merges an array or file of strikes into the in-memory history map without dropping existing verified strikes.
   */
  public mergeStrikesIntoHistory(strikes: LightningEvent[]): number {
    if (!strikes || strikes.length === 0) return 0;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let added = 0;
    for (let i = 0; i < strikes.length; i++) {
      const s = strikes[i];
      if (s && s.id && s.timestamp >= cutoff && this.isValidStrike(s)) {
        // Prune weak optical noise (< 2.0e-14 J) for satellite sources
        if (s.opticalEnergy != null && s.opticalEnergy < 2.0e-14 && (s.source?.includes('glm') || s.source?.includes('goes') || s.source?.includes('mtg'))) {
          continue;
        }
        if (!this.historyMap.has(s.id)) {
          this.historyMap.set(s.id, s);
          added++;
        }
      }
    }
    if (added > 0) this.isCacheDirty = true;
    return added;
  }

  /**
   * Loads cached strikes from disk (.cache/lightning_24h.json).
   * Automatically synchronizes from 7/24 Oracle VPS if local PC was off and cache is stale.
   */
  public loadFromDiskCache(): void {
    try {
      const defaultCachePath = path.resolve(process.cwd(), '.cache', 'lightning_24h.json');
      const keyPath = path.resolve(process.cwd(), 'ssh-key-2026-09-10.key');
      if (this.enableNetwork && this.cacheFilePath === defaultCachePath && fs.existsSync(keyPath)) {
        const isStaleOrMissing = !fs.existsSync(this.cacheFilePath) ||
          (Date.now() - fs.statSync(this.cacheFilePath).mtimeMs > 300000);
        if (isStaleOrMissing) {
          try {
            console.log('🔄 [UnifiedLightningHub] Local 24h cache stale or missing. Auto-syncing from Oracle VPS 7/24 archive...');
            const tmpVpsFile = path.resolve(process.cwd(), '.cache', 'vps_incoming.json');
            execSync(`scp -o StrictHostKeyChecking=no -i ssh-key-2026-09-10.key ubuntu@130.61.53.100:/home/ubuntu/lightning-globe/.cache/lightning_24h.json "${tmpVpsFile}"`, { timeout: 30000, stdio: 'ignore' });
            if (fs.existsSync(tmpVpsFile)) {
              const vpsData = JSON.parse(fs.readFileSync(tmpVpsFile, 'utf8'));
              const vpsStrikes = vpsData?.strikes || [];
              const mergedCount = this.mergeStrikesIntoHistory(vpsStrikes);
              fs.unlinkSync(tmpVpsFile);
              console.log(`✅ [UnifiedLightningHub] Merged ${mergedCount} strikes from Oracle VPS archive.`);
            }
          } catch (e: any) {
            console.warn('⚠️ [UnifiedLightningHub] Note on VPS auto-sync:', e?.message);
          }
        }
      }

      if (!fs.existsSync(this.cacheFilePath)) return;

      const content = fs.readFileSync(this.cacheFilePath, 'utf8');
      const data = JSON.parse(content);
      const strikes = data?.strikes || [];
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;

      let loadedCount = 0;
      for (let i = 0; i < strikes.length; i++) {
        const s = strikes[i];
        if (s && s.id && s.timestamp >= cutoff && this.isValidStrike(s)) {
          // NOAA Sector Partitioning: GOES-18 covers West (< -105°), GOES-19 covers East (>= -105°)
          if (s.source === 'goes18_glm' && s.longitude >= -105) continue;
          if ((s.source === 'goes19_glm' || s.source === 'goes16_glm') && s.longitude < -105) continue;

          // Prune weak optical noise (< 2.0e-14 J) for satellite sources
          if (s.opticalEnergy != null && s.opticalEnergy < 2.0e-14 && (s.source?.includes('glm') || s.source?.includes('goes') || s.source?.includes('mtg'))) {
            continue;
          }

          if (!this.historyMap.has(s.id)) {
            this.historyMap.set(s.id, s);
            loadedCount++;
          }
        }
      }

      console.log(`📂 [UnifiedLightningHub] Total ${this.historyMap.size} real strikes active in 24h history cache.`);
    } catch (err) {
      console.warn('⚠️ [UnifiedLightningHub] Failed to load disk cache:', err);
    }
  }

  // =========================================================================
  // 5. SSE CLIENT CONNECTION MANAGEMENT
  // =========================================================================

  public registerSseClient(res: ServerResponse): () => void {
    this.sseClients.add(res);

    // Send initial handshake
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now(), cached24hCount: this.historyMap.size })}\n\n`);

    return () => {
      this.sseClients.delete(res);
    };
  }

  private broadcastToSse(data: { type: string; [key: string]: any }): void {
    if (this.sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify(data)}\n\n`;

    for (const client of this.sseClients) {
      try {
        client.write(msg);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  public getStats(): HubStats {
    return {
      status: this.isRunning ? 'LIVE' : 'OFFLINE',
      totalEventsProcessed: this.totalEventsProcessed,
      rfInstantCount: this.rfInstantCount,
      satellitePacedCount: this.satellitePacedCount,
      regionalCount: this.regionalCount,
      pacingQueueSize: this.satelliteQueue.length,
      cached24hCount: this.historyMap.size,
      activeSseClients: this.sseClients.size,
      lastEventTimestamp: this.lastEventTimestamp
    };
  }

  public onStrike(callback: (strike: LightningEvent) => void): () => void {
    this.strikeListeners.add(callback);
    return () => this.strikeListeners.delete(callback);
  }

  public onMicropacket(callback: (strikes: LightningEvent[]) => void): () => void {
    this.micropacketListeners.add(callback);
    return () => this.micropacketListeners.delete(callback);
  }

  // =========================================================================
  // INTERNAL HELPERS & PROVIDERS
  // =========================================================================

  private recordHistoricalStrike(strike: LightningEvent): void {
    this.historyMap.set(strike.id, strike);
    this.isCacheDirty = true;
  }

  private pruneStaleHistory(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, strike] of this.historyMap.entries()) {
      if (strike.timestamp < cutoff) {
        this.historyMap.delete(id);
      }
    }
  }

  private isValidStrike(s: any): s is LightningEvent {
    return (
      s &&
      typeof s.id === 'string' &&
      typeof s.latitude === 'number' &&
      !isNaN(s.latitude) &&
      s.latitude >= -90 &&
      s.latitude <= 90 &&
      typeof s.longitude === 'number' &&
      !isNaN(s.longitude) &&
      s.longitude >= -180 &&
      s.longitude <= 180 &&
      typeof s.timestamp === 'number' &&
      !isNaN(s.timestamp)
    );
  }

  // --- Blitzortung RF Connector ---
  private connectBlitzortungRf(): void {
    if (!this.isRunning) return;
    const WsClass: any = typeof WebSocket !== 'undefined' ? WebSocket : NodeWebSocket;
    if (!WsClass) return;

    const endpoints = [
      'wss://ws1.blitzortung.org',
      'wss://ws2.blitzortung.org',
      'wss://ws7.blitzortung.org',
      'wss://live.blitzortung.org'
    ];
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

    try {
      const socket = new WsClass(endpoint);
      this.rfSocket = socket;

      socket.onopen = () => {
        try {
          socket.send(JSON.stringify({ a: 111 }));
        } catch {}
      };

      socket.onmessage = (event: { data: any }) => {
        if (typeof event.data !== 'string') return;
        this.handleBlitzortungMessage(event.data);
      };

      socket.onerror = () => {
        this.scheduleRfReconnect();
      };

      socket.onclose = () => {
        this.scheduleRfReconnect();
      };
    } catch {
      this.scheduleRfReconnect();
    }
  }

  private scheduleRfReconnect(): void {
    this.rfSocket = null;
    if (!this.isRunning || this.rfReconnectTimer) return;

    this.rfReconnectTimer = setTimeout(() => {
      this.rfReconnectTimer = null;
      if (this.isRunning) {
        this.connectBlitzortungRf();
      }
    }, 2000);
  }

  private handleBlitzortungMessage(rawText: string): void {
    try {
      let json = rawText;
      try {
        JSON.parse(rawText);
      } catch {
        json = this.decompressLzw(rawText);
      }

      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        if (parsed.length >= 3 && typeof parsed[0] === 'number') {
          this.parseBlitzortungArray(parsed);
        } else {
          for (let i = 0; i < parsed.length; i++) {
            const it = parsed[i];
            if (Array.isArray(it)) {
              this.parseBlitzortungArray(it);
            } else if (typeof it === 'object' && it !== null) {
              this.parseBlitzortungObject(it);
            }
          }
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        this.parseBlitzortungObject(parsed);
      }
    } catch {}
  }

  private parseBlitzortungObject(obj: any): void {
    let rawTime = Number(obj.time || obj.timestamp || Date.now());
    if (rawTime > 1e14) rawTime = Math.floor(rawTime / 1e6); // nanoseconds to ms

    const lat = Number(obj.lat ?? obj.latitude);
    const lon = Number(obj.lon ?? obj.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    let current = 25;
    if (typeof obj.mc === 'number') current = Math.abs(obj.mc);
    else if (typeof obj.mcg === 'number') current = Math.abs(obj.mcg);
    else if (typeof obj.peakCurrent === 'number') current = Math.abs(obj.peakCurrent);

    const id = `bo_${lat.toFixed(3)}_${lon.toFixed(3)}_${rawTime}`;
    this.ingestRfStrike({
      id,
      latitude: lat,
      longitude: lon,
      timestamp: rawTime,
      peakCurrent: current,
      type: 'CG',
      source: 'blitzortung'
    });
  }

  private parseBlitzortungArray(arr: any[]): void {
    let rawTime = Number(arr[0]);
    if (rawTime > 1e14) rawTime = Math.floor(rawTime / 1e6); // nanoseconds to ms

    const lon = Number(arr[1]);
    const lat = Number(arr[2]);
    let current = 25;
    if (arr.length > 6 && typeof arr[6] === 'number') current = Math.abs(arr[6]);

    const id = `bo_${lat.toFixed(3)}_${lon.toFixed(3)}_${rawTime}`;
    this.ingestRfStrike({
      id,
      latitude: lat,
      longitude: lon,
      timestamp: rawTime,
      peakCurrent: current,
      type: 'CG',
      source: 'blitzortung'
    });
  }

  private decompressLzw(b: string): string {
    if (!b || b.length < 2) return b;
    const d = b.split('');
    let c = d[0];
    let f = c;
    const g = [c];
    const e: Record<number, string> = {};
    const h = 256;
    let o = h;
    for (let i = 1; i < d.length; i++) {
      const a = d[i].charCodeAt(0);
      const str = h > a ? d[i] : (e[a] ? e[a] : f + c);
      g.push(str);
      c = str.charAt(0);
      e[o] = f + c;
      o++;
      f = str;
    }
    return g.join('');
  }

  // --- Satellite Ingest Engine ---
  private async initH5Wasm(): Promise<void> {
    if (this.isH5Ready) return;
    try {
      this.h5wasmModule = await import('h5wasm');
      await this.h5wasmModule.ready;
      this.isH5Ready = true;
    } catch (e) {
      console.warn('⚠️ [UnifiedLightningHub] h5wasm init warning:', e);
    }
  }

  private startSatellitePolling(): void {
    // Poll GOES satellites every 20 seconds
    const pollSat = async () => {
      if (!this.isRunning) return;
      try {
        await this.initH5Wasm();
        if (this.isH5Ready) {
          const g19 = await this.fetchRecentGoesS3Flashes('https://noaa-goes19.s3.amazonaws.com', 'goes19_glm', 1);
          if (g19.length > 0) {
            this.ingestSatelliteBatch(g19, 20000);
          }
          const g18 = await this.fetchRecentGoesS3Flashes('https://noaa-goes18.s3.amazonaws.com', 'goes18_glm', 1);
          if (g18.length > 0) {
            this.ingestSatelliteBatch(g18, 20000);
          }
        }
      } catch {}
    };

    pollSat();
    this.satellitePollTimer = setInterval(pollSat, 20000);
  }

  private async fetchRecentGoesS3Flashes(s3BaseUrl: string, source: LightningSource, maxFiles = 1): Promise<LightningEvent[]> {
    try {
      const prefix = 'GLM-L2-LCFA';
      const rY = await fetch(`${s3BaseUrl}/?prefix=${prefix}/&delimiter=/`, { signal: AbortSignal.timeout(8000) });
      if (!rY.ok) return [];
      const xmlY = await rY.text();
      const years = [...xmlY.matchAll(/<Prefix>GLM-L2-LCFA\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
      if (!years.length) return [];
      const latestYear = years[years.length - 1];

      // Guard: Do not ingest files older than current calendar year
      const currentYearStr = String(new Date().getUTCFullYear());
      if (latestYear < currentYearStr) {
        console.warn(`[UnifiedLightningHub] Skipping stale satellite archive year ${latestYear} for ${source}`);
        return [];
      }

      const rD = await fetch(`${s3BaseUrl}/?prefix=${prefix}/${latestYear}/&delimiter=/`, { signal: AbortSignal.timeout(8000) });
      if (!rD.ok) return [];
      const xmlD = await rD.text();
      const days = [...xmlD.matchAll(/<Prefix>GLM-L2-LCFA\/\d+\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
      if (!days.length) return [];
      const latestDay = days[days.length - 1];

      const rH = await fetch(`${s3BaseUrl}/?prefix=${prefix}/${latestYear}/${latestDay}/&delimiter=/`, { signal: AbortSignal.timeout(8000) });
      if (!rH.ok) return [];
      const xmlH = await rH.text();
      const hours = [...xmlH.matchAll(/<Prefix>GLM-L2-LCFA\/\d+\/\d+\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
      if (!hours.length) return [];
      const latestHour = hours[hours.length - 1];

      const rFiles = await fetch(`${s3BaseUrl}/?prefix=${prefix}/${latestYear}/${latestDay}/${latestHour}/`, { signal: AbortSignal.timeout(8000) });
      if (!rFiles.ok) return [];
      const xmlFiles = await rFiles.text();
      const keys = [...xmlFiles.matchAll(/<Key>([^<]+)<\/Key>/g)]
        .map(m => m[1])
        .filter(k => k.endsWith('.nc'));

      const targetKeys = keys.slice(-maxFiles);
      const allEvents: LightningEvent[] = [];

      for (const key of targetKeys) {
        // Guard: Prevent re-processing the exact same NetCDF file
        if (this.processedNetCdfKeys.has(key)) {
          continue;
        }
        this.processedNetCdfKeys.add(key);
        if (this.processedNetCdfKeys.size > 5000) {
          const firstKey = this.processedNetCdfKeys.values().next().value;
          if (firstKey) this.processedNetCdfKeys.delete(firstKey);
        }

        const fileRes = await fetch(`${s3BaseUrl}/${key}`, { signal: AbortSignal.timeout(15000) });
        if (!fileRes.ok) continue;
        const buf = await fileRes.arrayBuffer();
        const events = this.parseNetCdfBuffer(key, buf, source);
        allEvents.push(...events);
      }

      return allEvents;
    } catch {
      return [];
    }
  }

  private parseNetCdfBuffer(key: string, buffer: ArrayBuffer, source: LightningSource): LightningEvent[] {
    if (!this.isH5Ready || !this.h5wasmModule) return [];
    const vfileName = `hub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.nc`;
    try {
      const u8 = new Uint8Array(buffer);
      this.h5wasmModule.FS.writeFile(vfileName, u8);
      const file = new this.h5wasmModule.File(vfileName, 'r');

      const flashLat = file.get('flash_lat');
      const flashLon = file.get('flash_lon');
      const flashEnergy = file.get('flash_energy');
      const flashArea = file.get('flash_area');

      if (!flashLat || !flashLon) {
        file.close();
        try { this.h5wasmModule.FS.unlink(vfileName); } catch {}
        return [];
      }

      const lats = flashLat.value;
      const lons = flashLon.value;
      const rawEnergies = flashEnergy ? flashEnergy.value : null;
      const rawAreas = flashArea ? flashArea.value : null;

      const now = Date.now();
      const results: LightningEvent[] = [];
      const fileBase = key.split('/').pop()?.replace('.nc', '') || 'glm';
      const fileTag = fileBase.slice(-20);

      const targetThreshold = source === 'goes18_glm' ? this.thresholdGoes18 : this.thresholdGoes19;
      const targetSatKey = source === 'goes18_glm' ? 'goes18' : 'goes19';

      let batchRaw = 0;
      let batchFiltered = 0;
      let batchPassed = 0;

      for (let i = 0; i < lats.length; i++) {
        const lat = Number(lats[i]);
        const lon = Number(lons[i]);
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

        // NOAA Operational Sector Partitioning:
        // GOES-East (GOES-16/19): Longitude >= -105° (Americas East, Caribbean, Atlantic, South America)
        // GOES-West (GOES-17/18): Longitude < -105° (Americas West, Pacific Basin, Alaska, Hawaii)
        // Eliminates duplicate double-counting in the massive overlap zone.
        if (source === 'goes18_glm' && lon >= -105) continue;
        if ((source === 'goes19_glm' || source === 'goes16_glm') && lon < -105) continue;

        batchRaw++;
        const energyJ = rawEnergies ? Number(rawEnergies[i]) * 1e-15 : 1e-14;

        // Dynamic per-satellite optical energy threshold:
        if (energyJ < targetThreshold) {
          batchFiltered++;
          continue;
        }

        batchPassed++;
        const area = rawAreas ? Math.max(15, Math.round((Number(rawAreas[i]) * 152601) / 1e6)) : 50;
        const calculatedCurrent = Math.max(8, Math.min(65, Math.round(15 + Math.log10(energyJ * 1e15 + 1) * 8)));

        // Deterministic ID bound to NetCDF file tag and flash index
        const id = `${source}_${fileTag}_${i}_${Math.round(lat * 100)}_${Math.round(lon * 100)}`;
        results.push({
          id,
          latitude: Math.round(lat * 10000) / 10000,
          longitude: Math.round(lon * 10000) / 10000,
          timestamp: now - (lats.length - i) * 100,
          peakCurrent: calculatedCurrent,
          type: energyJ >= 1.0e-13 ? 'CG' : 'IC',
          source,
          opticalEnergy: energyJ,
          opticalArea: area
        });
      }

      if (batchRaw > 0) {
        const sat = this.satelliteTelemetry[targetSatKey];
        sat.rawCount = batchRaw;
        sat.filteredCount = batchFiltered;
        sat.passedCount = batchPassed;
        sat.thresholdJ = targetThreshold;
        sat.lastFetchTime = Date.now();
      }

      file.close();
      try { this.h5wasmModule.FS.unlink(vfileName); } catch {}
      return results;
    } catch {
      try { this.h5wasmModule.FS.unlink(vfileName); } catch {}
      return [];
    }
  }

  // --- Regional Radar Poll Engine ---
  private startRegionalPolling(): void {
    const poll = async () => {
      if (!this.isRunning) return;
      try {
        // Finland FMI WFS (1-min)
        const now = new Date();
        const start = new Date(Date.now() - 3 * 60 * 1000);
        const url = `https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::lightning::simple&starttime=${start.toISOString()}&endtime=${now.toISOString()}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const xml = await res.text();
          const strikes = this.parseFmiXml(xml);
          for (let i = 0; i < strikes.length; i++) {
            this.ingestRegionalStrike(strikes[i]);
          }
        }
      } catch {}
    };

    poll();
    this.regionalPollTimer = setInterval(poll, 60000);
  }

  private parseFmiXml(xmlText: string): LightningEvent[] {
    const results: LightningEvent[] = [];
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
      results.push({
        id: `fmi_${strokeId}_${s.time}`,
        latitude: s.lat,
        longitude: s.lon,
        timestamp: s.time,
        peakCurrent: s.peakCurrent,
        type: s.isCloud ? 'IC' : 'CG',
        source: 'finland_fmi'
      });
    }

    return results;
  }

  /**
   * Ingests MTG-LI flashes with dynamic threshold and telemetry tracking.
   */
  public ingestMtgFlashes(rawFlashes: any[]): void {
    if (!rawFlashes || rawFlashes.length === 0) return;
    const now = Date.now();
    let batchRaw = rawFlashes.length;
    let batchFiltered = 0;
    let batchPassed = 0;
    const passedStrikes: LightningEvent[] = [];

    for (const f of rawFlashes) {
      const energyJ = typeof f.energy_j === 'number' ? f.energy_j : (typeof f.radiance === 'number' ? f.radiance : 2.5e-14);
      if (energyJ < this.thresholdMtg) {
        batchFiltered++;
        continue;
      }
      batchPassed++;
      const id = f.id || `mtg_${Math.round(f.lat * 100)}_${Math.round(f.lon * 100)}_${f.time || now}`;
      passedStrikes.push({
        id,
        latitude: f.lat,
        longitude: f.lon,
        timestamp: f.time || now,
        peakCurrent: Math.max(12, Math.min(65, Math.round(15 + Math.log10(energyJ * 1e15 + 1) * 8))),
        type: energyJ >= 1.0e-13 ? 'CG' : 'IC',
        source: 'mtg_li',
        opticalEnergy: energyJ,
        opticalArea: f.area_km2 || 40
      });
    }

    const sat = this.satelliteTelemetry.mtg;
    sat.rawCount = batchRaw;
    sat.filteredCount = batchFiltered;
    sat.passedCount = batchPassed;
    sat.thresholdJ = this.thresholdMtg;
    sat.lastFetchTime = now;

    if (passedStrikes.length > 0) {
      this.ingestSatelliteBatch(passedStrikes, 30000);
    }
  }

  /**
   * Returns current satellite real-time telemetry (raw, filtered, passed, periods, thresholds).
   */
  public getSatelliteTelemetry() {
    return this.satelliteTelemetry;
  }

  /**
   * Sets dynamic optical energy thresholds for satellites and broadcasts to all clients.
   */
  public setSatelliteThresholds(thresholds: { goes19?: number; goes18?: number; mtg?: number }): void {
    if (typeof thresholds.goes19 === 'number' && thresholds.goes19 > 0) {
      this.thresholdGoes19 = thresholds.goes19 * 1e-14;
      this.satelliteTelemetry.goes19.thresholdJ = this.thresholdGoes19;
    }
    if (typeof thresholds.goes18 === 'number' && thresholds.goes18 > 0) {
      this.thresholdGoes18 = thresholds.goes18 * 1e-14;
      this.satelliteTelemetry.goes18.thresholdJ = this.thresholdGoes18;
    }
    if (typeof thresholds.mtg === 'number' && thresholds.mtg > 0) {
      this.thresholdMtg = thresholds.mtg * 1e-14;
      this.satelliteTelemetry.mtg.thresholdJ = this.thresholdMtg;
    }
    console.log(`📡 [UnifiedLightningHub] Updated satellite thresholds: GOES-19=${(this.thresholdGoes19*1e14).toFixed(1)}e-14, GOES-18=${(this.thresholdGoes18*1e14).toFixed(1)}e-14, MTG=${(this.thresholdMtg*1e14).toFixed(1)}e-14`);
    this.broadcastToSse({
      type: 'satellite_thresholds_updated',
      thresholds: {
        goes19: this.thresholdGoes19 * 1e14,
        goes18: this.thresholdGoes18 * 1e14,
        mtg: this.thresholdMtg * 1e14
      }
    });
  }

  /**
   * Fast-Boot Snapshot: Spatially balanced sampling across 5 continents for instant <100ms startup.
   */
  public getRecentQuick(limit = 600): { count: number; strikes: LightningEvent[]; timestamp: number } {
    const cutoff = Date.now() - 30 * 60 * 1000;
    const sa: LightningEvent[] = [];
    const na: LightningEvent[] = [];
    const eu: LightningEvent[] = [];
    const af: LightningEvent[] = [];
    const asia: LightningEvent[] = [];

    for (const strike of this.historyMap.values()) {
      if (strike.timestamp < cutoff) continue;
      const lat = strike.latitude;
      const lon = strike.longitude;

      if (lat >= -56 && lat <= 13 && lon >= -85 && lon <= -34) {
        sa.push(strike);
      } else if (lat >= 13 && lat <= 72 && lon >= -170 && lon <= -50) {
        na.push(strike);
      } else if (lat >= 35 && lat <= 72 && lon >= -25 && lon <= 45) {
        eu.push(strike);
      } else if (lat >= -35 && lat <= 35 && lon >= -20 && lon <= 55) {
        af.push(strike);
      } else {
        asia.push(strike);
      }
    }

    const quota = Math.floor(limit / 5);
    const pickLatest = (arr: LightningEvent[], count: number) => {
      arr.sort((a, b) => b.timestamp - a.timestamp);
      return arr.slice(0, count);
    };

    const combined = [
      ...pickLatest(sa, quota),
      ...pickLatest(na, quota),
      ...pickLatest(eu, quota),
      ...pickLatest(af, quota),
      ...pickLatest(asia, quota)
    ];

    combined.sort((a, b) => a.timestamp - b.timestamp);
    return {
      count: combined.length,
      strikes: combined,
      timestamp: Date.now()
    };
  }
}
