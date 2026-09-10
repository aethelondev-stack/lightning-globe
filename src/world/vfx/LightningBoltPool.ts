import * as THREE from 'three';
import type { ActiveBolt } from '../../types/vfx';
import { EngineConfig } from '../../core/Config';
import { generateBoltGeometry, writeBoltRibbonGeometry, sampleSpinePoint } from './ProceduralBoltGeometry';

/**
 * LightningBoltPool: Zero-allocation high-performance object pool for 3D procedural lightning meshes,
 * Mach shockwave rings, acoustic water-ripple rings, cloud sheet glows, cascading electric charge beads, and dynamic ground flash lights.
 *
 * Pre-allocates a fixed pool of camera-facing single-body volumetric ribbon meshes, Rings, Points, and PointLights.
 * Zero heap allocations during render loop.
 */
export class LightningBoltPool {
  public readonly group: THREE.Group = new THREE.Group();
  private readonly pool: ActiveBolt[] = [];
  private readonly maxBolts: number;
  private readonly defaultDurationMs: number;
  private readonly flashDecayMs: number;
  private cameraDistance: number = 320;

  // Maximum vertices per bolt ribbon (supports up to 384 segments * 4 vertices = 1536)
  private readonly maxVertices: number = 1536;
  private readonly maxIndices: number = 2304; // 384 * 6 indices

  private static readonly TEMP_NORMAL = new THREE.Vector3();
  private static readonly TEMP_BEAD_POS = new THREE.Vector3();
  private static readonly Z_AXIS = new THREE.Vector3(0, 0, 1);
  private static readonly TEMP_MATRIX = new THREE.Matrix4();
  private static readonly TEMP_SCALE = new THREE.Vector3();

  public readonly shockwaveMesh: THREE.InstancedMesh;
  public readonly rippleMesh: THREE.InstancedMesh;
  private readonly shockwaveAlphas: Float32Array;
  private readonly rippleAlphas: Float32Array;

  // 5 Lightning Intensity Tier Colors (Foto 2 Color Palette):
  // 1. MINOR (<10 kA): Turquoise Cyan (#26C6DA)
  public static readonly TIER_COLOR_MINOR = new THREE.Color(0x26c6da);
  public static readonly CORE_COLOR_MINOR = new THREE.Color(0xa0e7e5);
  public static readonly OUTER_COLOR_MINOR = new THREE.Color(0x00838f);

  // 2. STANDARD (10 - 35 kA): Neon Lilac (#D6A2E8)
  public static readonly TIER_COLOR_STANDARD = new THREE.Color(0xd6a2e8);
  public static readonly CORE_COLOR_STANDARD = new THREE.Color(0xf3e5f5);
  public static readonly OUTER_COLOR_STANDARD = new THREE.Color(0x7b1fa2);

  // 3. SEVERE (35 - 75 kA): Amber Gold (#FFC436)
  public static readonly TIER_COLOR_SEVERE = new THREE.Color(0xffc436);
  public static readonly CORE_COLOR_SEVERE = new THREE.Color(0xffe57f);
  public static readonly OUTER_COLOR_SEVERE = new THREE.Color(0xe65100);

  // 4. VIOLENT (75 - 150 kA): Ionic Plasma Fuchsia (#FF1493)
  public static readonly TIER_COLOR_VIOLENT = new THREE.Color(0xff1493);
  public static readonly CORE_COLOR_VIOLENT = new THREE.Color(0xfff0f5);
  public static readonly OUTER_COLOR_VIOLENT = new THREE.Color(0x880e4f);

  // 5. SUPERBOLT (>= 150 kA): Cosmic Pulsar Ice-White (#F0F4FF)
  public static readonly TIER_COLOR_SUPERBOLT = new THREE.Color(0xf0f4ff);
  public static readonly CORE_COLOR_SUPERBOLT = new THREE.Color(0xffffff);
  public static readonly OUTER_COLOR_SUPERBOLT = new THREE.Color(0x7c4dff);

  // Cascading charge bead colors
  public static readonly BEAD_COLOR_MINOR = new THREE.Color(0xa0e7e5);
  public static readonly BEAD_COLOR_STANDARD = new THREE.Color(0xd6a2e8);
  public static readonly BEAD_COLOR_SEVERE = new THREE.Color(0xffc436);
  public static readonly BEAD_COLOR_VIOLENT = new THREE.Color(0xff1493);
  public static readonly BEAD_COLOR_SUPERBOLT = new THREE.Color(0xf0f4ff);

  // Lingering Residual Sparks for VIOLENT & SUPERBOLT discharges (Foto 2 & Req 2)
  private readonly maxResidualSparks = 2000;
  private readonly sparkPositions: Float32Array = new Float32Array(2000 * 3);
  private readonly sparkColors: Float32Array = new Float32Array(2000 * 3);
  private readonly sparkMeta: {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    color: THREE.Color;
    phase: number;
    freq: number;
    birthTime: number;
    lifetimeMs: number;
    active: boolean;
  }[] = [];
  private sparkPointsMesh!: THREE.Points;

  private static cachedSparkTexture: THREE.Texture | null = null;

