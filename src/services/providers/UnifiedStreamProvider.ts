import type { LightningEvent } from '../../types/lightning';
import type { ILightningProvider, ProviderStatus, ProviderStats } from '../../types/provider';
import { LightningNormalizer } from '../normalizer/LightningNormalizer';
import { StochasticPacingQueue } from './StochasticPacingQueue';

export interface UnifiedStreamProviderOptions {
  streamUrl?: string;
  historyUrl?: string;
  eventSourceClass?: any;
}

/**
 * UnifiedStreamProvider: Client-side single-socket receiver for the Unified Lightning Hub.
 *
 * Replaces fragmented polling with a high-efficiency Server-Sent Events (SSE) stream.
 * Ingests:
 * - 0 ms latency instant Blitzortung RF ground strikes.
 * - Smoothly paced (100-200ms) satellite micro-packets (NOAA GOES-16/18, EUMETSAT MTG).
 * - Realtime regional radar strikes (FMI, NEA, JMA).
 *
 * Provides fetch24hHistory() for instant 3-5s historical startup hydration.
 */
export class UnifiedStreamProvider implements ILightningProvider {
  public readonly id = 'provider-unified-stream';
  public readonly name = 'Unified Realtime Lightning Hub (SSE)';
  public status: ProviderStatus = 'OFFLINE';

  private readonly streamUrl: string;
  private readonly historyUrl: string;
  private readonly eventSourceClass: any;

  private eventSource: any = null;
  private isExplicitlyDisconnected = false;

  private readonly eventListeners: Set<(event: LightningEvent) => void> = new Set();
  private readonly statusListeners: Set<(status: ProviderStatus) => void> = new Set();

  private totalEventsReceived = 0;
  private lastEventTimestamp: number | null = null;
  private recentTimestamps: number[] = [];
  private rateMeterTimer: ReturnType<typeof setInterval> | null = null;
  private currentEventsPerSec = 0;
  private pacingQueue: StochasticPacingQueue<any>;

  constructor(options?: UnifiedStreamProviderOptions) {
    this.streamUrl = options?.streamUrl ?? '/api/lightning/stream';
    this.historyUrl = options?.historyUrl ?? '/api/lightning/history-24h';
    this.eventSourceClass = options?.eventSourceClass ?? (typeof EventSource !== 'undefined' ? EventSource : null);
    
    this.pacingQueue = new StochasticPacingQueue({
      minBurstIntervalMs: 35,
      maxBurstIntervalMs: 65,
      onEmit: (evt: any) => this.emitNormalized(evt)
    });
  }

  public async connect(): Promise<void> {
    this.isExplicitlyDisconnected = false;
    this.startRateMeter();

    if (!this.eventSourceClass) {
      this.status = 'STALE';
      this.notifyStatus(this.status);
      return;
    }

    this.status = 'CONNECTING';
    this.notifyStatus(this.status);

    try {
      this.eventSource = new this.eventSourceClass(this.streamUrl);

      this.eventSource.onopen = () => {
        if (this.isExplicitlyDisconnected) {
          this.eventSource?.close();
          return;
        }
        this.status = 'LIVE';
        this.notifyStatus(this.status);
      };

      this.eventSource.onmessage = (event: { data: string }) => {
        this.handleRawMessage(event.data);
      };

      if (typeof this.eventSource.addEventListener === 'function') {
        this.eventSource.addEventListener('strike', (event: { data: string }) => {
          this.handleRawMessage(event.data);
        });
        this.eventSource.addEventListener('batch', (event: { data: string }) => {
          this.handleRawMessage(event.data);
        });
      }

      this.eventSource.onerror = () => {
        if (this.isExplicitlyDisconnected) return;
        if (this.status !== 'STALE') {
          this.status = 'STALE';
          this.notifyStatus(this.status);
        }
      };
    } catch {
      this.status = 'STALE';
      this.notifyStatus(this.status);
    }
  }

  public disconnect(): void {
    this.isExplicitlyDisconnected = true;

    if (this.rateMeterTimer) {
      clearInterval(this.rateMeterTimer);
      this.rateMeterTimer = null;
    }
    
    this.pacingQueue.clear();

    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }

