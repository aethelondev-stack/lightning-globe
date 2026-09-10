import * as THREE from 'three';
import { getLunarPosition, type LunarPosition } from '../../utils/moon';
import type { IUpdatable } from '../../types';

export interface MoonOptions {
  /** Visual radius of the Moon (default 14 units, balanced relative to Earth R=100) */
  radius?: number;
  /** Distance of lunar orbit from Earth center (default 420 units) */
  orbitDistance?: number;
}

/**
 * Realistic 3D Moon with Live Astronomical Positioning and Physical Sun Illumination.
 *
 * Capabilities:
 * - Real-time Ephemeris: Position dynamically calculated from current UTC timestamp.
 * - Authentic Lunar Phases: Mesh is illuminated by the scene's physical Sun (DirectionalLight).
 *   The terminator, crescent, gibbous, or full appearance corresponds exactly with the real sky.
 * - Tidally Locked: Moon's near side (facing Earth) is continuously oriented towards (0, 0, 0).
 * - Ultra High Performance: Single draw call, low polygon count (32x32 sphere), zero custom heavy shaders.
 */
export class Moon implements IUpdatable {
  public readonly mesh: THREE.Mesh;
  public readonly geometry: THREE.SphereGeometry;
  public readonly material: THREE.MeshStandardMaterial;

  private readonly orbitDistance: number;
  private currentLunarData: LunarPosition;
  private lastUpdateTime: number = 0;

  constructor(options?: MoonOptions) {
    const radius = options?.radius ?? 14;
    this.orbitDistance = options?.orbitDistance ?? 420;

    this.geometry = new THREE.SphereGeometry(radius, 32, 32);

    const textureLoader = new THREE.TextureLoader();
    const moonTexture = textureLoader.load('/textures/moon.jpg');
    moonTexture.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.MeshStandardMaterial({
      map: moonTexture,
      roughness: 0.92,
      metalness: 0.0,
      bumpScale: 0.05
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'CelestialMoon';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    // Initialize initial position and tidal orientation
    this.currentLunarData = getLunarPosition(new Date(), this.orbitDistance);
    this.updatePosition();
  }

  public update(_delta: number = 0.016): void {
    const now = performance.now();
    // Throttle ephemeris calculation to once every 2000ms (Moon orbital position changes fraction of a degree per hour)
    if (now - this.lastUpdateTime > 2000) {
      this.lastUpdateTime = now;
      this.currentLunarData = getLunarPosition(new Date(), this.orbitDistance);
      this.updatePosition();
    }
  }

  private updatePosition(): void {
    this.mesh.position.copy(this.currentLunarData.vector);
    // Tidally lock near side towards Earth center
    this.mesh.lookAt(0, 0, 0);
  }

  public getLunarData(): LunarPosition {
    return this.currentLunarData;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
