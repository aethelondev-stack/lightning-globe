import * as THREE from 'three';
import { CameraController } from './CameraController';
import type { IUpdatable } from '../types';

export interface ControlsConfig {
  enableDamping?: boolean;
  dampingFactor?: number;
  rotateSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  enablePan?: boolean;
}

/**
 * Precision Globe Controller conforming to v4 Specification.
 * Authoritative camera kinematics powered by CameraController.
 */
export class ControlsManager implements IUpdatable {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly domElement: HTMLElement;
  public readonly cameraController: CameraController;
  public readonly target: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  public enabled: boolean = true;
  public minDistance: number;
  public maxDistance: number;
  private pitchAngleDeg: number = 0;
  private lastUpdateTimestamp: number = 0;

  // Callbacks
  private readonly interactionCallbacks: Set<() => void> = new Set();
  private readonly distanceCallbacks: Set<(distance: number) => void> = new Set();

  // Backward-compatibility proxy for legacy OrbitControls interfaces
  public readonly controls: {
    enabled: boolean;
    target: THREE.Vector3;
    minDistance: number;
    maxDistance: number;
    rotateSpeed: number;
    enableDamping: boolean;
    dampingFactor: number;
    enablePan: boolean;
    update: () => void;
    dispose: () => void;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  };

