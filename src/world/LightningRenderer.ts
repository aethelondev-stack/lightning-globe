import type ThreeGlobe from 'three-globe';
import type { LightningEvent } from '../types/lightning';
import type { IUpdatable } from '../types';
import type { CameraState, CameraTarget } from '../types/camera';
import { LightningBoltPool } from './vfx/LightningBoltPool';
import { EnergyProxy } from '../domain/energy/EnergyProxy';
import { latLngToVector3 } from '../utils/coordinates';
import { EngineConfig } from '../core/Config';
import type { StormCellRadar } from './vfx/StormCellRadar';

interface ActiveEventRecord {
  event: LightningEvent;
  expiresAt: number;
}

/**
 * High-performance batched lightning renderer on ThreeGlobe.
 * Features sliding-window TTL decay, 3D procedural bolt object pooling,
 * dynamic EnergyProxy physical scaling (Phase 20), and selective LOD triggered by camera focus.
 */
export class LightningRenderer implements IUpdatable {
  private readonly globe: ThreeGlobe;
  public readonly boltPool: LightningBoltPool;
  private stormCellRadar: StormCellRadar | null = null;

  // Camera focus context
  public cameraState: CameraState = 'IDLE';
  public cameraTarget: CameraTarget | null = null;

  // Sliding window active buffer
  private activeEvents: ActiveEventRecord[] = [];
  private incomingQueue: LightningEvent[] = [];
  private isDirty: boolean = false;

  // Configuration
  private readonly eventTtlMs: number = 1500;
  private readonly maxActiveBuffer: number = 30;
  private lastSyncTime: number = 0;
  private readonly syncIntervalMs: number = 100; // Commit to ThreeGlobe at max 10Hz to preserve 60 FPS

  constructor(globe: ThreeGlobe) {
    this.globe = globe;
    this.boltPool = new LightningBoltPool();
    this.globe.add(this.boltPool.group);
    this.setupLayers();
  }

  private setupLayers(): void {
    // Zero round white dots or pulsing rings: cleanly handled by FulguriteTraceLayer and 3D Bolt Pool
    this.globe
      .pointsData([])
      .ringsData([]);
  }

  private cameraDistance: number = 320;

  /**
   * Sets current camera distance for adaptive cloud altitude and flash scaling.
   */
  public setCameraDistance(distance: number): void {
    this.cameraDistance = distance;
    this.boltPool.setCameraDistance(distance);
  }

  /**
   * Sets the camera director's state and focus target.
   */
  public setCameraContext(state: CameraState, target: CameraTarget | null): void {
    this.cameraState = state;
    this.cameraTarget = target;
  }

  /**
   * Enqueues a single new event into the incoming buffer and triggers a 3D procedural lightning bolt.
   * Every strike produces a real 3D jagged discharge from atmosphere altitude to Earth ground.
   */
  public addEvent(event: LightningEvent): void {
    this.incomingQueue.push(event);

    // Atmospheric 3D procedural lightning discharge (Cloud -> Earth)
    // Bolt apex scaled up by 2/9 (11/9x) per user directive to ensure commanding visibility from wide planetary views
    const groundRadius = EngineConfig.globe.radius + 0.35;
    const pGround = latLngToVector3(event.latitude, event.longitude, 0, groundRadius);

    const peakCurrent = event.peakCurrent ?? -35;
    const absKa = Math.abs(peakCurrent);
    // Base altitudes scaled up by 2/9 (11/9x multiplier)
    let baseAlt: number = 10.27;
    if (absKa < 10) baseAlt = 7.33;
    else if (absKa < 35) baseAlt = 10.27;
    else if (absKa < 75) baseAlt = 13.20;
    else if (absKa < 150) baseAlt = 16.13;
    else baseAlt = 20.53;

    // Atmospheric cloud initiation point with subtle realistic tropospheric drift
    const distMult = Math.max(1.0, Math.min(1.25, this.cameraDistance / 240.0));
    const driftLat = (Math.random() - 0.5) * 0.3 * distMult;
    const driftLon = (Math.random() - 0.5) * 0.3 * distMult;
    const cloudAltFraction = (baseAlt * distMult) / groundRadius;
    const pCloud = latLngToVector3(
      event.latitude + driftLat,
      event.longitude + driftLon,
      cloudAltFraction,
      groundRadius
    );

    const polarity = event.pol ?? (peakCurrent >= 0 ? 1 : -1);
    const proxy = EnergyProxy.calculate(peakCurrent);
    const intensity = EnergyProxy.getBoltIntensity(proxy) * distMult;

    // Check if strike hits inside an active honeycomb
    let hitCellId: string | null = null;
    if (this.stormCellRadar) {
      hitCellId = this.stormCellRadar.findCellAt(event.latitude, event.longitude);
      if (hitCellId) {
        let strikeColor = LightningBoltPool.TIER_COLOR_STANDARD;
        if (absKa < 10) strikeColor = LightningBoltPool.TIER_COLOR_MINOR;
        else if (absKa < 35) strikeColor = LightningBoltPool.TIER_COLOR_STANDARD;
        else if (absKa < 75) strikeColor = LightningBoltPool.TIER_COLOR_SEVERE;
        else if (absKa < 150) strikeColor = LightningBoltPool.TIER_COLOR_VIOLENT;
        else strikeColor = LightningBoltPool.TIER_COLOR_SUPERBOLT;

        this.stormCellRadar.triggerCellStrikeImpact(hitCellId, event.latitude, event.longitude, strikeColor);
      }
    }

    // Acquire and fire 3D jagged bolt with scientific classification, polarity, and hitCellId
    this.boltPool.acquire(pCloud, pGround, intensity, undefined, Date.now(), peakCurrent, polarity, hitCellId);
  }

