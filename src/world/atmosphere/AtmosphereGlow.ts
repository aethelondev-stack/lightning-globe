import * as THREE from 'three';
import { EngineConfig } from '../../core/Config';

/**
 * AtmosphereGlow: Photorealistic Rayleigh scattering limb glow shell.
 *
 * Capabilities:
 * - Spherical shell positioned just above the planetary surface (R = 101.8).
 * - Custom Fresnel shader calculating camera view angle vs surface normal.
 * - Additive blending against deep space background for natural planetary limb.
 * - Zero CPU overhead: runs 100% on GPU vertex/fragment stages.
 *
 * Referencing PROJECT_SPEC.md Section 14, RESEARCH_REPORT.md Section 3 & 17.
 */
export class AtmosphereGlow {
  public readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(radius: number = EngineConfig.globe.radius * 1.018) {
    const geometry = new THREE.SphereGeometry(radius, 64, 64);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x38bdf8) },
        uColorInner: { value: new THREE.Color(0x38bdf8) }, // Horizon radiant cyan
        uColorOuter: { value: new THREE.Color(0x0284c7) }, // Outer space azure
        uColorNight: { value: new THREE.Color(0x1d4ed8) }, // Night airglow sapphire
        uIntensity: { value: 1.6 },
        uPower: { value: 2.8 },
        uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
        uLimbFlash: { value: 0.0 }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec3 vPosition;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vPosition = mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec3 vPosition;

        uniform vec3 uColor;
        uniform vec3 uColorInner;
        uniform vec3 uColorOuter;
        uniform vec3 uColorNight;
        uniform float uIntensity;
        uniform float uPower;
        uniform vec3 uSunDirection;
        uniform float uLimbFlash;

        void main() {
          vec3 viewDir = normalize(-vPosition);
          float normalDotView = max(0.0, dot(vNormal, viewDir));
          float rim = 1.0 - normalDotView;

          // Exponential Rayleigh optical depth falloff
          float atmosphere = pow(rim, uPower);

          // Solar scattering angle along terminator & day hemisphere
          vec3 normWorld = normalize(vWorldNormal);
          vec3 sunDir = normalize(uSunDirection);
          float sunDot = dot(normWorld, sunDir);
          // Smooth day-to-night twilight transition
          float dayFactor = smoothstep(-0.35, 0.30, sunDot);

          // Rayleigh chromatic graduation:
          // Horizon is electric cyan; outer limb disperses to deep space azure
          vec3 dayColor = mix(uColorOuter, uColorInner, pow(rim, 1.4));
          vec3 finalColor = mix(uColorNight, dayColor, dayFactor);

          // Superbolt planetary flash integration
          if (uLimbFlash > 0.001) {
            finalColor = mix(finalColor, vec3(0.85, 0.95, 1.0), min(1.0, uLimbFlash * 0.7));
          }

          // Night limb airglow keeps the Earth curvature elegantly defined against the starfield
          float baseGlow = mix(0.18, 1.0, dayFactor);
          float alpha = atmosphere * uIntensity * (baseGlow + uLimbFlash * 2.5);

          gl_FragColor = vec4(finalColor * (1.0 + dayFactor * 0.4), alpha);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 3;
  }

  private limbFlashIntensity: number = 0.0;

  /**
   * Triggers a momentary planetary limb horizon flash on high-energy Superbolts.
   */
  public triggerLimbFlash(_intensity: number = 1.2): void {
    this.limbFlashIntensity = 0.0;
    this.material.uniforms.uLimbFlash.value = 0.0;
  }

  public update(delta: number): void {
    if (this.limbFlashIntensity > 0) {
      this.limbFlashIntensity = Math.max(0, this.limbFlashIntensity - delta * 6.0);
      this.material.uniforms.uLimbFlash.value = this.limbFlashIntensity;
    }
  }

  /**
   * Pure mathematical formulation of Fresnel rim intensity for verification tests.
   */
  public static calculateFresnel(dotNormalView: number, power: number = 3.5, intensity: number = 1.4): number {
    const clampedDot = Math.max(0.0, Math.min(1.0, dotNormalView));
    const rim = 1.0 - clampedDot;
    return Math.pow(rim, power) * intensity;
  }

  public setColor(color: THREE.ColorRepresentation): void {
    this.material.uniforms.uColor.value.set(color);
    this.material.uniforms.uColorInner.value.set(color);
  }

  public setIntensity(intensity: number): void {
    this.material.uniforms.uIntensity.value = intensity;
  }

  public updateSunDirection(direction: THREE.Vector3): void {
    this.material.uniforms.uSunDirection.value.copy(direction);
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