  public get cameraControls(): any {
    return {
      enabled: this.enabled,
      minDistance: this.minDistance,
      maxDistance: this.maxDistance,
      distance: this.cameraController.currentDistance,
      setTarget: (x: number, y: number, z: number) => {
        this.target.set(x, y, z);
      },
      setLookAt: async (eyeX: number, eyeY: number, eyeZ: number, targetX: number, targetY: number, targetZ: number) => {
        const eye = new THREE.Vector3(eyeX, eyeY, eyeZ);
        const look = new THREE.Vector3(targetX, targetY, targetZ);
        await this.flyTo(eye, look, false);
      },
      dollyTo: (dist: number) => {
        this.cameraController.targetDistance = dist;
      },
      rotate: (azimuth: number, polar: number) => {
        this.cameraController.currentLon += azimuth * (180 / Math.PI);
        this.cameraController.currentLat += polar * (180 / Math.PI);
      },
      update: (dt: number) => {
        this.cameraController.update(dt);
      },
      dispose: () => {
        this.cameraController.destroy();
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }

  constructor(camera: THREE.Camera, domElement: HTMLElement, config?: ControlsConfig | CameraController) {
    this.camera = camera as THREE.PerspectiveCamera;
    this.domElement = domElement;

    if (config instanceof CameraController) {
      this.cameraController = config;
      this.minDistance = config.minDistance;
      this.maxDistance = config.maxDistance;
    } else {
      this.minDistance = config?.minDistance ?? 1.12 * 100;
      this.maxDistance = config?.maxDistance ?? 5.00 * 100;
      this.cameraController = new CameraController(this.camera, this.domElement, 100);
    }

    this.cameraController.setOnUserInteraction(() => {
      for (const cb of this.interactionCallbacks) {
        cb();
      }
    });

    const self = this;
    this.controls = {
      get enabled() { return self.enabled; },
      set enabled(val: boolean) { self.setEnabled(val); },
      target: this.target,
      get minDistance() { return self.minDistance; },
      set minDistance(val: number) {
        self.minDistance = val;
      },
      get maxDistance() { return self.maxDistance; },
      set maxDistance(val: number) {
        self.maxDistance = val;
      },
      get rotateSpeed() { return 0.85; },
      set rotateSpeed(_val: number) {},
      get enableDamping() { return true; },
      set enableDamping(_val: boolean) {},
      get dampingFactor() { return 0.045; },
      set dampingFactor(_val: number) {},
      get enablePan() { return false; },
      set enablePan(_val: boolean) {},
      update: () => this.update(0.016),
      dispose: () => this.destroy(),
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'start') {
          this.interactionCallbacks.add(listener);
        }
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === 'start') {
          this.interactionCallbacks.delete(listener);
        }
      }
    };
  }

  /**
   * Programmatic flyTo transition conforming to v4 specification.
   */
  public async flyTo(
    eye: THREE.Vector3,
    lookTarget: THREE.Vector3,
    enableTransition: boolean = true,
    tilt?: number,
    duration?: number,
    earlyDistanceLandingSec?: number
  ): Promise<boolean> {
    const coords = this.cameraController.vector3ToLatLon(lookTarget.lengthSq() > 0 ? lookTarget : eye);
    const dist = eye.length();
    this.target.copy(lookTarget);

    const resolvedTilt = tilt !== undefined ? tilt : (this.pitchAngleDeg / 75);
    this.pitchAngleDeg = Math.round(resolvedTilt * 75);
    this.cameraController.manualTiltOverride = true;

    if (enableTransition) {
      await this.cameraController.flyTo({
        lat: coords.lat,
        lon: coords.lon,
        distance: dist,
        tilt: resolvedTilt,
        duration,
        earlyDistanceLandingSec
      });
    } else {
      this.cameraController.currentLat = coords.lat;
      this.cameraController.currentLon = coords.lon;
      this.cameraController.currentDistance = dist;
      this.cameraController.targetDistance = dist;
      this.cameraController.manualTiltOverride = true;
      this.cameraController.currentTilt = resolvedTilt;
      this.cameraController.update(0.016);
    }
    return true;
  }

  public rotate(azimuth: number, polar: number): void {
    this.cameraController.currentLon += azimuth * (180 / Math.PI);
    this.cameraController.currentLat += polar * (180 / Math.PI);
  }

  public setLookAtInstant(eye: THREE.Vector3, lookTarget: THREE.Vector3): void {
    const coords = this.cameraController.vector3ToLatLon(lookTarget.lengthSq() > 0 ? lookTarget : eye);
    const dist = eye.length();
    this.target.copy(lookTarget);
    this.cameraController.currentLat = coords.lat;
    this.cameraController.currentLon = coords.lon;
    this.cameraController.currentDistance = dist;
    this.cameraController.targetDistance = dist;
    this.cameraController.update(0.016);
  }

  public adoptCamera(position: THREE.Vector3, _lookTarget?: THREE.Vector3, pitchDeg?: number): void {
    const coords = this.cameraController.vector3ToLatLon(position);
    this.cameraController.currentLat = coords.lat;
    this.cameraController.currentLon = coords.lon;
    this.cameraController.currentDistance = position.length();
    this.cameraController.targetDistance = position.length();
    if (pitchDeg !== undefined) {
      this.pitchAngleDeg = Math.max(0, Math.min(75, pitchDeg));
      this.cameraController.manualTiltOverride = true;
      this.cameraController.currentTilt = this.pitchAngleDeg / 75;
    }
    this.cameraController.update(0.016);
  }

  public syncTarget(target?: THREE.Vector3): void {
    if (target) {
      this.target.copy(target);
    } else {
      this.target.set(0, 0, 0);
    }
  }

  public getTarget(): THREE.Vector3 {
    return this.target;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setPitchAngle(degrees: number, animate: boolean = false): Promise<void> {
    this.pitchAngleDeg = Math.max(0, Math.min(75, Math.round(degrees)));
    const normalizedTilt = this.pitchAngleDeg / 75;
    return this.cameraController.setTilt(normalizedTilt, animate);
  }

  public getPitchAngle(): number {
    return this.pitchAngleDeg;
  }

  public setDistance(dist: number, enableTransition: boolean = false): void {
    const clamped = Math.max(this.minDistance, Math.min(this.maxDistance, Math.round(dist)));
    if (enableTransition) {
      this.cameraController.flyTo({ distance: clamped });
    } else {
      this.cameraController.targetDistance = clamped;
      this.cameraController.currentDistance = clamped;
    }
  }

  public getDistance(): number {
    return Math.round(this.cameraController.currentDistance);
  }

  public update(delta: number = 0.016): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastUpdateTimestamp < 1) {
      return;
    }
    this.lastUpdateTimestamp = now;

    this.cameraController.update(delta);
    const dist = this.cameraController.currentDistance;
    for (const cb of this.distanceCallbacks) {
      cb(dist);
    }
  }

  public onInteraction(callback: () => void): () => void {
    this.interactionCallbacks.add(callback);
    return () => {
      this.interactionCallbacks.delete(callback);
    };
  }

  public onDistanceChange(callback: (distance: number) => void): () => void {
    this.distanceCallbacks.add(callback);
    return () => {
      this.distanceCallbacks.delete(callback);
    };
  }

  public destroy(): void {
    this.cameraController.destroy();
    this.interactionCallbacks.clear();
    this.distanceCallbacks.clear();
  }
}
