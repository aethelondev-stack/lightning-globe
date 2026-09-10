import type { RawLightningPacket } from '../normalizer/LightningNormalizer';
import type { DemoScenarioId, IScenarioRunner } from '../../types/scenario';

/**
 * Base helper for scenario runners with interval timer cleanup.
 */
abstract class BaseScenarioRunner implements IScenarioRunner {
  public abstract readonly id: DemoScenarioId;
  protected intervalId: number | null = null;
  protected running: boolean = false;
  protected counter: number = 0;

  public abstract start(emit: (raw: RawLightningPacket) => void): void;

  public stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.counter = 0;
  }

  public isRunning(): boolean {
    return this.running;
  }
}

/**
 * 1. SINGLE_STRIKE: Isolated strikes across distant planetary quadrants every 3s.
 * Verifies noise rejection (zero clusters formed, camera remains IDLE).
 */
export class SingleStrikeRunner extends BaseScenarioRunner {
  public readonly id: DemoScenarioId = 'SINGLE_STRIKE';

  private readonly distantLocations = [
    { lat: 38.5, lon: 15.2 },   // Mediterranean
    { lat: -25.3, lon: -54.8 }, // South America
    { lat: 14.2, lon: 112.5 },  // South China Sea
    { lat: -35.1, lon: 172.8 }, // Pacific
    { lat: 51.5, lon: 0.1 }     // Northern Europe
  ];

  public start(emit: (raw: RawLightningPacket) => void): void {
    this.stop();
    this.running = true;

    // Initial strike immediately
    this.emitNext(emit);

    // Strike every 3000ms (~0.33 strikes/sec)
    this.intervalId = window.setInterval(() => {
      this.emitNext(emit);
    }, 3000);
  }

  private emitNext(emit: (raw: RawLightningPacket) => void): void {
    const loc = this.distantLocations[this.counter % this.distantLocations.length];
    this.counter++;

    emit({
      time: Date.now(),
      lat: loc.lat,
      lon: loc.lon,
      peak_current: 25.0
    });
  }
}

/**
 * 2. LOCAL_CLUSTER: Calm, localized storm cell in Costa Rica (~35km radius) at ~2.5 strikes/sec.
 * Verifies tight local cluster formation and LOCAL camera framing.
 */
export class LocalClusterRunner extends BaseScenarioRunner {
  public readonly id: DemoScenarioId = 'LOCAL_CLUSTER';
  private readonly centerLat = 9.5;
  private readonly centerLon = -84.0;

  public start(emit: (raw: RawLightningPacket) => void): void {
    this.stop();
    this.running = true;

    // ~2.5 strikes/sec (every 400ms)
    this.intervalId = window.setInterval(() => {
      this.counter++;
      // Controlled jitter within ~30 km
      const angle = (this.counter * 137.5 * Math.PI) / 180;
      const radiusDeg = (this.counter % 5) * 0.08 + 0.15; // 0.15° to 0.47° (~16 to 52 km)
      const lat = this.centerLat + Math.cos(angle) * radiusDeg;
      const lon = this.centerLon + Math.sin(angle) * radiusDeg;

      emit({
        time: Date.now(),
        lat: Number(lat.toFixed(4)),
        lon: Number(lon.toFixed(4)),
        peak_current: 20 + (this.counter % 25)
      });
    }, 400);
  }
}

/**
 * 3. INTENSE_STORM: Congo Basin storm that suddenly escalates from 2/s to 20/s.
 * Verifies explosive growth bonus calculation and emergency interrupt threshold.
 */
export class IntenseStormRunner extends BaseScenarioRunner {
  public readonly id: DemoScenarioId = 'INTENSE_STORM';
  private readonly centerLat = -1.5;
  private readonly centerLon = 23.5;
  private startTime: number = 0;

  public start(emit: (raw: RawLightningPacket) => void): void {
    this.stop();
    this.running = true;
    this.startTime = Date.now();

    // High frequency tick (every 50ms) with dynamic rate gating
    this.intervalId = window.setInterval(() => {
      const elapsedMs = Date.now() - this.startTime;
      this.counter++;

      // Phase 1 (first 4 seconds): Low rate ~2 strikes/sec (emit on every 10th tick)
      // Phase 2 (after 4 seconds): Explosive surge ~20 strikes/sec (emit on every tick)
      if (elapsedMs < 4000 && this.counter % 10 !== 0) {
        return;
      }

      const angle = (this.counter * 111.3 * Math.PI) / 180;
      const radiusDeg = (this.counter % 8) * 0.08 + 0.05;
      const lat = this.centerLat + Math.cos(angle) * radiusDeg;
      const lon = this.centerLon + Math.sin(angle) * radiusDeg;

      emit({
        time: Date.now(),
        lat: Number(lat.toFixed(4)),
        lon: Number(lon.toFixed(4)),
        peak_current: elapsedMs >= 4000 ? 55 + (this.counter % 35) : 22.0
      });
    }, 50);
  }
}

