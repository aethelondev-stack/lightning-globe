import * as THREE from 'three';
import type { IUpdatable } from '../../types';

/**
 * StarfieldBackground: Parallax cosmic dust and twinkling starfield for deep space aesthetics.
 *
 * Capabilities:
 * - Single Draw Call: 1,500 particles drawn via a single THREE.Points mesh.
 * - Deep space palette: Cool white (#f8fafc), celestial azure (#38bdf8), and faint nebula amethyst (#c084fc).
 * - Subtle procedural twinkling in GPU vertex shader via sine waves (zero CPU cost).
 * - Generates an immersive sense of planetary scale against infinite darkness.
 */
export class StarfieldBackground implements IUpdatable {
  public readonly pointsMesh: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;

  constructor(count: number = 4500, radiusMin: number = 900, radiusMax: number = 1600) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const brightness = new Float32Array(count);

    // Stellar spectral classification colors
    const colorO = new THREE.Color(0x93c5fd); // Blue-white giant
    const colorB = new THREE.Color(0xe0f2fe); // White-blue
    const colorA = new THREE.Color(0xf8fafc); // Pure diamond white
    const colorG = new THREE.Color(0xfef08a); // Solar warm yellow
    const colorK = new THREE.Color(0xfed7aa); // Amber orange
    const colorM = new THREE.Color(0xfca5a5); // Red giant
    const tempColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const r = radiusMin + Math.random() * (radiusMax - radiusMin);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const roll = Math.random();
      if (roll < 0.45) {
        tempColor.copy(colorA);
      } else if (roll < 0.65) {
        tempColor.copy(colorB);
      } else if (roll < 0.80) {
        tempColor.copy(colorO);
      } else if (roll < 0.90) {
        tempColor.copy(colorG);
      } else if (roll < 0.96) {
        tempColor.copy(colorK);
      } else {
        tempColor.copy(colorM);
      }

      colors[i * 3] = tempColor.r;
      colors[i * 3 + 1] = tempColor.g;
      colors[i * 3 + 2] = tempColor.b;

      // Magnitude distribution: 92% field stars, 8% brilliant navigational anchor stars
      const isAnchorStar = Math.random() < 0.08;
      if (isAnchorStar) {
        sizes[i] = 4.5 + Math.random() * 2.5;
        brightness[i] = 1.0;
      } else {
        sizes[i] = 1.8 + Math.random() * 2.0;
        brightness[i] = 0.3 + Math.random() * 0.5;
      }

      phases[i] = Math.random() * Math.PI * 2;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0.0 }
      },
      vertexShader: `
        attribute vec3 color;
        attribute float aSize;
        attribute float aPhase;
        attribute float aBrightness;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vBrightness;

        uniform float uTime;

        void main() {
          vColor = color;
          vBrightness = aBrightness;

          // Organic harmonic twinkle
          float twinkle = sin(uTime * 1.4 + aPhase) * cos(uTime * 0.7 + aPhase * 1.6);
          vAlpha = 0.65 + 0.35 * twinkle;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // Strictly clamped point size ensures stars never disappear on 1080p, 1440p, or 4K screens
          float pSize = max(1.8, aSize * (750.0 / -mvPosition.z));
          gl_PointSize = pSize;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vBrightness;

        void main() {
          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;

          // Dual-layer star core and glowing halo
          float core = smoothstep(0.18, 0.0, dist);
          float halo = smoothstep(0.5, 0.0, dist);
          float intensity = core * 0.75 + halo * 0.25;

          // Subtle 4-point diffraction spike for bright magnitude stars
          float crossGlow = 0.0;
          if (vBrightness > 0.8) {
            vec2 absCoord = abs(coord);
            float spikeX = max(0.0, 1.0 - absCoord.y * 12.0) * max(0.0, 0.5 - absCoord.x);
            float spikeY = max(0.0, 1.0 - absCoord.x * 12.0) * max(0.0, 0.5 - absCoord.y);
            crossGlow = (spikeX + spikeY) * 0.40;
          }

          vec3 finalColor = vColor * (1.0 + crossGlow * 1.4);
          float finalAlpha = vAlpha * clamp(intensity + crossGlow, 0.0, 1.0);
          gl_FragColor = vec4(finalColor, finalAlpha);
        }
      `
    });

    this.pointsMesh = new THREE.Points(this.geometry, this.material);
    this.pointsMesh.name = 'StarfieldBackground';
    this.pointsMesh.renderOrder = 0;
  }

  public update(delta: number = 0.016): void {
    this.material.uniforms.uTime.value += delta;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
