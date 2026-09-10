import type { LightningEvent } from '../../types/lightning';
import type { ILightningProvider, ProviderStatus, ProviderStats } from '../../types/provider';
import { LightningNormalizer } from '../normalizer/LightningNormalizer';
import { StochasticPacingQueue } from './StochasticPacingQueue';

export interface Goes18GlmConfig {
  endpoint?: string;
  pollingIntervalMs?: number;
  enableSimulationFallback?: boolean;
  maxEventsPerBatch?: number;
}

interface GlmFlashRaw {
  id?: string;
  lat: number;
  lon: number;
  time?: number;
  energy_j?: number;
  area_km2?: number;
}

/**
 * Goes18GlmProvider: Ingestion adapter for NOAA GOES-18 (GOES-West) Geostationary Lightning Mapper.
 * Covers the Pacific Ocean, Western USA (CA, OR, WA, NV, AZ), Alaska, Hawaii, and Eastern Oceania.
 */
export class Goes18GlmProvider implements ILightningProvider {
  public readonly id = 'provider-goes18-glm';
  public readonly name = 'NOAA GOES-18 GLM (Pacific & West Coast)';
  public status: ProviderStatus = 'OFFLINE';

  private readonly config: Required<Goes18GlmConfig>;
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
  private readonly pacingQueue: StochasticPacingQueue<GlmFlashRaw>;

  constructor(options?: Goes18GlmConfig) {
    this.config = {
      endpoint: options?.endpoint ?? '/api/goes18-glm/latest',
      pollingIntervalMs: options?.pollingIntervalMs ?? 20000,
      enableSimulationFallback: options?.enableSimulationFallback ?? false,
      maxEventsPerBatch: options?.maxEventsPerBatch ?? 500
    };

    this.pacingQueue = new StochasticPacingQueue<GlmFlashRaw>({
      defaultDurationMs: 20000,
      minBurstIntervalMs: 30,
      maxBurstIntervalMs: 75,
      minClusterGapMs: 250,
      maxClusterGapMs: 900,
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
        return;
      } catch {
        this.setStatus('OFFLINE');
        return;
      }
    }

    if (this.config.enableSimulationFallback) {
      this.setStatus('LIVE');
    } else {
      this.setStatus('OFFLINE');
    }
  }

  public disconnect(): void {
    this.isConnected = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.rateMeterTimer) {
      clearInterval(this.rateMeterTimer);
      this.rateMeterTimer = null;
    }
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

  private convertRawToEvent(flash: GlmFlashRaw): LightningEvent | null {
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
        id: flash.id || `glm18_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        latitude: flash.lat,
        longitude: flash.lon,
        timestamp: flash.time ?? Date.now(),
        peakCurrent: kAProxy,
        type: 'CG',
        source: 'goes18_glm',
        energy_j: energyJ,
        area_km2: areaKm2
      },
      'goes18_glm'
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
          console.error('Goes18GlmProvider subscriber error:', err);
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
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`GLM-18 endpoint returned status ${response.status}`);
    }

    const data = await response.json();
    let flashes: GlmFlashRaw[] = [];
    if (Array.isArray(data)) {
      flashes = data;
    } else if (data && typeof data === 'object' && Array.isArray(data.flashes)) {
      flashes = data.flashes;
    }

    if (flashes.length > 0) {
      const newFlashes: GlmFlashRaw[] = [];
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
          20000
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
        console.error('Goes18GlmProvider status listener error:', err);
      }
    }
  }

  private updateThroughputMeter(): void {
    const oneSecondAgo = Date.now() - 1000;
    this.recentTimestamps = this.recentTimestamps.filter((t) => t > oneSecondAgo);
    this.currentEps = this.recentTimestamps.length;
  }
}
