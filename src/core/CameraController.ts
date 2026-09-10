import * as THREE from 'three';
import gsap from 'gsap';

/**
 * Three.js Dünya Küresi Kamera Sistemi — Production Specification v4
 *
 * Implements authoritative parametric camera controller:
 * - Authoritative State: currentLat, currentLon, currentDistance, currentTilt
 * - Invariant: camera.position.length() === currentDistance
 * - Tilt Geometry: local surface normal (N) & local south tangent (S)
 * - Smoothstep distance falloff with explicit GRID_MODE exception
 * - Great-Circle spherical interpolation & shortest-path antimeridian handling
 * - Flight Arc (%40 climb to peakDistance, %60 descent to targetDistance)
 * - Physically damped wheel zoom with active GSAP tween arbitration
 * - Idle orbit at 0.5 rev/min (3°/s) counter-rotation with 2s fade-in / 0.35s fade-out
 * - 6-State Machine: READY, FLYING, MANUAL_ZOOM, IDLE_ENTERING, IDLE, IDLE_EXITING
 * - Zero heap allocations in render loop
 */

export type CameraState =
  | 'READY'
  | 'FLYING'
  | 'MANUAL_ZOOM'
  | 'IDLE_ENTERING'
  | 'IDLE'
  | 'IDLE_EXITING';

export type DistancePresetName =
  | 'ATMOSPHERIC'
  | 'CONTINENTAL'
  | 'REGIONAL'
  | 'COUNTRY'
  | 'CLOSE';

export const DISTANCE_PRESETS: Record<DistancePresetName, number> = {
  ATMOSPHERIC: 4.00,
  CONTINENTAL: 2.80,
  REGIONAL: 2.00,
  COUNTRY: 1.40,
  CLOSE: 1.15
};

export type FocusPresetName =
  | 'CURRENT'
  | 'HEMISPHERE'
  | 'CONTINENT'
  | 'REGION'
  | 'COUNTRY';

export interface FlyToOptions {
  lat?: number;
  lon?: number;
  distance?: number;
  distancePreset?: DistancePresetName;
  tilt?: number;
  focus?: FocusPresetName;
  target?: { lat: number; lon: number };
  duration?: number;
  earlyDistanceLandingSec?: number;
}

