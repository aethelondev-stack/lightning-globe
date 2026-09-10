import * as THREE from 'three';
import { latLngToVector3 } from '../../utils/coordinates';
import type { IUpdatable } from '../../types';

export interface HistoricalTrailConfig {
  maxCapacity?: number;
  retentionWindowMs?: number; // 24 hours (86,400,000 ms)
  globeRadius?: number;       // 100.15 to hover just above surface
}

/**
 * HistoricalTrailLayer: 24-Hour Persistent Strike Trails WebGL Engine.
 * Features:
 * - Ultra-compact Float32Array ring buffer (100,000 strikes = ~1.6MB memory)
 * - Single draw-call THREE.Points with custom GLSL multi-epoch age shader
 * - Age-stratified chromatic spectrum:
 *     < 1h: Radiant golden amber / white
 *     1h - 6h: Electric cyan / cobalt
 *     6h - 24h: Deep cosmic violet / indigo with smooth opacity decay
 * - Zero GC allocation in per-frame animation loop
 */
export class HistoricalTrailLayer implements IUpdatable {
  public readonly pointsMesh: THREE.Points;
  private readonly maxCapacity: number;
  private readonly retentionMs: number;
  private readonly radius: number;

  // Compact Ring Buffer: [x, y, z] in position buffer, [ageFraction] in age buffer
  private readonly positionArray: Float32Array;
  private readonly ageArray: Float32Array;
  private readonly timestamps: Float64Array;

  private readonly positionAttr: THREE.BufferAttribute;
  private readonly ageAttr: THREE.BufferAttribute;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  private headIndex: number = 0;
  private count: number = 0;
  private isDirty: boolean = false;
  private isEnabled: boolean = true;
  private lastAgeUpdateTime: number = 0;

  constructor(config?: HistoricalTrailConfig) {
    this.maxCapacity = config?.maxCapacity ?? 100000;
    this.retentionMs = config?.retentionWindowMs ?? 24 * 60 * 60 * 1000; // 24 Hours
    this.radius = config?.globeRadius ?? 100.15;

    this.positionArray = new Float32Array(this.maxCapacity * 3);
    this.ageArray = new Float32Array(this.maxCapacity);
    this.timestamps = new Float64Array(this.maxCapacity);

    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positionArray, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.ageAttr = new THREE.BufferAttribute(this.ageArray, 1);
    this.ageAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('aAge', this.ageAttr);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aAge;
        varying float vAge;

        void main() {
          vAge = aAge;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // Scale point size based on camera distance with minimum clamp for visibility
          float baseSize = mix(7.5, 3.5, aAge);
          gl_PointSize = clamp(baseSize * (260.0 / -mvPosition.z), 2.5, 36.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAge;

        void main() {
          // Circular particle shape with gaussian falloff
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;

          // Gaussian radial density profile (soft luminous ember)
          float radial = exp(-dist * dist * 12.0);

          // Multi-epoch incandescent thermal spectrum
          vec3 color;
          if (vAge < 0.05) {
            // < 1.2 hours: Incandescent molten gold / hot plasma amber
            color = mix(vec3(1.0, 0.92, 0.45), vec3(1.0, 0.58, 0.12), vAge / 0.05);
          } else if (vAge < 0.25) {
            // 1.2h - 6h: Ionized violet-blue electrical burn
            color = mix(vec3(0.25, 0.68, 1.0), vec3(0.68, 0.22, 0.92), (vAge - 0.05) / 0.2);
          } else {
            // 6h - 24h: Smoldering volcanic ruby ember / subtle smoke stain
            color = mix(vec3(0.58, 0.14, 0.22), vec3(0.32, 0.06, 0.12), (vAge - 0.25) / 0.75);
          }

          // Hot luminous core boost
          float core = smoothstep(0.3, 0.0, dist) * 0.4;
          vec3 finalColor = color + vec3(core);

          // Soft opacity falloff
          float alpha = radial * mix(0.95, 0.08, vAge);

          gl_FragColor = vec4(finalColor, alpha);
        }
      `
    });

    this.pointsMesh = new THREE.Points(this.geometry, this.material);
    this.pointsMesh.frustumCulled = false;
  }

  /**
   * Adds a newly registered strike into the 24-hour persistent ring buffer.
   */
  public addStrike(latitude: number, longitude: number, timestamp: number): void {
    const pos = latLngToVector3(latitude, longitude, 0, this.radius);
    const idx = this.headIndex;

    this.positionArray[idx * 3] = pos.x;
    this.positionArray[idx * 3 + 1] = pos.y;
    this.positionArray[idx * 3 + 2] = pos.z;

    this.timestamps[idx] = timestamp;
    this.ageArray[idx] = 0.0; // Brand new strike

    this.headIndex = (this.headIndex + 1) % this.maxCapacity;
    if (this.count < this.maxCapacity) {
      this.count++;
      this.geometry.setDrawRange(0, this.count);
    }

    this.isDirty = true;
  }

  /**
   * Updates ages of stored points and commits buffer updates to GPU.
   * Runs in the main rendering animation loop.
   */
  public update(): void {
    if (!this.isEnabled || this.count === 0) {
      return;
    }

    const now = Date.now();

    // Recompute ages every 2 seconds to avoid unnecessary per-frame buffer re-uploads
    if (now - this.lastAgeUpdateTime > 2000 || this.isDirty) {
      this.refreshAges(now);
      this.lastAgeUpdateTime = now;

      this.positionAttr.needsUpdate = true;
      this.ageAttr.needsUpdate = true;
      this.isDirty = false;
    }
  }

  /**
   * Calculates normalized age [0.0 = now, 1.0 = 24h ago] for all active points.
   */
  public refreshAges(now: number): void {
    for (let i = 0; i < this.count; i++) {
      const elapsed = now - this.timestamps[i];
      const ageFrac = Math.max(0.0, Math.min(1.0, elapsed / this.retentionMs));
      this.ageArray[i] = ageFrac;
    }
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.pointsMesh.visible = enabled;
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public getCount(): number {
    return this.count;
  }

  public getCapacity(): number {
    return this.maxCapacity;
  }

  public getAgeAt(index: number): number {
    if (index < 0 || index >= this.count) return 0;
    return this.ageArray[index];
  }

  public destroy(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