    this.status = 'OFFLINE';
    this.notifyStatus(this.status);
  }

  public onEvent(callback: (event: LightningEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  public onStatusChange(callback: (status: ProviderStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  public getStats(): ProviderStats {
    return {
      eventsPerSecond: this.currentEventsPerSec,
      totalEventsReceived: this.totalEventsReceived,
      lastEventTimestamp: this.lastEventTimestamp
    };
  }

  /**
   * Fetches the 24-hour historical real strike archive on startup.
   * Enables immediate hydration of storm cells, honeycomb radar, and 24h traces.
   */
  public async fetch24hHistory(since = 0): Promise<LightningEvent[]> {
    try {
      const url = since > 0 ? `${this.historyUrl}?since=${since}` : this.historyUrl;
      let res: Response | null = null;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      } catch {
        res = null;
      }

      const contentType = res?.headers?.get('content-type') || '';
      // If local endpoint returned 404, failed, or returned non-JSON (e.g. Cloudflare SPA HTML fallback), try static CDN asset
      if (!res || !res.ok || !contentType.includes('json')) {
        try {
          const staticRes = await fetch('/data/lightning_24h.json', { signal: AbortSignal.timeout(15000) });
          const staticType = staticRes.headers?.get('content-type') || '';
          if (staticRes.ok && (staticType.includes('json') || staticType.includes('text') || staticType === '')) {
            res = staticRes;
          }
        } catch {
          res = null;
        }
      }

      // If still not ok, try Oracle VPS central hub
      if (!res || !res.ok) {
        try {
          const vpsUrl = since > 0
            ? `http://130.61.53.100/api/lightning/history-24h?since=${since}`
            : 'http://130.61.53.100/api/lightning/history-24h';
          res = await fetch(vpsUrl, { signal: AbortSignal.timeout(6000) });
        } catch {
          res = null;
        }
      }

      if (!res || !res.ok) {
        console.warn(`[UnifiedStreamProvider] History fetch returned HTTP ${res?.status ?? 'FAILED'}`);
        return [];
      }

      let text = '';
      if (typeof res.text === 'function') {
        try {
          text = await res.text();
        } catch {}
      }

      // Off-thread JSON parsing via Web Worker to guarantee zero UI micro-stutter
      if (text && typeof window !== 'undefined' && window.Worker) {
        try {
          const normalized = await this.parseWithWorker(text, since);
          if (normalized && normalized.length > 0) {
            return normalized;
          }
        } catch (workerErr) {
          console.warn('[UnifiedStreamProvider] Worker parse fallback to main thread:', workerErr);
        }
      }

      let json: any = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch (parseErr) {
          console.warn('[UnifiedStreamProvider] Main thread JSON parse failed:', parseErr);
        }
      } else if (typeof res.json === 'function') {
        try {
          json = await res.json();
        } catch {}
      }
      let strikes = json?.strikes || [];

      // If running on local machine and local archive is empty/stale (< 5000 strikes), trigger on-demand VPS sync
      if (strikes.length < 5000 && typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        try {
          const syncRes = await fetch('/api/lightning/sync-vps');
          if (syncRes.ok) {
            const retryRes = await fetch(url, { signal: AbortSignal.timeout(6000) });
            if (retryRes.ok) {
              const retryJson = await retryRes.json();
              if (retryJson?.strikes && retryJson.strikes.length > strikes.length) {
                strikes = retryJson.strikes;
              }
            }
          }
        } catch {}
      }

      const normalized: LightningEvent[] = [];
      for (let i = 0; i < strikes.length; i++) {
        const item = strikes[i];
        const rawEvent = {
          id: item.id || `hist-${i}`,
          latitude: item.latitude ?? item.lat,
          longitude: item.longitude ?? item.lon,
          timestamp: item.timestamp ?? item.time,
          peakCurrent: item.peakCurrent ?? item.ka,
          type: item.type ?? 'CG',
          source: item.source ?? item.src ?? 'blitzortung'
        };
        const evt = LightningNormalizer.normalize(rawEvent, rawEvent.source);
        if (evt) {
          normalized.push(evt);
        }
      }

      return normalized;
    } catch (err) {
      console.warn('[UnifiedStreamProvider] Failed to fetch 24h history:', err);
      return [];
    }
  }

  /**
   * Internal message parser for incoming SSE data chunks.
   */
  public handleRawMessage(rawData: string): void {
    if (!rawData) return;
    try {
      const parsed = JSON.parse(rawData);

      if (parsed.type === 'connected') {
        if (this.status !== 'LIVE') {
          this.status = 'LIVE';
          this.notifyStatus(this.status);
        }
        return;
      }

      if (parsed.type === 'satellite_thresholds_updated' && parsed.thresholds && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('satellite_thresholds_updated', { detail: parsed.thresholds }));
        return;
      }

      if (parsed.type === 'strike' && parsed.event) {
        this.emitNormalized(parsed.event);
        return;
      }

      if ((parsed.type === 'batch' || parsed.type === 'micropacket') && Array.isArray(parsed.events)) {
        const batch = parsed.events.map((e: any) => ({
          data: e,
          lat: e.latitude || e.lat || 0,
          lon: e.longitude || e.lon || 0
        }));
        this.pacingQueue.enqueueBatch(batch, 1200);
        return;
      }

      // If array directly
      if (Array.isArray(parsed)) {
        const batch = parsed.map((e: any) => ({
          data: e,
          lat: e.latitude || e.lat || 0,
          lon: e.longitude || e.lon || 0
        }));
        this.pacingQueue.enqueueBatch(batch, 1200);
        return;
      }

      // If single strike directly
      if (parsed.latitude != null && parsed.longitude != null) {
        this.emitNormalized(parsed);
      }
    } catch {}
  }

  private emitNormalized(raw: any): void {
    const event = LightningNormalizer.normalize(raw, raw.source || 'blitzortung');
    if (!event) return;

    this.totalEventsReceived++;
    this.lastEventTimestamp = event.timestamp;
    this.recentTimestamps.push(Date.now());

    if (this.status !== 'LIVE') {
      this.status = 'LIVE';
      this.notifyStatus(this.status);
    }

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in UnifiedStreamProvider event listener:', err);
      }
    }
  }

  private notifyStatus(status: ProviderStatus): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('Error in status listener:', err);
      }
    }
  }

  private startRateMeter(): void {
    if (this.rateMeterTimer) return;
    this.rateMeterTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 1000;
      this.recentTimestamps = this.recentTimestamps.filter(t => t >= cutoff);
      this.currentEventsPerSec = this.recentTimestamps.length;
    }, 500);
  }

  /**
   * Spawns lightningDataWorker off-thread to decode JSON archives without main thread jitter.
   */
  private async parseWithWorker(jsonText: string, since: number = 0): Promise<LightningEvent[]> {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(
          new URL('../../workers/lightningDataWorker.ts', import.meta.url),
          { type: 'module' }
        );

        const reqId = `worker-${Date.now()}`;
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Worker parse timeout'));
        }, 30000);

        worker.onmessage = (e: MessageEvent) => {
          clearTimeout(timeout);
          worker.terminate();

          if (e.data?.type === 'PARSE_COMPLETE' && Array.isArray(e.data.strikes)) {
            const rawStrikes = e.data.strikes;
            const events: LightningEvent[] = [];
            for (let i = 0; i < rawStrikes.length; i++) {
              const s = rawStrikes[i];
              events.push({
                id: s.id,
                latitude: s.lat,
                longitude: s.lon,
                timestamp: s.time,
                peakCurrent: s.ka,
                type: s.type,
                source: s.src as any
              });
            }
            console.log(`⚡ [UnifiedStreamProvider] Worker decoded ${events.length} strikes in ${Math.round(e.data.durationMs)}ms with zero UI micro-stutter.`);
            resolve(events);
          } else {
            reject(new Error(e.data?.error || 'Unknown worker error'));
          }
        };

        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(err);
        };

        worker.postMessage({
          type: 'PARSE_ARCHIVE',
          id: reqId,
          jsonString: jsonText,
          since
        });
      } catch (err) {
        reject(err);
      }
    });
  }
}
