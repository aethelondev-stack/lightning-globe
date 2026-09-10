import type { LightningEvent, LightningSource } from '../../types/lightning';
import type { ILightningProvider, ProviderStatus, ProviderStats } from '../../types/provider';
import { LightningNormalizer } from '../normalizer/LightningNormalizer';
import { StochasticPacingQueue } from './StochasticPacingQueue';

export interface RegionalFeedsConfig {
  endpoint?: string;
  pollingIntervalMs?: number;
}

interface RegionalStrikeRaw {
  id: string;
  lat: number;
  lon: number;
  time: number;
  source: 'singapore_nea' | 'japan_jma' | 'finland_fmi';
  peakCurrent?: number;
  type?: 'CG' | 'IC';
}

/**
 * RegionalFeedsProvider: Ingests real-time lightning strike observations
 * from three verified public ground networks:
 * 1. Singapore NEA (Data.gov.sg - Southeast Asia)
 * 2. Japan JMA LIDEN (East Asia / Japan / Sea of Japan)
 * 3. Finland FMI NORDLIS WFS (Scandinavia / Arctic 60°N-72°N+)
 *
 * Uses StochasticPacingQueue for organic micro-clustering and continuous natural stream.
 */
export class RegionalFeedsProvider implements ILightningProvider {
  public readonly id = 'provider-regional-feeds';
  public readonly name = 'Regional Feeds (Singapore NEA, Japan JMA, Finland FMI)';
  public status: ProviderStatus = 'OFFLINE';

  private readonly config: Required<RegionalFeedsConfig>;
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
  private readonly pacingQueue: StochasticPacingQueue<RegionalStrikeRaw>;

  constructor(options?: RegionalFeedsConfig) {
    this.config = {
      endpoint: options?.endpoint ?? '/api/regional/latest',
      pollingIntervalMs: options?.pollingIntervalMs ?? 30000
    };

    this.pacingQueue = new StochasticPacingQueue<RegionalStrikeRaw>({
      defaultDurationMs: 45000, // 45-second pacing window bridges 1-2 min polling intervals naturally
      minBurstIntervalMs: 40,
      maxBurstIntervalMs: 90,
      minClusterGapMs: 250,
      maxClusterGapMs: 950,
      onEmit: (strike) => {
        this.processStrike(strike);
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

    this.setStatus('OFFLINE');
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

  private processStrike(raw: RegionalStrikeRaw): LightningEvent | null {
    const normalized = LightningNormalizer.normalize(
      {
        id: raw.id,
        latitude: raw.lat,
        longitude: raw.lon,
        timestamp: raw.time,
        peakCurrent: raw.peakCurrent ?? 25,
        type: raw.type ?? 'CG',
        source: raw.source as LightningSource
      },
      raw.source as LightningSource
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
          console.error('RegionalFeedsProvider subscriber error:', err);
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
      throw new Error(`Regional endpoint returned status ${response.status}`);
    }

    const data = await response.json();
    let strikes: RegionalStrikeRaw[] = [];
    if (Array.isArray(data)) {
      strikes = data;
    } else if (data && typeof data === 'object' && Array.isArray(data.strikes)) {
      strikes = data.strikes;
    }

    if (strikes.length > 0) {
      const newStrikes: RegionalStrikeRaw[] = [];
      for (let i = 0; i < strikes.length; i++) {
        const s = strikes[i];
        if (!this.processedIds.has(s.id)) {
          this.processedIds.add(s.id);
          newStrikes.push(s);
        }
      }

      if (this.processedIds.size > 20000) {
        this.processedIds.clear();
      }

      if (newStrikes.length > 0) {
        this.pacingQueue.enqueueBatch(
          newStrikes.map((s) => ({ data: s, lat: s.lat, lon: s.lon })),
          45000
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
        console.error('RegionalFeedsProvider status listener error:', err);
      }
    }
  }

  private updateThroughputMeter(): void {
    const oneSecondAgo = Date.now() - 1000;
    this.recentTimestamps = this.recentTimestamps.filter((t) => t > oneSecondAgo);
    this.currentEps = this.recentTimestamps.length;
  }
}
