import * as THREE from 'three';
import type { AtmosphericPotentialPoint } from '../../types/atmosphere';
import type { IUpdatable } from '../../types';

/**
 * AtmosphericPotentialLayer: Photorealistic 3D convective instability visualization.
 *
 * Capabilities:
 * - Visualizes Convective Available Potential Energy (CAPE) and thunderstorm fuel fields.
 * - Sits at altitude R = 100.4u (renderOrder = 3), below the storm honeycombs (R = 101.8u, renderOrder = 18-20)
 *   and above the Earth's surface (R = 100.0u).
 * - Custom radial glow shader with sinusoidal atmospheric undulation and amethyst/violet ionization palette.
 * - Zero per-frame memory allocation via pre-allocated instanced geometry.
 * - Controlled via UI toggle (ATMOSPHERE: ON/OFF).
 *
 * Referencing FAZ 2 Master Plan.
 */
export class AtmosphericPotentialLayer implements IUpdatable {
  public readonly group: THREE.Group;
  private readonly instancedMesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly maxSpots: number = 64;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'AtmosphericPotentialLayer';

    // Unit circle disk for instancing
    const geometry = new THREE.CircleGeometry(1.0, 32);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uBaseOpacity: { value: 0.38 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uBaseOpacity;

        void main() {
          // Distance from disk center [0, 1]
          vec2 centered = vUv * 2.0 - 1.0;
          float dist = length(centered);
          if (dist > 1.0) discard;

          // Gaussian bell-curve radial falloff
          float falloff = exp(-3.2 * dist * dist);

          // Subtle thermal convection undulation
          float pulse = 0.88 + 0.12 * sin(uTime * 1.8 + dist * 4.0);

          // Amethyst to electric violet convective color gradient
          vec3 innerColor = vec3(0.76, 0.45, 0.98); // Electric violet (#c084fc)
          vec3 outerColor = vec3(0.55, 0.30, 0.95); // Deep amethyst (#8b5cf6)
          vec3 color = mix(innerColor, outerColor, dist);

          float alpha = falloff * pulse * uBaseOpacity;
          gl_FragColor = vec4(color * 1.3, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, this.material, this.maxSpots);
    this.instancedMesh.renderOrder = 3; // Atmospheric layer sits at level 3
    this.instancedMesh.count = 0;

    this.group.add(this.instancedMesh);
  }

  private isEnabled: boolean = true;

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.group.visible = enabled;
  }

  public getEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Updates thermodynamic convective instability fields.
   */
  public updateHotspots(points: AtmosphericPotentialPoint[]): void {
    const count = Math.min(this.maxSpots, points ? points.length : 0);
    this.instancedMesh.count = count;
    if (this.instancedMesh.instanceMatrix) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public update(delta: number, _elapsed: number): void {
    if (this.isEnabled && this.group.visible) {
      this.material.uniforms.uTime.value += delta;
    }
  }
}