/**
 * 4. COMPETING_STORMS: Dual simultaneous planetary superstorms (Amazon & SE Asia).
 * Verifies Presentation Queue prioritization, fair airtime, and 45s cooldown handover.
 */
export class CompetingStormsRunner extends BaseScenarioRunner {
  public readonly id: DemoScenarioId = 'COMPETING_STORMS';

  private readonly hubs = [
    { name: 'Amazon', lat: -3.2, lon: -60.5 },
    { name: 'SE Asia', lat: -0.8, lon: 114.2 }
  ];

  public start(emit: (raw: RawLightningPacket) => void): void {
    this.stop();
    this.running = true;

    // ~16 strikes/sec alternating between the two global hubs (every 62ms)
    this.intervalId = window.setInterval(() => {
      this.counter++;
      const hub = this.hubs[this.counter % 2];
      const angle = (this.counter * 97.3 * Math.PI) / 180;
      const radiusDeg = (this.counter % 6) * 0.1 + 0.05; // ~5 to 35 km

      emit({
        time: Date.now(),
        lat: Number((hub.lat + Math.cos(angle) * radiusDeg).toFixed(4)),
        lon: Number((hub.lon + Math.sin(angle) * radiusDeg).toFixed(4)),
        peak_current: 30 + (this.counter % 30)
      });
    }, 62);
  }
}

/**
 * 5. DATELINE_STORM: Storm crossing the Fiji / Tonga antimeridian (±180°).
 * Verifies spherical centroid calculation and unbroken antimeridian cluster continuity.
 */
export class DatelineStormRunner extends BaseScenarioRunner {
  public readonly id: DemoScenarioId = 'DATELINE_STORM';
  private readonly centerLat = -16.2;

  public start(emit: (raw: RawLightningPacket) => void): void {
    this.stop();
    this.running = true;

    // ~6 strikes/sec (every 165ms) alternating across +179.8° and -179.8°
    this.intervalId = window.setInterval(() => {
      this.counter++;
      const isEast = this.counter % 2 === 0;
      // Longitude strictly alternating across +-180
      const lon = isEast ? 179.75 + (this.counter % 4) * 0.06 : -179.75 - (this.counter % 4) * 0.06;
      const lat = this.centerLat + ((this.counter % 5) - 2) * 0.08;

      emit({
        time: Date.now(),
        lat: Number(lat.toFixed(4)),
        lon: Number(lon.toFixed(4)),
        peak_current: 32.0
      });
    }, 165);
  }
}

/**
 * 6. EXTREME_SURGE: High-volume stress test delivering 80-100 strikes/sec across 5 global hubs.
 * Verifies memory stability, 5,000 store ceiling, pooling efficiency, and 60 FPS preservation.
 */
export class ExtremeSurgeRunner extends BaseScenarioRunner {
  public readonly id: DemoScenarioId = 'EXTREME_SURGE';

  private readonly surgeHubs = [
    { lat: -1.0, lon: 22.0 },  // Congo
    { lat: -3.5, lon: -62.0 }, // Amazon
    { lat: 0.5, lon: 115.0 },  // SE Asia
    { lat: 27.5, lon: -82.0 }, // Florida
    { lat: 36.0, lon: 18.0 }   // Mediterranean
  ];

  public start(emit: (raw: RawLightningPacket) => void): void {
    this.stop();
    this.running = true;

    // ~90-100 strikes/sec (every 10-11ms)
    this.intervalId = window.setInterval(() => {
      this.counter++;
      const hub = this.surgeHubs[this.counter % this.surgeHubs.length];
      const angle = (this.counter * 131.7 * Math.PI) / 180;
      const radiusDeg = (this.counter % 7) * 0.15 + 0.05;

      emit({
        time: Date.now(),
        lat: Number((hub.lat + Math.cos(angle) * radiusDeg).toFixed(4)),
        lon: Number((hub.lon + Math.sin(angle) * radiusDeg).toFixed(4)),
        peak_current: 25 + (this.counter % 50)
      });
    }, 11);
  }
}

/**
 * Factory helper to instantiate all 6 scenario runners.
 */
export function createScenarioRunners(): Map<DemoScenarioId, IScenarioRunner> {
  const runners = new Map<DemoScenarioId, IScenarioRunner>();
  runners.set('SINGLE_STRIKE', new SingleStrikeRunner());
  runners.set('LOCAL_CLUSTER', new LocalClusterRunner());
  runners.set('INTENSE_STORM', new IntenseStormRunner());
  runners.set('COMPETING_STORMS', new CompetingStormsRunner());
  runners.set('DATELINE_STORM', new DatelineStormRunner());
  runners.set('EXTREME_SURGE', new ExtremeSurgeRunner());
  return runners;
}