  public setStormCellRadar(radar: StormCellRadar | null): void {
    this.stormCellRadar = radar;
  }

  /**
   * Enqueues an array of new events into the buffer.
   */
  public addEvents(events: LightningEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      this.addEvent(events[i]);
    }
  }

  /**
   * Directly sets/overrides active events (e.g. for static benchmarks).
   */
  public renderEvents(events: LightningEvent[]): void {
    const now = Date.now();
    this.activeEvents = events.map((event) => ({
      event,
      expiresAt: now + this.eventTtlMs
    }));
    this.incomingQueue = [];
    this.syncGlobeLayers();
  }

  /**
   * Frame update: Drains queue, purges expired events, batches GPU layer updates,
   * and updates active 3D procedural bolt animations.
   */
  public update(): void {
    const now = Date.now();
    let hasChanges = false;

    // 0. Update procedural bolt pool (fading and cleanup)
    this.boltPool.update(now);

    // 1. Purge expired events
    if (this.activeEvents.length > 0) {
      const remaining: ActiveEventRecord[] = [];
      for (let i = 0; i < this.activeEvents.length; i++) {
        if (this.activeEvents[i].expiresAt > now) {
          remaining.push(this.activeEvents[i]);
        } else {
          hasChanges = true;
        }
      }
      this.activeEvents = remaining;
    }

    // 2. Ingest queued incoming events
    if (this.incomingQueue.length > 0) {
      hasChanges = true;
      for (let i = 0; i < this.incomingQueue.length; i++) {
        this.activeEvents.push({
          event: this.incomingQueue[i],
          expiresAt: now + this.eventTtlMs
        });
      }
      this.incomingQueue = [];

      // Clamp buffer to max limit to prevent unbounded memory growth
      if (this.activeEvents.length > this.maxActiveBuffer) {
        this.activeEvents = this.activeEvents.slice(
          this.activeEvents.length - this.maxActiveBuffer
        );
      }
    }

    // 3. Perform batch GPU commit only when buffer state has changed AND sync interval has elapsed
    if ((hasChanges || this.isDirty) && now - this.lastSyncTime >= this.syncIntervalMs) {
      this.syncGlobeLayers();
      this.lastSyncTime = now;
      this.isDirty = false;
    }
  }

  private globeLayersCleared: boolean = false;

  private syncGlobeLayers(): void {
    // Unstyled ThreeGlobe rings/points disabled: all rendering is exclusively handled
    // with scientific precision by LightningBoltPool, FulguriteTraceLayer, and StormCellRadar.
    if (!this.globeLayersCleared) {
      this.globe.ringsData([]);
      this.globe.pointsData([]);
      this.globeLayersCleared = true;
    }
  }

  public clear(): void {
    this.activeEvents = [];
    this.incomingQueue = [];
    this.boltPool.clear();
  }

  public getActiveCount(): number {
    return this.activeEvents.length;
  }

  public destroy(): void {
    this.clear();
    this.boltPool.destroy();
  }
}