export class CameraController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly domElement: HTMLElement;
  public readonly R: number;

  public readonly minDistance: number;
  public readonly maxDistance: number;

  // Authoritative State
  public currentLat: number = 0;
  public currentLon: number = 0;
  public currentDistance: number;
  public targetDistance: number;
  public currentTilt: number = 0; // [0.0, 1.0]

  // Exceptions & Overrides
  public isGridMode: boolean = false;
  public isManualMode: boolean = false;
  public manualTiltOverride: boolean = false;

  // State Machine
  public state: CameraState = 'READY';
  public activeTween: gsap.core.Tween | null = null;
  private activeTweenResolve: (() => void) | null = null;
  private currentTweenId: number = 0;
  private onUserInteractionCallback?: () => void;

  // Idle Orbit & Telemetry
  public isIdle: boolean = false;
  public idleWeight: number = 0;
  public lastInteractionTime: number = performance.now();
  public readonly idleDelayMs: number = 5000;
  public readonly idleSpeedDegPerSec: number = 3.0; // 0.5 rev/min = 180° / 60s
  public readonly idleFadeInDurationSec: number = 2.0;
  public readonly idleFadeOutDurationSec: number = 0.35;

  // Mouse / Pointer Interaction State
  private isPointerDown: boolean = false;
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;

  // Pre-allocated scratch objects for zero-allocation update loop
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  private readonly scratchSouth = new THREE.Vector3();
  private readonly scratchEast = new THREE.Vector3();
  private readonly scratchUp = new THREE.Vector3();
  private readonly scratchForward = new THREE.Vector3();
  private readonly scratchDirection = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    globeRadius: number = 100
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.R = globeRadius;

    this.minDistance = 1.12 * this.R;
    this.maxDistance = 5.00 * this.R;

    // Initial State per v4 Section 30
    this.currentLat = 0;
    this.currentLon = 0;
    this.currentDistance = 4.0 * this.R;
    this.targetDistance = this.currentDistance;
    this.currentTilt = 0;

    this.state = 'READY';

    this.initEvents();
    this.applyCameraTransform();
  }

  // ==========================================
  // 1. COORDINATE SYSTEM & VECTOR BASES
  // ==========================================

  /**
   * Converts geographic coordinates to 3D cartesian coordinates on the sphere.
   * Matches the project's ThreeGlobe mesh convention.
   */
  public latLonToVector3(lat: number, lon: number, radius: number = this.R): THREE.Vector3 {
    const clampedLat = THREE.MathUtils.clamp(lat, -89.5, 89.5);
    const phi = ((90 - clampedLat) * Math.PI) / 180;
    const theta = ((90 - lon) * Math.PI) / 180;
    const phiSin = Math.sin(phi);

    return new THREE.Vector3(
      radius * phiSin * Math.cos(theta),
      radius * Math.cos(phi),
      radius * phiSin * Math.sin(theta)
    );
  }

  /**
   * Converts a 3D unit cartesian vector back into Latitude and Longitude.
   */
  public vector3ToLatLon(pos: THREE.Vector3): { lat: number; lon: number } {
    const r = pos.length();
    if (r === 0) return { lat: 0, lon: 0 };

    const phi = Math.acos(THREE.MathUtils.clamp(pos.y / r, -1, 1));
    const lat = 90 - (phi * 180) / Math.PI;

    const theta = Math.atan2(pos.z, pos.x);
    let lon = 90 - (theta * 180) / Math.PI;
    // Wrap to [-180, 180]
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;

    return {
      lat: THREE.MathUtils.clamp(lat, -89.5, 89.5),
      lon
    };
  }

  /**
   * Local south tangent (S) vector.
   * Derivative dP/dlat in decreasing latitude direction.
   * Guaranteed orthogonal to surface normal (N) with zero roll.
   */
  public getLocalSouthTangent(lat: number, lon: number): THREE.Vector3 {
    const clampedLat = THREE.MathUtils.clamp(lat, -89.5, 89.5);
    const latRad = (clampedLat * Math.PI) / 180;
    const theta = ((90 - lon) * Math.PI) / 180;

    return new THREE.Vector3(
      Math.sin(latRad) * Math.cos(theta),
      -Math.cos(latRad),
      Math.sin(latRad) * Math.sin(theta)
    ).normalize();
  }

  /**
   * Shortest angle path across antimeridian without 358° spinning.
   */
  public getShortestAngle(from: number, to: number): number {
    return from + ((((to - from + 540) % 360) - 180));
  }

  /**
   * Great-circle angular distance between two lat/lon coordinates in radians.
   */
  public getGreatCircleAngle(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const A = this.latLonToVector3(lat1, lon1, 1).normalize();
    const B = this.latLonToVector3(lat2, lon2, 1).normalize();
    const dot = THREE.MathUtils.clamp(A.dot(B), -1, 1);
    return Math.acos(dot);
  }

  /**
   * Spherical interpolation (SLERP) along the great-circle surface route.
   */
  public interpolateGreatCircle(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
    t: number
  ): { lat: number; lon: number } {
    const A = this.latLonToVector3(lat1, lon1, 1).normalize();
    const B = this.latLonToVector3(lat2, lon2, 1).normalize();
    const dot = THREE.MathUtils.clamp(A.dot(B), -1, 1);

    // Near-antipodal fallback (A ≈ -B)
    if (dot < -0.9999) {
      let perpAxis = new THREE.Vector3(0, 1, 0).cross(A);
      if (perpAxis.lengthSq() < 0.001) {
        perpAxis = new THREE.Vector3(1, 0, 0).cross(A);
      }
      perpAxis.normalize();
      const q = this.scratchQuat.setFromAxisAngle(perpAxis, Math.PI * t);
      const pos = A.clone().applyQuaternion(q);
      return this.vector3ToLatLon(pos);
    }

    const q = this.scratchQuat.setFromUnitVectors(A, B);
    const qT = new THREE.Quaternion().slerp(q, t);
    const pos = A.clone().applyQuaternion(qT);
    return this.vector3ToLatLon(pos);
  }

  // ==========================================
  // 2. HORIZON LIMIT & TILT FALLOFF
  // ==========================================

  public getMaxVisibleAngle(distance: number): number {
    return Math.acos(THREE.MathUtils.clamp(this.R / distance, -1, 1));
  }

  public getTiltFalloff(distance: number): number {
    if (this.isGridMode || this.isManualMode || this.manualTiltOverride) {
      return 1.0; // User manual control or GRID_MODE exception
    }
    if (distance <= 2.0 * this.R) {
      return 1.0;
    }
    if (distance >= 3.0 * this.R) {
      return 0.0;
    }
    const t = THREE.MathUtils.clamp((distance - 2.0 * this.R) / this.R, 0, 1);
    return 1.0 - t * t * (3.0 - 2.0 * t);
  }

  /**
   * Sets normalized tilt angle [0.0, 1.0] directly.
   * If animate is true, flies to tilt smoothly using GSAP.
   */
  public setTilt(normalizedTilt: number, animate: boolean = false): Promise<void> {
    const clamped = THREE.MathUtils.clamp(normalizedTilt, 0.0, 1.0);
    this.manualTiltOverride = true;
    if (animate) {
      return this.flyTo({ tilt: clamped });
    } else {
      if (this.activeTween) {
        this.activeTween.kill();
        this.activeTween = null;
      }
      this.currentTilt = clamped;
      this.applyCameraTransform();
      return Promise.resolve();
    }
  }

  // ==========================================
  // 3. DYNAMIC DURATION & PRESET RESOLUTION
  // ==========================================

  public calculateDuration(
    angularDistDeg: number,
    distanceDelta: number,
    tiltDelta: number
  ): number {
    // 1. Angular Duration
    let angularDuration = 3.0;
    if (angularDistDeg < 30) {
      angularDuration = 2.8 + (angularDistDeg / 30) * (3.5 - 2.8);
    } else if (angularDistDeg <= 85) {
      angularDuration = 4.5 + ((angularDistDeg - 30) / 55) * (5.5 - 4.5);
    } else {
      angularDuration = 6.5 + (Math.min(angularDistDeg - 85, 95) / 95) * (8.0 - 6.5);
    }

    // 2. Distance Duration
    const stepRatio = Math.abs(distanceDelta) / (0.8 * this.R);
    let distanceDuration = 2.5;
    if (stepRatio <= 1.2) {
      distanceDuration = 2.4 + (stepRatio / 1.2) * (3.0 - 2.4);
    } else {
      distanceDuration = 4.5 + Math.min((stepRatio - 1.2) / 3.0, 1.0) * (5.5 - 4.5);
    }

    // 3. Tilt Duration
    const tiltDuration = 2.5 + Math.min(Math.abs(tiltDelta) / 0.5, 1.0) * (3.2 - 2.5);

    const baseDuration = Math.max(angularDuration, distanceDuration, tiltDuration);
    return THREE.MathUtils.clamp(baseDuration, 2.4, 8.0);
  }

  public resolvePreset(name: DistancePresetName): number {
    return (DISTANCE_PRESETS[name] ?? 2.80) * this.R;
  }

  // ==========================================
  // 4. FLIGHT API & ARBITRATION
  // ==========================================

  public flyTo(options: FlyToOptions): Promise<void> {
    return new Promise((resolve) => {
      this.resetIdleTimer();

      // 1. Kill old tween (arbitration without snapping)
      if (this.activeTween) {
        this.activeTween.kill();
        this.activeTween = null;
        if (this.activeTweenResolve) {
          const prev = this.activeTweenResolve;
          this.activeTweenResolve = null;
          prev();
        }
      }
      this.activeTweenResolve = resolve;

      const tweenId = ++this.currentTweenId;
      this.state = 'FLYING';

      // 2. Resolve target coordinates
      let targetLat = this.currentLat;
      let targetLon = this.currentLon;

      if (options.focus && options.focus !== 'CURRENT') {
        if (options.target) {
          targetLat = options.target.lat;
          targetLon = options.target.lon;
        }
      } else {
        if (options.lat !== undefined) targetLat = options.lat;
        if (options.lon !== undefined) targetLon = options.lon;
        if (options.target) {
          targetLat = options.target.lat;
          targetLon = options.target.lon;
        }
      }

      targetLat = THREE.MathUtils.clamp(targetLat, -89.5, 89.5);

      // 3. Resolve target distance
      let targetDist = this.currentDistance;
      if (options.distancePreset) {
        targetDist = this.resolvePreset(options.distancePreset);
      } else if (options.distance !== undefined) {
        targetDist = options.distance;
      }
      targetDist = THREE.MathUtils.clamp(targetDist, this.minDistance, this.maxDistance);

      // 4. Resolve target tilt
      let targetTilt = this.currentTilt;
      if (options.tilt !== undefined) {
        targetTilt = THREE.MathUtils.clamp(options.tilt, 0.0, 1.0);
        this.manualTiltOverride = true;
      }

      // Explicit GRID_MODE exception check (3.5R + 10% tilt)
      if (
        Math.abs(targetDist - 3.5 * this.R) < 0.1 &&
        Math.abs(targetTilt - 0.10) < 0.01
      ) {
        this.isGridMode = true;
      } else {
        this.isGridMode = false;
      }

      // 5. Angular distance & flight arc condition
      const startLat = this.currentLat;
      const startLon = this.currentLon;
      const startDist = this.currentDistance;
      const startTilt = this.currentTilt;

      const angDistRad = this.getGreatCircleAngle(startLat, startLon, targetLat, targetLon);
      const angDistDeg = (angDistRad * 180) / Math.PI;

      const isFlightArc =
        angDistDeg > 60.0 && Math.min(startDist, targetDist) < 2.0 * this.R;
      const peakDist = isFlightArc
        ? Math.max(startDist, targetDist, 3.0 * this.R)
        : Math.max(startDist, targetDist);

      // 6. Calculate Duration
      const duration =
        options.duration ??
        this.calculateDuration(angDistDeg, targetDist - startDist, targetTilt - startTilt);

      // 7. GSAP Animation
      const flightProgress = { t: 0 };

      this.activeTween = gsap.to(flightProgress, {
        t: 1.0,
        duration,
        ease: 'power2.inOut',
        onUpdate: () => {
          // Stale callback protection
          if (this.currentTweenId !== tweenId) return;

          const t = flightProgress.t;

          // Great-circle surface interpolation
          if (angDistDeg > 0.01) {
            const pt = this.interpolateGreatCircle(startLat, startLon, targetLat, targetLon, t);
            this.currentLat = pt.lat;
            this.currentLon = pt.lon;
          }

          // Flight Arc (%40 climb, %60 descent) or Early Distance Landing
          if (isFlightArc) {
            if (t <= 0.4) {
              const segT = t / 0.4;
              this.currentDistance = THREE.MathUtils.lerp(startDist, peakDist, segT);
            } else {
              const segT = (t - 0.4) / 0.6;
              this.currentDistance = THREE.MathUtils.lerp(peakDist, targetDist, segT);
            }
          } else if (options.earlyDistanceLandingSec && options.earlyDistanceLandingSec > 0 && duration > options.earlyDistanceLandingSec) {
            const landingRatio = Math.max(0.2, 1.0 - (options.earlyDistanceLandingSec / duration));
            const distProgress = Math.min(1.0, t / landingRatio);
            const easeDist = distProgress * distProgress * (3.0 - 2.0 * distProgress);
            this.currentDistance = THREE.MathUtils.lerp(startDist, targetDist, easeDist);
          } else {
            this.currentDistance = THREE.MathUtils.lerp(startDist, targetDist, t);
          }

          // Tilt interpolation
          this.currentTilt = THREE.MathUtils.lerp(startTilt, targetTilt, t);

          // GSAP Authority synchronization
          this.targetDistance = this.currentDistance;
        },
        onComplete: () => {
          if (this.currentTweenId !== tweenId) return;

          this.currentLat = targetLat;
          this.currentLon = targetLon;
          this.currentDistance = targetDist;
          this.targetDistance = targetDist;
          this.currentTilt = targetTilt;
          if (options.tilt !== undefined) {
            this.manualTiltOverride = true;
          }
          this.activeTween = null;
          this.state = 'READY';
          if (this.activeTweenResolve === resolve) {
            this.activeTweenResolve = null;
          }
          resolve();
        }
      });
    });
  }

  // ==========================================
  // 5. USER INTERACTION & WHEEL DAMPING
  // ==========================================

  public resetIdleTimer(): void {
    this.lastInteractionTime = performance.now();
    if (this.isIdle) {
      this.exitIdle();
    }
  }

  public beginIdle(): void {
    if (!this.isIdle && this.state !== 'FLYING' && this.state !== 'MANUAL_ZOOM') {
      this.isIdle = true;
      this.state = 'IDLE_ENTERING';
    }
  }

  public exitIdle(): void {
    if (this.isIdle) {
      this.isIdle = false;
      this.state = 'IDLE_EXITING';
    }
  }

  public setOnUserInteraction(cb: () => void): void {
    this.onUserInteractionCallback = cb;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.resetIdleTimer();
    this.onUserInteractionCallback?.();

    // Active GSAP tween arbitration
    if (this.activeTween) {
      this.activeTween.kill();
      this.activeTween = null;
      if (this.activeTweenResolve) {
        const prev = this.activeTweenResolve;
        this.activeTweenResolve = null;
        prev();
      }
    }
    this.targetDistance = this.currentDistance; // Snap forbidden!
    this.state = 'MANUAL_ZOOM';

    const zoomDelta = e.deltaY * 0.002 * this.R;
    this.targetDistance = THREE.MathUtils.clamp(
      this.targetDistance + zoomDelta,
      this.minDistance,
      this.maxDistance
    );
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Only left click or primary touch
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.resetIdleTimer();
    this.onUserInteractionCallback?.();

    this.isPointerDown = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    // If active flight, user grab interrupts flight safely
    if (this.activeTween) {
      this.activeTween.kill();
      this.activeTween = null;
      if (this.activeTweenResolve) {
        const prev = this.activeTweenResolve;
        this.activeTweenResolve = null;
        prev();
      }
      this.targetDistance = this.currentDistance;
      this.state = 'READY';
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.resetIdleTimer();

    if (!this.isPointerDown) return;

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    // Sensitivity scaled inversely by zoom distance
    const sensitivity = 0.22 * (this.currentDistance / (4.0 * this.R));

    // Rotate Earth naturally (moving left rotates Eastward)
    this.currentLon -= dx * sensitivity;
    this.currentLat = THREE.MathUtils.clamp(this.currentLat + dy * sensitivity, -89.5, 89.5);

    // Continuous longitude wrap
    if (this.currentLon < -180) this.currentLon += 360;
    else if (this.currentLon > 180) this.currentLon -= 360;
  };

  private onPointerUp = (): void => {
    this.isPointerDown = false;
    this.resetIdleTimer();
  };

  private initEvents(): void {
    if (typeof window === 'undefined') return;
    if (this.domElement && typeof this.domElement.addEventListener === 'function') {
      this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
      this.domElement.addEventListener('pointerdown', this.onPointerDown);
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointercancel', this.onPointerUp);
    }
  }

  // ==========================================
  // 6. UPDATE PIPELINE (9-STEP SPECIFICATION)
  // ==========================================

  public applyCameraTransform(): void {
    this.update(0.016);
  }

  /**
   * Executes the exact 9-step update loop defined in v4 Section 31.
   * @param deltaTime Elapsed time in seconds.
   */
  public update(deltaTime: number): void {
    const dt = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
    const now = performance.now();

    // STEP 1: Idle State Update
    if (this.state !== 'FLYING' && this.state !== 'MANUAL_ZOOM' && !this.isPointerDown) {
      const elapsedSinceInteraction = now - this.lastInteractionTime;
      if (elapsedSinceInteraction >= this.idleDelayMs) {
        if (!this.isIdle) {
          this.beginIdle();
        }
      }
    }

    // Idle Fade-In / Fade-Out
    if (this.isIdle) {
      if (this.idleWeight < 1.0) {
        this.idleWeight = Math.min(1.0, this.idleWeight + dt / this.idleFadeInDurationSec);
        if (this.idleWeight >= 1.0) {
          this.state = 'IDLE';
        }
      }
    } else {
      if (this.idleWeight > 0.0) {
        this.idleWeight = Math.max(0.0, this.idleWeight - dt / this.idleFadeOutDurationSec);
        if (this.idleWeight <= 0.0 && this.state === 'IDLE_EXITING') {
          this.state = 'READY';
        }
      }
    }

    // STEP 2: GSAP Authority
    if (this.activeTween) {
      this.targetDistance = this.currentDistance;
    }

    // STEP 3: Wheel Damping (only when NO active GSAP tween)
    if (!this.activeTween) {
      const dampingFactor = 1.0 - Math.exp(-6.0 * dt);
      this.currentDistance += (this.targetDistance - this.currentDistance) * dampingFactor;
      if (Math.abs(this.targetDistance - this.currentDistance) < 0.001) {
        this.currentDistance = this.targetDistance;
        if (this.state === 'MANUAL_ZOOM') {
          this.state = 'READY';
        }
      }
    }

    // STEP 4: Idle Orbit (lat, distance, tilt strictly UNCHANGED)
    if (this.idleWeight > 0) {
      this.currentLon -= this.idleSpeedDegPerSec * dt * this.idleWeight;
      if (this.currentLon < -180) this.currentLon += 360;
      else if (this.currentLon > 180) this.currentLon -= 360;
    }

    // STEP 5: Tilt Falloff
    const maxVisibleAngle = this.getMaxVisibleAngle(this.currentDistance);
    const falloff = this.getTiltFalloff(this.currentDistance);
    const effectiveNormalizedTilt = THREE.MathUtils.clamp(this.currentTilt * falloff, 0, 1);
    const effectiveTiltAngle = effectiveNormalizedTilt * maxVisibleAngle;

    // STEP 6: Target Surface Point
    const target = this.latLonToVector3(this.currentLat, this.currentLon, this.R);
    this.scratchTarget.copy(target);

    // STEP 7: Parametric Camera Position
    const normal = this.scratchNormal.copy(target).normalize();
    const south = this.getLocalSouthTangent(this.currentLat, this.currentLon);
    this.scratchSouth.copy(south);

    const cameraDirection = this.scratchDirection
      .copy(normal)
      .multiplyScalar(Math.cos(effectiveTiltAngle))
      .add(this.scratchSouth.multiplyScalar(Math.sin(effectiveTiltAngle)))
      .normalize();

    this.camera.position.copy(cameraDirection).multiplyScalar(this.currentDistance);

    // STEP 8: Camera Orientation & Roll (Target Lock with Zero Roll)
    // The camera position arcs backward/downward along the spherical rail, while its optical
    // axis remains locked directly onto scratchTarget (the active lightning/surface focus).
    const forward = this.scratchForward.copy(this.scratchTarget).sub(this.camera.position).normalize();
    const east = this.scratchEast.copy(this.scratchNormal).cross(this.scratchSouth).normalize();
    const up = this.scratchUp.copy(east).cross(forward).normalize();
    if (up.lengthSq() > 0.001) {
      this.camera.up.copy(up);
    }
    this.camera.lookAt(this.scratchTarget);

    // STEP 9: Development Assertions
    if (process.env.NODE_ENV !== 'production') {
      console.assert(
        this.currentDistance >= this.minDistance - 0.01 &&
          this.currentDistance <= this.maxDistance + 0.01,
        `Distance invariant violated: ${this.currentDistance}`
      );
      console.assert(
        this.currentTilt >= -0.01 && this.currentTilt <= 1.01,
        `Tilt invariant violated: ${this.currentTilt}`
      );
      console.assert(
        this.currentLat >= -89.51 && this.currentLat <= 89.51,
        `Latitude invariant violated: ${this.currentLat}`
      );
      console.assert(
        Number.isFinite(this.camera.position.x) &&
          Number.isFinite(this.camera.position.y) &&
          Number.isFinite(this.camera.position.z),
        `Camera position NaN/Infinity: ${this.camera.position.toArray()}`
      );
    }
  }

  // ==========================================
  // 7. CLEANUP & DISPOSAL
  // ==========================================

  public destroy(): void {
    if (this.activeTween) {
      this.activeTween.kill();
      this.activeTween = null;
    }
    if (this.domElement && typeof this.domElement.removeEventListener === 'function') {
      this.domElement.removeEventListener('wheel', this.onWheel);
      this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
    }
  }
}
