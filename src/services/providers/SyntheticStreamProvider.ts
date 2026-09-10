import type { LightningEvent, LightningType } from '../../types/lightning';
import type { ILightningProvider, ProviderStatus, ProviderStats } from '../../types/provider';
import { LightningNormalizer } from '../normalizer/LightningNormalizer';

interface StormCenter {
  name: string;
  latitude: number;
  longitude: number;
  spreadDeg: number; // Standard deviation for Gaussian scatter
  weight: number;
  color?: string;
}

/**
 * 5 Globally recognized real-world thunderstorm hotspots
 */
const GLOBAL_STORM_CENTERS: StormCenter[] = [
  {
    name: 'Congo Basin (DRC)',
    latitude: -1.0,
    longitude: 22.0,
    spreadDeg: 5.5,
    weight: 0.35,
    color: '#f59e0b' // Radiant amber
  },
  {
    name: 'Amazon Basin (Brazil)',
    latitude: -3.5,
    longitude: -62.0,
    spreadDeg: 6.0,
    weight: 0.25,
    color: '#f59e0b'
  },
  {
    name: 'Southeast Asia / Maritime Continent',
    latitude: 0.5,
    longitude: 115.0,
    spreadDeg: 6.5,
    weight: 0.2,
    color: '#06b6d4' // Cyan
  },
  {
    name: 'Florida & Gulf of Mexico',
    latitude: 27.5,
    longitude: -82.0,
    spreadDeg: 4.5,
    weight: 0.12,
    color: '#60a5fa' // Electric blue
  },
  {
    name: 'Mediterranean Storm Front',
    latitude: 36.0,
    longitude: 18.0,
    spreadDeg: 4.0,
    weight: 0.08,
    color: '#f59e0b'
  }
];

/**
 * SyntheticStreamProvider: Generates mathematically modeled real-world lightning strikes.
 * Employs Poisson point-process intervals and Box-Muller Gaussian spatial clustering.
 * Strictly adheres to ILightningProvider interface.
 */
export class SyntheticStreamProvider implements ILightningProvider {
  public readonly id = 'provider-synthetic-global';
  public readonly name = 'Global Synthetic Stream (Clustered Hotspots)';
  public status: ProviderStatus = 'OFFLINE';

  private eventListeners: Set<(event: LightningEvent) => void> = new Set();
  private statusListeners: Set<(status: ProviderStatus) => void> = new Set();

  private isRunning: boolean = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private statsTimerId: ReturnType<typeof setInterval> | null = null;

  private totalEventsReceived: number = 0;
  private lastEventTimestamp: number | null = null;
  private eventsInWindow: number = 0;
  private currentEventsPerSec: number = 0;

  // Mean interval between strikes (125ms -> ~8 strikes/sec)
  private readonly targetRatePerSec: number;

  constructor(targetRatePerSec: number = 8) {
    this.targetRatePerSec = Math.max(1, Math.min(50, targetRatePerSec));
  }

  public async connect(): Promise<void> {
    if (this.isRunning) return;

    this.setStatus('CONNECTING');

    // Simulate realistic network handshake delay (300ms)
    await new Promise((resolve) => setTimeout(resolve, 300));

    this.isRunning = true;
    this.setStatus('DEMO');

    // Windowed throughput calculator (updates every second)
    this.statsTimerId = setInterval(() => {
      this.currentEventsPerSec = this.eventsInWindow;
      this.eventsInWindow = 0;
    }, 1000);

    // Start event emission loop
    this.scheduleNextStrike();
  }

  public disconnect(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.statsTimerId !== null) {
      clearInterval(this.statsTimerId);
      this.statsTimerId = null;
    }
    this.currentEventsPerSec = 0;
    this.setStatus('OFFLINE');
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

  private setStatus(newStatus: ProviderStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(this.status);
      } catch (err) {
        console.error('Status listener error:', err);
      }
    }
  }

  private scheduleNextStrike(): void {
    if (!this.isRunning) return;

    // Poisson process exponential interval: -ln(1 - U) / rate
    const meanIntervalMs = 1000 / this.targetRatePerSec;
    const u = Math.max(0.0001, Math.random());
    const intervalMs = Math.round(-Math.log(u) * meanIntervalMs);

    this.timerId = setTimeout(() => {
      this.generateAndEmitStrike();
      this.scheduleNextStrike();
    }, intervalMs);
  }

  private generateAndEmitStrike(): void {
    if (!this.isRunning) return;

    // 1. Pick a storm center based on probabilistic weight
    const center = this.selectStormCenter();

    // 2. Scatter position using Box-Muller Gaussian distribution
    const lat = this.gaussianRandom(center.latitude, center.spreadDeg);
    const lon = this.gaussianRandom(center.longitude, center.spreadDeg);

    // 3. Peak current (log-normal distribution approximation: 10 to 120 kA)
    const polarity = Math.random() > 0.1 ? -1 : 1; // 90% of strikes are negative CG
    const currentMagnitude = 15 + Math.abs(this.gaussianRandom(15, 12));
    const peakCurrent = polarity * currentMagnitude;

    // 4. Type: 75% Cloud-to-Ground, 25% Intracloud
    const type: LightningType = Math.random() > 0.25 ? 'CG' : 'IC';

    const timestamp = Date.now();

    // 5. Pass through LightningNormalizer validation pipeline
    const rawPacket = {
      id: `syn_${timestamp}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp,
      latitude: lat,
      longitude: lon,
      peakCurrent,
      type,
      source: 'synthetic',
      color: center.color
    };

    const validatedEvent = LightningNormalizer.normalize(rawPacket, 'synthetic');

    if (validatedEvent) {
      this.totalEventsReceived++;
      this.eventsInWindow++;
      this.lastEventTimestamp = timestamp;

      for (const listener of this.eventListeners) {
        try {
          listener(validatedEvent);
        } catch (err) {
          console.error('Event listener error:', err);
        }
      }
    }
  }

  private selectStormCenter(): StormCenter {
    const r = Math.random();
    let cumulative = 0;
    for (const center of GLOBAL_STORM_CENTERS) {
      cumulative += center.weight;
      if (r <= cumulative) return center;
    }
    return GLOBAL_STORM_CENTERS[0];
  }

  /**
   * Box-Muller Gaussian pseudo-random generator
   */
  private gaussianRandom(mean: number, stdev: number): number {
    const u1 = Math.max(0.0001, Math.random());
    const u2 = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z * stdev;
  }
}
