import type { LightningEvent } from '../../types/lightning';
import type { ILightningProvider, ProviderStatus, ProviderStats } from '../../types/provider';
import { LightningNormalizer } from '../normalizer/LightningNormalizer';
import { StochasticPacingQueue } from './StochasticPacingQueue';

export interface MtgLiConfig {
  endpoint?: string;
  pollingIntervalMs?: number;
}

interface MtgFlashRaw {
  id?: string;
  lat: number;
  lon: number;
  time?: number;
  energy_j?: number;
  area_km2?: number;
}

/**
 * MtgLiProvider: Ingestion adapter for EUMETSAT MTG-I1 (Meteosat Third Generation Imager 1) Lightning Imager (LI).
 * Covers the entire African continent (Congo Basin, Sahel, Sahara), Europe, Mediterranean Basin, and Middle East.
 */
export class MtgLiProvider implements ILightningProvider {
  public readonly id = 'provider-mtg-li';
  public readonly name = 'EUMETSAT MTG-I1 LI (Africa & Europe)';
  public status: ProviderStatus = 'OFFLINE';

  private readonly config: Required<MtgLiConfig>;
  private readonly eventListeners: Set<(event: LightningEvent) => void> = new Set();
  private readonly statusListeners: Set<(status: ProviderStatus) => void> = new Set();

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isConnected: boolean = false;

  private totalEvents: number = 0;
  private lastEventTime: number | null = null;
  private recentTimestamps: number[] = [];
  private rateMeterTimer: ReturnType<typeof setInterval> | null = null;
  private currentEps: number = 0;
  private readonly processedIds = new Set<string>();
  private readonly pacingQueue: StochasticPacingQueue<MtgFlashRaw>;

  constructor(options?: MtgLiConfig) {
    this.config = {
      endpoint: options?.endpoint ?? '/api/mtg-li/latest',
      pollingIntervalMs: options?.pollingIntervalMs ?? 30000
    };

    this.pacingQueue = new StochasticPacingQueue<MtgFlashRaw>({
      defaultDurationMs: 25000, // 25s pacing window aligned with 30s polling cycle
      minBurstIntervalMs: 35,
      maxBurstIntervalMs: 85,
      minClusterGapMs: 300,
      maxClusterGapMs: 1100,
      onEmit: (flash) => {
        this.convertRawToEvent(flash);
      }
    });
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return;
    this.isConnected = true;
    this.setStatus('CONNECTING');

    this.rateMeterTimer = setInterval(() => {
      this.updateThroughputMeter();
    }, 1000);

    const isNode = typeof window === 'undefined';
    const isRelative = this.config.endpoint.startsWith('/');
    if (isNode && isRelative) {
      this.setStatus('OFFLINE');
      return;
    }

    if (this.config.endpoint && this.config.endpoint.length > 0) {
      try {
        await this.pollEndpoint();
        this.setStatus('LIVE');
        this.pollTimer = setInterval(() => {
          this.pollEndpoint().catch(() => {
            if (this.status === 'LIVE') this.setStatus('STALE');
          });
        }, this.config.pollingIntervalMs);
      } catch {
        this.setStatus('STALE');
        this.pollTimer = setInterval(() => {
          this.pollEndpoint().catch(() => {});
        }, this.config.pollingIntervalMs);
      }
    }
  }

  public disconnect(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.rateMeterTimer) {
      clearInterval(this.rateMeterTimer);
      this.rateMeterTimer = null;
    }
    this.isConnected = false;
    this.pacingQueue.clear();
    this.setStatus('OFFLINE');
  }

  public onEvent(callback: (event: LightningEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  public onStatusChange(callback: (status: ProviderStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  public getStats(): ProviderStats {
    return {
      totalEventsReceived: this.totalEvents,
      eventsPerSecond: this.currentEps,
      lastEventTimestamp: this.lastEventTime
    };
  }


  private convertRawToEvent(flash: MtgFlashRaw): LightningEvent | null {
    const energyJ = typeof flash.energy_j === 'number' && Number.isFinite(flash.energy_j) && flash.energy_j > 0
      ? flash.energy_j
      : 1e-15;

    const areaKm2 = typeof flash.area_km2 === 'number' && Number.isFinite(flash.area_km2) && flash.area_km2 > 0
      ? flash.area_km2
      : 50;

    const logE = Math.log10(energyJ);
    const kAProxy = Math.round(Math.min(180, Math.max(12, 12 + (logE + 16) * 18)) * 10) / 10;

    const normalized = LightningNormalizer.normalize(
      {
        id: flash.id || `mtg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        latitude: flash.lat,
        longitude: flash.lon,
        timestamp: flash.time ?? Date.now(),
        peakCurrent: kAProxy,
        type: 'CG',
        source: 'mtg_li',
        energy_j: energyJ,
        area_km2: areaKm2
      },
      'mtg_li'
    );

    if (normalized) {
      this.totalEvents++;
      if (normalized.timestamp > (this.lastEventTime ?? 0)) {
        this.lastEventTime = normalized.timestamp;
      }
      this.recentTimestamps.push(Date.now());

      for (const listener of this.eventListeners) {
        try {
          listener(normalized);
        } catch (err) {
          console.error('MtgLiProvider subscriber error:', err);
        }
      }
    }

    return normalized;
  }

  private async pollEndpoint(): Promise<void> {
    if (!this.config.endpoint) return;

    const separator = this.config.endpoint.includes('?') ? '&' : '?';
    const url = this.lastEventTime
      ? `${this.config.endpoint}${separator}since=${this.lastEventTime}`
      : this.config.endpoint;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`MTG-LI endpoint returned status ${response.status}`);
    }

    const data = await response.json();
    let flashes: MtgFlashRaw[] = [];
    if (Array.isArray(data)) {
      flashes = data;
    } else if (data && typeof data === 'object' && Array.isArray(data.flashes)) {
      flashes = data.flashes;
    }

    if (flashes.length > 0) {
      const newFlashes: MtgFlashRaw[] = [];
      for (let i = 0; i < flashes.length; i++) {
        const f = flashes[i];
        const fid = f.id || `${f.lat}_${f.lon}_${f.time}`;
        if (!this.processedIds.has(fid)) {
          this.processedIds.add(fid);
          newFlashes.push(f);
        }
      }

      if (this.processedIds.size > 10000) {
        this.processedIds.clear();
      }

      if (newFlashes.length > 0) {
        this.pacingQueue.enqueueBatch(
          newFlashes.map((f) => ({ data: f, lat: f.lat, lon: f.lon })),
          150000 // 2.5 minutes organic pacing across EUMETSAT publication cycles
        );
      }

      this.setStatus('LIVE');
    }
  }

  private setStatus(newStatus: ProviderStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus);
      } catch (err) {
        console.error('MtgLiProvider status listener error:', err);
      }
    }
  }

  private updateThroughputMeter(): void {
    const oneSecondAgo = Date.now() - 1000;
    this.recentTimestamps = this.recentTimestamps.filter((t) => t > oneSecondAgo);
    this.currentEps = this.recentTimestamps.length;
  }
}