  private static getSparkTexture(): THREE.Texture {
    if (LightningBoltPool.cachedSparkTexture) {
      return LightningBoltPool.cachedSparkTexture;
    }
    if (typeof document === 'undefined') {
      return new THREE.Texture();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      grad.addColorStop(0.2, 'rgba(240, 248, 255, 0.92)');
      grad.addColorStop(0.5, 'rgba(180, 220, 255, 0.50)');
      grad.addColorStop(0.8, 'rgba(100, 180, 255, 0.15)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    LightningBoltPool.cachedSparkTexture = tex;
    return tex;
  }

  public setCameraDistance(distance: number): void {
    this.cameraDistance = distance;
  }

  constructor(optionsOrMaxBolts: number | { poolSize?: number; boltDurationMs?: number } = EngineConfig.vfx.maxActiveBolts) {
    if (typeof optionsOrMaxBolts === 'number') {
      this.maxBolts = optionsOrMaxBolts;
      this.defaultDurationMs = EngineConfig.vfx.boltDurationMs;
    } else {
      this.maxBolts = optionsOrMaxBolts?.poolSize ?? EngineConfig.vfx.maxActiveBolts;
      this.defaultDurationMs = optionsOrMaxBolts?.boltDurationMs ?? EngineConfig.vfx.boltDurationMs;
    }
    this.flashDecayMs = EngineConfig.vfx.flashDecayMs;

    this.group.name = 'LightningBoltPool';

    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 32);
    const rippleGeo = new THREE.RingGeometry(0.92, 1.0, 36);
    const sparkMap = LightningBoltPool.getSparkTexture();

    // 1. Instanced Mach Shockwave Mesh (renderOrder = 5, replaces individual meshes with 1 draw call)
    const shockwaveMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) }
      },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          gl_FragColor = vec4(uColor, vAlpha);
        }
      `
    });

    const sGeo = ringGeo.clone();
    this.shockwaveAlphas = new Float32Array(this.maxBolts);
    const sAlphaAttr = new THREE.InstancedBufferAttribute(this.shockwaveAlphas, 1);
    sAlphaAttr.setUsage(THREE.DynamicDrawUsage);
    sGeo.setAttribute('aAlpha', sAlphaAttr);
    sGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 300);
    this.shockwaveMesh = new THREE.InstancedMesh(sGeo, shockwaveMat, this.maxBolts);
    this.shockwaveMesh.renderOrder = 5;
    this.shockwaveMesh.frustumCulled = false;
    this.shockwaveMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.shockwaveMesh);

    // 2. Instanced Acoustic Water-Ripple Mesh (renderOrder = 24, replaces individual meshes with 1 draw call)
    const rippleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: {
        uColor: { value: new THREE.Color(0x7dd3fc) }
      },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          gl_FragColor = vec4(uColor, vAlpha);
        }
      `
    });

    const rGeo = rippleGeo.clone();
    this.rippleAlphas = new Float32Array(this.maxBolts);
    const rAlphaAttr = new THREE.InstancedBufferAttribute(this.rippleAlphas, 1);
    rAlphaAttr.setUsage(THREE.DynamicDrawUsage);
    rGeo.setAttribute('aAlpha', rAlphaAttr);
    rGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 300);
    this.rippleMesh = new THREE.InstancedMesh(rGeo, rippleMat, this.maxBolts);
    this.rippleMesh.renderOrder = 24;
    this.rippleMesh.frustumCulled = false;
    this.rippleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.rippleMesh);

    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxBolts; i++) {
      this.shockwaveMesh.setMatrixAt(i, zeroMat);
      this.rippleMesh.setMatrixAt(i, zeroMat);
    }
    this.shockwaveMesh.instanceMatrix.needsUpdate = true;
    this.rippleMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.maxBolts; i++) {
      const positions = new Float32Array(this.maxVertices * 3);
      const dirs = new Float32Array(this.maxVertices * 3);
      const sides = new Float32Array(this.maxVertices);
      const widths = new Float32Array(this.maxVertices);
      const progresses = new Float32Array(this.maxVertices);
      const indices = new Uint16Array(this.maxIndices);

      const geometry = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(positions, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', posAttr);

      const dirAttr = new THREE.BufferAttribute(dirs, 3);
      dirAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aDir', dirAttr);

      const sideAttr = new THREE.BufferAttribute(sides, 1);
      sideAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aSide', sideAttr);

      const widthAttr = new THREE.BufferAttribute(widths, 1);
      widthAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aWidth', widthAttr);

      const progAttr = new THREE.BufferAttribute(progresses, 1);
      progAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aProgress', progAttr);

      const indexAttr = new THREE.BufferAttribute(indices, 1);
      indexAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setIndex(indexAttr);
      geometry.setDrawRange(0, 0);

      // Single-Body Volumetric Camera-Facing Plasma Ribbon Shader Material (View-Space Billboard)
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(0x93c5fd) },
          uColorCore: { value: new THREE.Color(0xffffff) },
          uColorOuter: { value: new THREE.Color(0x7c4dff) },
          uColorCenterStroke: { value: new THREE.Color(0xffd230) },
          uHasCenterStroke: { value: 0.0 },
          uOpacity: { value: 1.0 },
          uTime: { value: 0.0 },
          uLeaderProgress: { value: 1.0 },
          uReturnStroke: { value: 0.0 }
        },
        vertexShader: `
          attribute vec3 aDir;
          attribute float aSide;
          attribute float aWidth;
          attribute float aProgress;

          varying float vSide;
          varying float vProgress;

          void main() {
            vSide = aSide;
            vProgress = aProgress;

            // 1. Transform vertex position to Camera View-Space
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);

            // 2. Transform line tangent direction to Camera View-Space
            vec3 viewTangent = (modelViewMatrix * vec4(aDir, 0.0)).xyz;

            // 3. Compute 2D transverse normal in View-Space (facing camera, perpendicular to line)
            // In view space, camera looks down -Z. The 2D normal in the camera's image plane XY is:
            vec2 screenNormal = vec2(-viewTangent.y, viewTangent.x);
            float sLen = length(screenNormal);
            if (sLen < 0.0001) {
              screenNormal = vec2(1.0, 0.0);
            } else {
              screenNormal /= sLen;
            }

            // 4. Displace vertex strictly in View-Space XY plane
            // Zero 3D bowtie twisting, zero polygon self-intersection, zero triangular shard fins!
            vec3 displaced = mvPos.xyz + vec3(screenNormal * (aSide * aWidth * 0.5), 0.0);

            gl_Position = projectionMatrix * vec4(displaced, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform vec3 uColorCore;
          uniform vec3 uColorOuter;
          uniform vec3 uColorCenterStroke;
          uniform float uHasCenterStroke;
          uniform float uOpacity;
          uniform float uTime;
          uniform float uLeaderProgress;
          uniform float uReturnStroke;

          varying float vSide;
          varying float vProgress;

          void main() {
            if (vProgress > uLeaderProgress) {
              discard;
            }

            float dist = abs(vSide);

            // Ultra-sharp nuclear white core
            float core = exp(-pow(dist / 0.14, 2.0));
            // Rich multi-tone chromatic plasma body
            float mid = exp(-pow(dist / 0.46, 2.0));
            // Smooth outer atmospheric corona
            float outer = exp(-dist * 2.2);

            // Dynamic micro-jitter electrical crackle
            float crackle = 0.90 + 0.10 * sin(uTime * 50.0 + vProgress * 40.0);

            vec3 col = mix(uColorOuter, uColor, clamp(mid, 0.0, 1.0));
            col = mix(col, uColorCore, clamp(core * 0.97, 0.0, 1.0));

            // Return stroke explosive luminous flash burst (preserves vivid electric tier colors)
            if (uReturnStroke > 0.0) {
              col = mix(col, uColorCore, clamp(uReturnStroke * 0.40, 0.0, 1.0));
            }

            // Highly prominent luminous golden-amber center stroke running right through the central vector
            if (uHasCenterStroke > 0.5) {
              float centerWire = exp(-pow(dist / 0.080, 2.0));
              col = mix(col, uColorCenterStroke, clamp(centerWire * 0.98, 0.0, 1.0));
            }

            float alpha = clamp(core * 1.0 + mid * 0.72 + outer * 0.35, 0.0, 1.0) * uOpacity * crackle;
            if (uHasCenterStroke > 0.5) {
              float centerWireAlpha = exp(-pow(dist / 0.080, 2.0));
              alpha = clamp(alpha + centerWireAlpha * 0.40, 0.0, 1.0);
            }
            if (uReturnStroke > 0.0) {
              alpha = clamp(alpha * (1.0 + uReturnStroke * 0.7), 0.0, 1.0);
            }

            if (alpha < 0.01) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `
      });
      material.opacity = 1.0;
      (material as any).color = material.uniforms.uColor.value;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 30; // Above storm cell honeycomb radar (renderOrder 18-20)
      mesh.visible = false;
      this.group.add(mesh);

      // Impact 1: Mach Shockwave Ring - retained on slot data for test & property access without individual draw call
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4
      });
      const shockwaveRing = new THREE.Mesh(ringGeo, ringMat);
      shockwaveRing.renderOrder = 5; // Above globe continents & borders, below radar lens
      shockwaveRing.visible = false;

      // Impact 2: Acoustic Water-Ripple Ring - retained on slot data for test & property access
      const rippleMat = new THREE.MeshBasicMaterial({
        color: 0x7dd3fc, // Crisp cyan/sky water ripple
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4
      });
      const acousticRippleRing = new THREE.Mesh(rippleGeo, rippleMat);
      acousticRippleRing.renderOrder = 24;
      acousticRippleRing.visible = false;

      // Cascading Electric Charges (Threaded beads sliding down the line, renderOrder = 31)
      const maxBeads = 12;
      const chargePositions = new Float32Array(maxBeads * 3);
      const chargeColors = new Float32Array(maxBeads * 3);
      const chargeOffsets = new Float32Array(maxBeads);
      const chargeGeo = new THREE.BufferGeometry();
      const chargePosAttr = new THREE.BufferAttribute(chargePositions, 3);
      chargePosAttr.setUsage(THREE.DynamicDrawUsage);
      chargeGeo.setAttribute('position', chargePosAttr);
      const chargeColAttr = new THREE.BufferAttribute(chargeColors, 3);
      chargeColAttr.setUsage(THREE.DynamicDrawUsage);
      chargeGeo.setAttribute('color', chargeColAttr);
      chargeGeo.setDrawRange(0, 0);

      const matParams: THREE.PointsMaterialParameters = {
        size: 0.65,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        map: sparkMap
      };
      const chargeMat = new THREE.PointsMaterial(matParams);
      const cascadingCharges = new THREE.Points(chargeGeo, chargeMat);
      cascadingCharges.renderOrder = 31; // Highest layer, beads sliding on the bolt wire
      cascadingCharges.visible = false;
      this.group.add(cascadingCharges);

      // Localized point light for ground flash
      const light = new THREE.PointLight(
        0xdbeafe,
        0,
        EngineConfig.vfx.flashDistance,
        2.0
      );
      light.visible = false;
      this.group.add(light);

      this.pool.push({
        id: `bolt-slot-${i}`,
        mesh,
        positions,
        dirs,
        sides,
        widths,
        progresses,
        indices,
        light,
        shockwaveRing,
        acousticRippleRing,
        cascadingCharges,
        chargePositions,
        chargeColors,
        chargeOffsets,
        chargeCount: 0,
        startTime: 0,
        durationMs: this.defaultDurationMs,
        intensity: 1.0,
        isPositive: false,
        classification: 'STANDARD',
        active: false
      });
    }

    // Initialize lingering residual sparks pool (for VIOLENT & SUPERBOLT tiers, Foto 2 & Req 2)
    for (let s = 0; s < this.maxResidualSparks; s++) {
      this.sparkMeta.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        color: new THREE.Color(),
        phase: 0,
        freq: 10,
        birthTime: 0,
        lifetimeMs: 0,
        active: false
      });
    }

    const sparkGeo = new THREE.BufferGeometry();
    const sparkPosAttr = new THREE.BufferAttribute(this.sparkPositions, 3);
    sparkPosAttr.setUsage(THREE.DynamicDrawUsage);
    sparkGeo.setAttribute('position', sparkPosAttr);

    const sparkColAttr = new THREE.BufferAttribute(this.sparkColors, 3);
    sparkColAttr.setUsage(THREE.DynamicDrawUsage);
    sparkGeo.setAttribute('color', sparkColAttr);
    sparkGeo.setDrawRange(0, 0);

    const sparkMat = new THREE.PointsMaterial({
      size: 0.48,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: sparkMap
    });

    this.sparkPointsMesh = new THREE.Points(sparkGeo, sparkMat);
    this.sparkPointsMesh.renderOrder = 32; // Directly above the lightning ribbon
    this.sparkPointsMesh.visible = false;
    this.group.add(this.sparkPointsMesh);
  }

  /**
   * Emits lingering residual plasma micro-particles along the serpentine lightning channel.
   * Particles strictly trace the 3D jagged cord (path), with subtle micro-jitter and tier color matching.
   */
  private emitResidualSparks(path: THREE.Vector3[], color: THREE.Color, count: number = 32, currentTime: number = Date.now()): void {
    if (!path || path.length < 2) return;

    let spawned = 0;
    const pathSegments = path.length - 1;

    for (let s = 0; s < this.sparkMeta.length && spawned < count; s++) {
      const spark = this.sparkMeta[s];
      if (spark.active) continue;

      // Sequential serpentine distribution along the actual 3D lightning trunk
      const segFloat = (spawned / Math.max(1, count - 1)) * pathSegments;
      const segIdx = Math.min(pathSegments - 1, Math.floor(segFloat));
      const segT = segFloat - segIdx;
      const pA = path[segIdx];
      const pB = path[segIdx + 1];

      // Interpolate along the channel segment
      spark.pos.lerpVectors(pA, pB, segT);

      // Micro-jitter so particles hug the serpentine cord tightly like lingering ionization beads
      spark.pos.x += (Math.random() - 0.5) * 0.05;
      spark.pos.y += (Math.random() - 0.5) * 0.05;
      spark.pos.z += (Math.random() - 0.5) * 0.05;

      // Gentle drift velocity
      spark.vel.set(
        (Math.random() - 0.5) * 0.04,
        (Math.random() - 0.5) * 0.04,
        (Math.random() - 0.5) * 0.04
      );

      spark.color.copy(color);
      // Random smooth oscillation frequency (3 to 8 Hz) and initial phase
      spark.freq = 3.0 + Math.random() * 6.0;
      spark.phase = Math.random() * Math.PI * 2.0;
      spark.birthTime = currentTime;
      // 0.5s - 0.8s punchy & crisp plasma lifetime (Req 4: faster dissipation)
      spark.lifetimeMs = 500 + Math.random() * 300;
      spark.active = true;
      spawned++;
    }
  }

  /**
   * Acquires a bolt from the pool and activates it along the trajectory.
   * If all slots are active, steals/re-uses the oldest active bolt (LRU eviction).
   */
  public acquire(
    start: THREE.Vector3,
    end: THREE.Vector3,
    intensity: number = 1.0,
    durationMs?: number,
    currentTime: number = Date.now(),
    peakCurrent?: number,
    polarity?: number,
    hitCellId?: string | null
  ): ActiveBolt | null {
    // Check distance validity
    const dist = start.distanceTo(end);
    if (dist < 0.001 || isNaN(dist)) {
      return null;
    }

    // 1. Find an idle slot or oldest slot (LRU eviction)
    let selected: ActiveBolt | null = null;
    let oldestTime = Infinity;
    let oldestSlot: ActiveBolt = this.pool[0];

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      if (!slot.active) {
        selected = slot;
        break;
      }
      if (slot.startTime < oldestTime) {
        oldestTime = slot.startTime;
        oldestSlot = slot;
      }
    }

    if (!selected) {
      selected = oldestSlot;
    }

    // 2. Scientific Classification & Polarity Tuning
    const absKa = Math.abs(peakCurrent ?? (intensity * 25));
    const isPositive = polarity !== undefined ? polarity > 0 : (peakCurrent !== undefined ? peakCurrent > 0 : false);

    let classification = 'STANDARD';
    let calcDuration = durationMs ?? this.defaultDurationMs;
    let branchProb: number = EngineConfig.vfx.boltBranchProbability;
    let displacementScale: number = EngineConfig.vfx.boltDisplacementScale;

    if (absKa < 10) {
      classification = 'MINOR';
      calcDuration = durationMs ?? 200;
      branchProb = 0.18;
      displacementScale = 1.6;
    } else if (absKa <= 35) {
      classification = 'STANDARD';
      calcDuration = durationMs ?? 350;
      branchProb = 0.32;
      displacementScale = 2.2;
    } else if (absKa < 75) {
      classification = 'SEVERE';
      calcDuration = durationMs ?? 1200;
      branchProb = 0.44;
      displacementScale = 2.6;
    } else if (absKa < 150) {
      classification = 'VIOLENT';
      calcDuration = durationMs ?? 1800;
      branchProb = 0.52;
      displacementScale = 3.0;
    } else {
      classification = 'SUPERBOLT';
      calcDuration = durationMs ?? 2800;
      branchProb = 0.60;
      displacementScale = 3.6;
    }

    if (isPositive) {
      branchProb = 0.14;
      displacementScale = 1.6;
    }

    // 3. Generate UNIFIED procedural geometry: line segments + exact main trunk polyline
    const geo = generateBoltGeometry(start, end, {
      displacementScale,
      branchProbability: branchProb,
      isPositive
    });

    // 3. Single-Body Volumetric Camera-Facing Plasma Ribbon Geometry (View-Space Billboard)
    // 2x doubled high-voltage plasma ribbon filament for rich presence across planetary distances
    let baseWidth = 0.340;
    if (classification === 'MINOR') {
      baseWidth = 0.220;
    } else if (classification === 'STANDARD') {
      baseWidth = 0.340;
    } else if (classification === 'SEVERE') {
      baseWidth = 0.500;
    } else if (classification === 'VIOLENT') {
      baseWidth = 0.680;
    } else { // SUPERBOLT
      baseWidth = 0.900;
    }

    const mainTrunkCount = Math.max(1, geo.mainTrunk.length - 1);
    const { indexCount } = writeBoltRibbonGeometry(
      geo.segments,
      selected.positions,
      selected.dirs!,
      selected.sides!,
      selected.widths!,
      selected.indices!,
      {
        baseWidth,
        mainTrunkCount,
        mainTrunk: geo.mainTrunk,
        progresses: selected.progresses
      }
    );

    (selected.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (selected.mesh.geometry.getAttribute('aDir') as THREE.BufferAttribute).needsUpdate = true;
    (selected.mesh.geometry.getAttribute('aSide') as THREE.BufferAttribute).needsUpdate = true;
    (selected.mesh.geometry.getAttribute('aWidth') as THREE.BufferAttribute).needsUpdate = true;
    if (selected.mesh.geometry.getAttribute('aProgress')) {
      (selected.mesh.geometry.getAttribute('aProgress') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (selected.mesh.geometry.index) {
      selected.mesh.geometry.index.needsUpdate = true;
    }
    selected.mesh.geometry.setDrawRange(0, indexCount);

    selected.chargePath = geo.mainTrunk;
    selected.mainTrunkArcLengths = geo.arcLengths;
    selected.totalTrunkLength = geo.totalLength;
    selected.hitCellId = hitCellId ?? null;
    selected.hasEmittedResidualSparks = false;

    // 4. Color and Material Styling based on 5-Tier Atmospheric Plasma Spectrum (Foto 2)
    let tierColor = LightningBoltPool.TIER_COLOR_STANDARD;
    let coreColor = LightningBoltPool.CORE_COLOR_STANDARD;
    let outerColor = LightningBoltPool.OUTER_COLOR_STANDARD;

    if (classification === 'MINOR') {
      tierColor = LightningBoltPool.TIER_COLOR_MINOR;
      coreColor = LightningBoltPool.CORE_COLOR_MINOR;
      outerColor = LightningBoltPool.OUTER_COLOR_MINOR;
    } else if (classification === 'STANDARD') {
      tierColor = LightningBoltPool.TIER_COLOR_STANDARD;
      coreColor = LightningBoltPool.CORE_COLOR_STANDARD;
      outerColor = LightningBoltPool.OUTER_COLOR_STANDARD;
    } else if (classification === 'SEVERE') {
      tierColor = LightningBoltPool.TIER_COLOR_SEVERE;
      coreColor = LightningBoltPool.CORE_COLOR_SEVERE;
      outerColor = LightningBoltPool.OUTER_COLOR_SEVERE;
    } else if (classification === 'VIOLENT') {
      tierColor = LightningBoltPool.TIER_COLOR_VIOLENT;
      coreColor = LightningBoltPool.CORE_COLOR_VIOLENT;
      outerColor = LightningBoltPool.OUTER_COLOR_VIOLENT;
    } else {
      tierColor = LightningBoltPool.TIER_COLOR_SUPERBOLT;
      coreColor = LightningBoltPool.CORE_COLOR_SUPERBOLT;
      outerColor = LightningBoltPool.OUTER_COLOR_SUPERBOLT;
    }
    selected.tierColor = tierColor;

    const mat = selected.mesh.material as THREE.ShaderMaterial;
    if (mat.uniforms && mat.uniforms.uColor) {
      mat.uniforms.uColor.value.copy(tierColor);
    }
    if (mat.uniforms && mat.uniforms.uColorCore) {
      mat.uniforms.uColorCore.value.copy(coreColor);
    }
    if (mat.uniforms && mat.uniforms.uColorOuter) {
      mat.uniforms.uColorOuter.value.copy(outerColor);
    }
    // 4b. Radiant golden center stroke for white-toned bolts (SUPERBOLT / cosmic pulsar ice-white discharges)
    const hasWhiteTones = classification === 'SUPERBOLT' || (coreColor.r >= 0.95 && coreColor.g >= 0.95 && coreColor.b >= 0.95);
    if (mat.uniforms && mat.uniforms.uHasCenterStroke) {
      mat.uniforms.uHasCenterStroke.value = hasWhiteTones ? 1.0 : 0.0;
    }
    if (mat.uniforms && mat.uniforms.uColorCenterStroke) {
      mat.uniforms.uColorCenterStroke.value.setHex(0xffd230);
    }
    if ((mat as any).color) {
      (mat as any).color.copy(tierColor);
    }
    mat.opacity = 1.0;
    if (mat.uniforms && mat.uniforms.uOpacity) {
      mat.uniforms.uOpacity.value = 1.0;
    }
    selected.mesh.visible = true;

    // 5. Normal vector on the planetary surface at impact point
    LightningBoltPool.TEMP_NORMAL.copy(end).normalize();

    // 6. Impact 1: Mach Shockwave Ring
    let maxShockwaveScale = 1.2;
    if (classification === 'SUPERBOLT') {
      maxShockwaveScale = 2.2;
    } else if (classification === 'VIOLENT') {
      maxShockwaveScale = 1.8;
    } else if (classification === 'SEVERE') {
      maxShockwaveScale = 1.4;
    }
    selected.maxShockwaveScale = maxShockwaveScale;

    if (selected.shockwaveRing) {
      selected.shockwaveRing.visible = false;
      selected.shockwaveRing.position.copy(end);
      selected.shockwaveRing.quaternion.setFromUnitVectors(LightningBoltPool.Z_AXIS, LightningBoltPool.TEMP_NORMAL);
    }

    // 7. Impact 2: Acoustic Water-Ripple Ring (Deactivated to eliminate circular artifacts)
    if (selected.acousticRippleRing) {
      selected.acousticRippleRing.visible = false;
      selected.acousticRippleRing.position.copy(end);
      selected.acousticRippleRing.quaternion.setFromUnitVectors(LightningBoltPool.Z_AXIS, LightningBoltPool.TEMP_NORMAL);
    }

    // 8. Cascading Electric Charges (Refined, delicate charge spheres strictly threaded on the bolt wire, Req 1 & 4)
    if (selected.cascadingCharges && selected.chargePositions && selected.chargeColors && selected.chargeOffsets) {
      let numBeads = 0;
      let beadSize = 0;
      if (classification === 'SUPERBOLT') {
        numBeads = 4;
        beadSize = 3.2;
      } else if (classification === 'VIOLENT') {
        numBeads = 3;
        beadSize = 2.5;
      } else if (classification === 'SEVERE') {
        numBeads = 2;
        beadSize = 2.0;
      } else if (classification === 'STANDARD') {
        numBeads = 2;
        beadSize = 1.6;
      } else { // MINOR
        numBeads = 1;
        beadSize = 1.2;
      }

      selected.chargeCount = numBeads;
      if (numBeads > 0) {
        for (let b = 0; b < numBeads; b++) {
          selected.chargeOffsets[b] = b * 0.025; // Compact staggered start delay
          selected.chargeColors[b * 3] = tierColor.r;
          selected.chargeColors[b * 3 + 1] = tierColor.g;
          selected.chargeColors[b * 3 + 2] = tierColor.b;
        }

        // Initialize positions at start point
        for (let b = 0; b < numBeads; b++) {
          selected.chargePositions[b * 3] = start.x;
          selected.chargePositions[b * 3 + 1] = start.y;
          selected.chargePositions[b * 3 + 2] = start.z;
        }

        const cPosAttr = selected.cascadingCharges.geometry.getAttribute('position') as THREE.BufferAttribute;
        cPosAttr.needsUpdate = true;
        const cColAttr = selected.cascadingCharges.geometry.getAttribute('color') as THREE.BufferAttribute;
        cColAttr.needsUpdate = true;
        selected.cascadingCharges.geometry.setDrawRange(0, numBeads);
        (selected.cascadingCharges.material as THREE.PointsMaterial).size = beadSize;
        selected.cascadingCharges.visible = true;
      } else {
        selected.cascadingCharges.visible = false;
      }
    }

    // 10. Ground Flash Light
    if (selected.light) {
      const distMult = Math.max(1.0, Math.min(2.8, this.cameraDistance / 160.0));
      selected.light.position.copy(end).addScaledVector(LightningBoltPool.TEMP_NORMAL, 0.8 * distMult);
      selected.light.distance = EngineConfig.vfx.flashDistance * distMult;
      selected.light.intensity = EngineConfig.vfx.flashIntensity * Math.min(2.5, Math.max(0.6, intensity)) * distMult;
      selected.light.color.copy(tierColor);
      selected.light.visible = true;
    }

    selected.active = true;
    selected.startTime = currentTime;
    selected.durationMs = calcDuration;
    selected.intensity = intensity;
    selected.isPositive = isPositive;
    selected.classification = classification;

    return selected;
  }

  private updateShockwaveInstance(index: number, position: THREE.Vector3 | null, quaternion: THREE.Quaternion | null, scale: number, opacity: number): void {
    if (position && quaternion && scale > 0.001 && opacity > 0.001) {
      LightningBoltPool.TEMP_SCALE.set(scale, scale, 1);
      LightningBoltPool.TEMP_MATRIX.compose(position, quaternion, LightningBoltPool.TEMP_SCALE);
      this.shockwaveMesh.setMatrixAt(index, LightningBoltPool.TEMP_MATRIX);
      this.shockwaveAlphas[index] = opacity;
    } else {
      LightningBoltPool.TEMP_MATRIX.makeScale(0, 0, 0);
      this.shockwaveMesh.setMatrixAt(index, LightningBoltPool.TEMP_MATRIX);
      this.shockwaveAlphas[index] = 0;
    }
  }

  private updateRippleInstance(index: number, position: THREE.Vector3 | null, quaternion: THREE.Quaternion | null, scale: number, opacity: number): void {
    if (position && quaternion && scale > 0.001 && opacity > 0.001) {
      LightningBoltPool.TEMP_SCALE.set(scale, scale, 1);
      LightningBoltPool.TEMP_MATRIX.compose(position, quaternion, LightningBoltPool.TEMP_SCALE);
      this.rippleMesh.setMatrixAt(index, LightningBoltPool.TEMP_MATRIX);
      this.rippleAlphas[index] = opacity;
    } else {
      LightningBoltPool.TEMP_MATRIX.makeScale(0, 0, 0);
      this.rippleMesh.setMatrixAt(index, LightningBoltPool.TEMP_MATRIX);
      this.rippleAlphas[index] = 0;
    }
  }

  /**
   * Updates opacity decay, Mach shockwaves, water ripple rings, cascading charge beads, and disables expired bolts.
   * Zero heap allocations.
   */
  public update(currentTime: number = Date.now()): void {
    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      if (!slot.active) continue;

      const elapsed = currentTime - slot.startTime;
      const progress = elapsed / slot.durationMs;

      if (progress >= 1.0) {
        // Expired: return to pool
        slot.active = false;
        slot.mesh.visible = false;
        if (slot.light) {
          slot.light.visible = false;
          slot.light.intensity = 0;
        }
        if (slot.shockwaveRing) {
          slot.shockwaveRing.visible = false;
          (slot.shockwaveRing.material as THREE.MeshBasicMaterial).opacity = 0;
          this.updateShockwaveInstance(i, null, null, 0, 0);
        }
        if (slot.acousticRippleRing) {
          slot.acousticRippleRing.visible = false;
          (slot.acousticRippleRing.material as THREE.MeshBasicMaterial).opacity = 0;
          this.updateRippleInstance(i, null, null, 0, 0);
        }
        if (slot.cascadingCharges) {
          slot.cascadingCharges.visible = false;
          slot.chargeCount = 0;
          slot.chargePath = undefined;
        }
      } else {
        // 4-Phase Cinematic Lightning Lifecycle Animation (Sanat Eseri)
        const mat = slot.mesh.material as THREE.ShaderMaterial;
        const nowSec = currentTime * 0.001;
        if (mat.uniforms && mat.uniforms.uTime) {
          mat.uniforms.uTime.value = nowSec;
        }

        let leaderProg = 1.0;
        let returnStroke = 0.0;
        let strokeAlpha = 1.0;

        // Phase 1: Stepped Leader Darting Downward (0.0 -> 0.14)
        if (progress < 0.14) {
          leaderProg = progress / 0.14;
          strokeAlpha = 0.90;
          returnStroke = 0.0;
        }
        // Phase 2: Ground Impact Return Stroke Blinding Flash Surge (0.14 -> 0.28)
        else if (progress < 0.28) {
          leaderProg = 1.0;
          const returnP = (progress - 0.14) / 0.14;
          returnStroke = Math.sin(returnP * Math.PI) * 1.5;
          strokeAlpha = 1.0;
        }
        // Phase 3: Secondary Restrikes & Plasma Channel Ionization Jitter (0.28 -> 0.65)
        else if (progress < 0.65) {
          leaderProg = 1.0;
          returnStroke = 0.0;
          const pulse = Math.sin((progress - 0.28) * 32.0);
          strokeAlpha = 0.55 + 0.45 * Math.max(0, pulse);
        }
        // Phase 4: Smooth Gas Column Dissipation (0.65 -> 1.00)
        else {
          leaderProg = 1.0;
          returnStroke = 0.0;
          const fadeP = (progress - 0.65) / 0.35;
          strokeAlpha = Math.max(0, 0.55 * (1.0 - Math.pow(fadeP, 1.6)));
        }

        mat.opacity = strokeAlpha;
        if (mat.uniforms) {
          if (mat.uniforms.uOpacity) mat.uniforms.uOpacity.value = strokeAlpha;
          if (mat.uniforms.uLeaderProgress) mat.uniforms.uLeaderProgress.value = leaderProg;
          if (mat.uniforms.uReturnStroke) mat.uniforms.uReturnStroke.value = returnStroke;
        }

        // Cascading Electric Charge Beads Update (Flowing downward on the polyline wire, vanishing on ground impact)
        if (
          slot.cascadingCharges &&
          slot.cascadingCharges.visible &&
          slot.chargePath &&
          slot.chargeCount &&
          slot.chargeCount > 0 &&
          slot.chargePositions &&
          slot.chargeColors &&
          slot.chargeOffsets
        ) {
          const numBeads = slot.chargeCount;
          const elapsedSec = elapsed / 1000;
          // Faster descent: charges rush down swiftly and dissipate immediately on impact
          const fallDuration = slot.classification === 'SUPERBOLT' ? 0.20 : (slot.classification === 'VIOLENT' ? 0.17 : 0.14);

          const baseColor = slot.tierColor ?? LightningBoltPool.TIER_COLOR_STANDARD;

          let activeBeads = 0;

          for (let b = 0; b < numBeads; b++) {
            const startDelay = slot.chargeOffsets[b];
            const beadTime = elapsedSec - startDelay;

            if (beadTime < 0) {
              // Not spawned yet from cloud
              slot.chargeColors[b * 3] = 0;
              slot.chargeColors[b * 3 + 1] = 0;
              slot.chargeColors[b * 3 + 2] = 0;
            } else if (beadTime <= fallDuration) {
              // Traveling smoothly down the line
              activeBeads++;
              const u = beadTime / fallDuration;
              sampleSpinePoint(
                slot.chargePath,
                u,
                LightningBoltPool.TEMP_BEAD_POS,
                slot.mainTrunkArcLengths,
                slot.totalTrunkLength
              );

              slot.chargePositions[b * 3] = LightningBoltPool.TEMP_BEAD_POS.x;
              slot.chargePositions[b * 3 + 1] = LightningBoltPool.TEMP_BEAD_POS.y;
              slot.chargePositions[b * 3 + 2] = LightningBoltPool.TEMP_BEAD_POS.z;

              // Pulse brightness near impact
              const brightness = Math.min(1.5, strokeAlpha * (u > 0.85 ? 1.4 : 1.0));
              slot.chargeColors[b * 3] = baseColor.r * brightness;
              slot.chargeColors[b * 3 + 1] = baseColor.g * brightness;
              slot.chargeColors[b * 3 + 2] = baseColor.b * brightness;
            } else {
              // HIT GROUND AND DISSIPATED! Vanish immediately
              slot.chargeColors[b * 3] = 0;
              slot.chargeColors[b * 3 + 1] = 0;
              slot.chargeColors[b * 3 + 2] = 0;
            }
          }

          if (activeBeads === 0 && elapsedSec > fallDuration + (numBeads - 1) * 0.04) {
            slot.cascadingCharges.visible = false;
          }

          const cPosAttr = slot.cascadingCharges.geometry.getAttribute('position') as THREE.BufferAttribute;
          cPosAttr.needsUpdate = true;
          const cColAttr = slot.cascadingCharges.geometry.getAttribute('color') as THREE.BufferAttribute;
          cColAttr.needsUpdate = true;
        }

        // Impact 1: Mach Shockwave Ring expansion (0 - 200ms, on ground)
        if (slot.shockwaveRing && slot.shockwaveRing.visible) {
          const ringElapsed = elapsed / 200;
          if (ringElapsed >= 1.0) {
            slot.shockwaveRing.visible = false;
            (slot.shockwaveRing.material as THREE.MeshBasicMaterial).opacity = 0;
            this.updateShockwaveInstance(i, null, null, 0, 0);
          } else {
            const maxScale = slot.maxShockwaveScale || 1.8;
            const ringScale = 0.2 + ringElapsed * (maxScale - 0.2);
            slot.shockwaveRing.scale.set(ringScale, ringScale, 1);
            // Dynamically elevate to follow spherical curvature, 0% clipping
            LightningBoltPool.TEMP_NORMAL.copy(slot.shockwaveRing.position).normalize();
            slot.shockwaveRing.position.copy(LightningBoltPool.TEMP_NORMAL).multiplyScalar(EngineConfig.globe.radius + 0.45 + (ringScale * ringScale) / 200.0);
            const ringMat = slot.shockwaveRing.material as THREE.MeshBasicMaterial;
            ringMat.opacity = Math.max(0, (1.0 - ringElapsed) * 0.85);
            this.updateShockwaveInstance(i, slot.shockwaveRing.position, slot.shockwaveRing.quaternion, ringScale, ringMat.opacity);
          }
        } else {
          this.updateShockwaveInstance(i, null, null, 0, 0);
        }

        // Impact 2: Acoustic Water-Ripple Ring expansion (0 - 650ms, spreads outward like a water wave)
        if (slot.acousticRippleRing && slot.acousticRippleRing.visible) {
          const rippleElapsed = elapsed / 650;
          if (rippleElapsed >= 1.0) {
            slot.acousticRippleRing.visible = false;
            (slot.acousticRippleRing.material as THREE.MeshBasicMaterial).opacity = 0;
            this.updateRippleInstance(i, null, null, 0, 0);
          } else {
            const maxRipple = (slot.maxShockwaveScale || 1.8) * 2.2;
            const rippleScale = 0.3 + Math.sin(rippleElapsed * Math.PI * 0.5) * maxRipple;
            slot.acousticRippleRing.scale.set(rippleScale, rippleScale, 1);
            // Dynamically elevate to follow spherical curvature, 0% clipping
            LightningBoltPool.TEMP_NORMAL.copy(slot.acousticRippleRing.position).normalize();
            slot.acousticRippleRing.position.copy(LightningBoltPool.TEMP_NORMAL).multiplyScalar(EngineConfig.globe.radius + 0.45 + (rippleScale * rippleScale) / 200.0);
            const rippleMat = slot.acousticRippleRing.material as THREE.MeshBasicMaterial;
            rippleMat.opacity = Math.max(0, (1.0 - rippleElapsed) * 0.50);
            this.updateRippleInstance(i, slot.acousticRippleRing.position, slot.acousticRippleRing.quaternion, rippleScale, rippleMat.opacity);
          }
        } else {
          this.updateRippleInstance(i, null, null, 0, 0);
        }

        // Flash light decay
        if (slot.light) {
          const flashProgress = elapsed / this.flashDecayMs;
          const flashFade = Math.max(0, 1.0 - flashProgress);
          const distMult = Math.max(1.0, Math.min(2.8, this.cameraDistance / 160.0));
          slot.light.intensity =
            EngineConfig.vfx.flashIntensity * Math.min(2.0, Math.max(0.8, slot.intensity)) * flashFade * strokeAlpha * distMult;
        }

        // Trigger lingering plasma trace along the serpentine channel across all strikes just before discharge ends
        if (
          !slot.hasEmittedResidualSparks &&
          slot.chargePath &&
          (slot.durationMs - elapsed <= 250 || progress >= 0.80)
        ) {
          slot.hasEmittedResidualSparks = true;
          // Rich particle count (30-48 per bolt) distributed along serpentine channel
          const sparkCount = slot.classification === 'SUPERBOLT' ? 48 : (slot.classification === 'VIOLENT' ? 38 : 30);
          this.emitResidualSparks(
            slot.chargePath,
            slot.tierColor ?? LightningBoltPool.TIER_COLOR_STANDARD,
            sparkCount,
            currentTime
          );
        }
      }
    }

    // Update lingering residual plasma sparks (linger 1.5s - 2.5s, smooth sinusoidal twinkling along serpentine line)
    let activeSparkCount = 0;
    for (let s = 0; s < this.sparkMeta.length; s++) {
      const spark = this.sparkMeta[s];
      if (!spark.active) continue;

      const sparkElapsed = currentTime - spark.birthTime;
      if (sparkElapsed >= spark.lifetimeMs) {
        spark.active = false;
        continue;
      }

      const t = sparkElapsed / spark.lifetimeMs;
      // Drift outward slowly
      spark.pos.x += spark.vel.x * 0.016;
      spark.pos.y += spark.vel.y * 0.016;
      spark.pos.z += spark.vel.z * 0.016;

      // Accelerated exponential decay curve (punchy & crisp fade out)
      const fade = Math.max(0, 1.0 - Math.pow(t, 2.2));
      // Continuous sinusoidal twinkling (Math.sin^2 for buttery smooth pulse without sudden jumps)
      const sinVal = Math.sin((sparkElapsed * 0.001) * spark.freq + spark.phase);
      const twinkle = 0.25 + 0.75 * (sinVal * sinVal);
      const intensity = fade * twinkle;

      const idx = activeSparkCount * 3;
      this.sparkPositions[idx] = spark.pos.x;
      this.sparkPositions[idx + 1] = spark.pos.y;
      this.sparkPositions[idx + 2] = spark.pos.z;

      this.sparkColors[idx] = spark.color.r * intensity;
      this.sparkColors[idx + 1] = spark.color.g * intensity;
      this.sparkColors[idx + 2] = spark.color.b * intensity;

      activeSparkCount++;
    }

    if (this.sparkPointsMesh) {
      if (activeSparkCount > 0) {
        (this.sparkPointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (this.sparkPointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
        this.sparkPointsMesh.geometry.setDrawRange(0, activeSparkCount);
        this.sparkPointsMesh.visible = true;
      } else {
        this.sparkPointsMesh.visible = false;
      }
    }

    this.shockwaveMesh.instanceMatrix.needsUpdate = true;
    (this.shockwaveMesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    this.rippleMesh.instanceMatrix.needsUpdate = true;
    (this.rippleMesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  public getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].active) count++;
    }
    return count;
  }

  public getAvailableCount(): number {
    return this.maxBolts - this.getActiveCount();
  }

  public clear(): void {
    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      slot.active = false;
      slot.mesh.visible = false;
      if (slot.light) {
        slot.light.visible = false;
        slot.light.intensity = 0;
      }
      if (slot.shockwaveRing) {
        slot.shockwaveRing.visible = false;
      }
      if (slot.sheetGlow) {
        slot.sheetGlow.visible = false;
      }
      if (slot.cascadingCharges) {
        slot.cascadingCharges.visible = false;
        slot.chargeCount = 0;
        slot.chargePath = undefined;
      }
    }
    for (let s = 0; s < this.sparkMeta.length; s++) {
      this.sparkMeta[s].active = false;
    }
    if (this.sparkPointsMesh) {
      this.sparkPointsMesh.visible = false;
    }

    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxBolts; i++) {
      this.shockwaveMesh.setMatrixAt(i, zeroMat);
      this.rippleMesh.setMatrixAt(i, zeroMat);
      this.shockwaveAlphas[i] = 0;
      this.rippleAlphas[i] = 0;
    }
    this.shockwaveMesh.instanceMatrix.needsUpdate = true;
    (this.shockwaveMesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    this.rippleMesh.instanceMatrix.needsUpdate = true;
    (this.rippleMesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  public destroy(): void {
    this.clear();
    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      if (slot) {
        slot.mesh.geometry.dispose();
        (slot.mesh.material as THREE.Material).dispose();
        if (slot.light) {
          slot.light.dispose();
        }
        if (slot.shockwaveRing) {
          slot.shockwaveRing.geometry.dispose();
          (slot.shockwaveRing.material as THREE.Material).dispose();
        }
        if (slot.sheetGlow) {
          slot.sheetGlow.geometry.dispose();
          (slot.sheetGlow.material as THREE.Material).dispose();
        }
        if (slot.cascadingCharges) {
          slot.cascadingCharges.geometry.dispose();
          (slot.cascadingCharges.material as THREE.Material).dispose();
        }
      }
    }
    if (this.sparkPointsMesh) {
      this.sparkPointsMesh.geometry.dispose();
      (this.sparkPointsMesh.material as THREE.Material).dispose();
    }
    this.shockwaveMesh.geometry.dispose();
    (this.shockwaveMesh.material as THREE.Material).dispose();
    this.rippleMesh.geometry.dispose();
    (this.rippleMesh.material as THREE.Material).dispose();
    this.group.clear();
  }
}

