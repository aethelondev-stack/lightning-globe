import * as THREE from 'three';
import type { StormCell } from '../../types/cluster';
import type { IUpdatable } from '../../types';
import { latLngToVector3, haversineDistanceKm } from '../../utils/coordinates';
import { EngineConfig } from '../../core/Config';

export interface StormCellTelemetry {
  id: string;
  cell: StormCell;
  latitude: number;
  longitude: number;
  radiusKm: number;
  strikeCount: number;
  totalPowerGW: number;
  driftSpeedKmH: number;
  driftHeading: string;
  warningLevel: 'NORMAL' | 'ELEVATED' | 'CRITICAL';
}

interface HexagonSlot {
  mesh: THREE.Mesh;
  backdropMesh: THREE.Mesh;
  material: THREE.Material;
  scanlineMaterial: THREE.ShaderMaterial;
  edgeLine: THREE.LineLoop;
  outerEdgeLine: THREE.LineLoop;
  edgeMaterial: THREE.LineBasicMaterial;
  microHotspotMeshes: THREE.Mesh[];
  active: boolean;
  cellId: string | null;
  cellData: StormCell | null;

  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  currentRadius: number;
  targetRadius: number;
  currentOpacity: number;
  targetOpacity: number;
  currentEdgeOpacity: number;
  targetEdgeOpacity: number;

  currentColor: THREE.Color;
  targetColor: THREE.Color;
  currentEdgeColor: THREE.Color;
  targetEdgeColor: THREE.Color;

  lastTimestamp: number;
  lastLat: number;
  lastLon: number;
  driftSpeedKmH: number;
  driftHeading: string;
  passthroughGlitchUntil: number;
  growthStartTime?: number;
  growthDurationMs?: number;
  isDoubleStroke: boolean;
}

/**
 * StormCellRadar: Renders floating holographic honeycomb radar footprints.
 *
 * Capabilities:
 * - Floating Elevation & Spherical Curvature Compliance (1.1u + r * 0.04u).
 * - Holographic Scanline Shader & Deep Space Contrast Lens (high legibility over city lights).
 * - Dual-contour neon laser rim + 6 corner HUD reticle brackets.
 * - 4-Tier Color Coding: WHITE (core) -> BLUE (organizing) -> YELLOW (mature) -> RED (supercell).
 * - Dynamic 12-sector Micro-Hotspot Mini White Hexagons pulsing on recent strikes.
 * - Agar.io Style Cell Fusion visual convergence.
 * - Bolt Passthrough Glitch/Dip effect.
 * - Raycast Hit Detection & Closest Centroid Tie-Breaking.
 * - Smooth exponential lerping and zero per-frame heap allocations.
 */
export class StormCellRadar implements IUpdatable {
  public readonly group: THREE.Group;
  private camera: THREE.Camera | null = null;
  private readonly globeRadius: number;
  private readonly hexPool: HexagonSlot[] = [];
  private readonly maxCells: number = 48;

  private isEnabled: boolean = true;

  private static readonly Z_AXIS = new THREE.Vector3(0, 0, 1);
  private static readonly TEMP_NORMAL = new THREE.Vector3();
  private static readonly TEMP_LOCAL_CAM = new THREE.Vector3();
  private static readonly TEMP_SCALE = new THREE.Vector3();
  private static readonly TEMP_MATRIX = new THREE.Matrix4();
  private static readonly ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

  public readonly instancedHexMesh!: THREE.InstancedMesh;
  private readonly sharedScanlineMat!: THREE.ShaderMaterial;
  private readonly cellColorsArray: Float32Array = new Float32Array(48 * 3);
  private readonly cellParamsArray: Float32Array = new Float32Array(48 * 4);
  private readonly cellHitUVArray: Float32Array = new Float32Array(48 * 2);

  // 6 Meteorological Storm Classes (Foto 2 Specification Table):
  // 1. ISOLATED (İzole Çakma: < 5 km, 1-2/dk): Pure Diamond Ice White
  private static readonly COLOR_ISOLATED = new THREE.Color(0xf8fafc);
  public static readonly COLOR_ISOLATED_EDGE = StormCellRadar.COLOR_ISOLATED;

  // 2. SINGLE_CELL (Tek Hücre: 15 km, 3-10/dk): Electric Sky Cyan (Vibrant)
  private static readonly COLOR_SINGLE_CELL = new THREE.Color(0x00e5ff);
  public static readonly COLOR_SINGLE_CELL_EDGE = StormCellRadar.COLOR_SINGLE_CELL;

  // 3. MULTICELL (Çok Hücre: 40 km, 11-30/dk): Vivid Neon Emerald
  private static readonly COLOR_MULTICELL = new THREE.Color(0x00ff88);
  public static readonly COLOR_MULTICELL_EDGE = StormCellRadar.COLOR_MULTICELL;

  // 4. SUPERCELL (Süper Hücre: 60 km, 31-60/dk): Radiant Golden Amber
  private static readonly COLOR_SUPERCELL = new THREE.Color(0xffb700);
  public static readonly COLOR_SUPERCELL_EDGE = StormCellRadar.COLOR_SUPERCELL;

  // 5. MCS (Büyük Fırtına Kümesi: 120 km, 61-100/dk): Deep Ionic Vivid Magenta (Double Stroke)
  private static readonly COLOR_MCS = new THREE.Color(0xff007f);
  public static readonly COLOR_MCS_EDGE = StormCellRadar.COLOR_MCS;

  // 6. SQUALL_LINE (Fırtına Hattı: 250 km, 100+/dk): Ultra-Bright Plasma Red (Double Stroke)
  private static readonly COLOR_SQUALL_LINE = new THREE.Color(0xff1744);
  public static readonly COLOR_SQUALL_LINE_EDGE = StormCellRadar.COLOR_SQUALL_LINE;

  // 7. EXTREME_OUTBREAK (Süper Fırtına Patlaması: 650 km, 2000+ vuruş): Cosmic Pulsar Violet (Double Stroke)
  private static readonly COLOR_EXTREME = new THREE.Color(0x9d4edd);
  public static readonly COLOR_EXTREME_EDGE = StormCellRadar.COLOR_EXTREME;

  constructor(globeRadius: number = EngineConfig.globe.radius) {
    this.globeRadius = globeRadius;
    this.group = new THREE.Group();
    this.group.name = 'StormCellRadarGroup';
    this.group.visible = true;

    this.initPool();
  }

  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  private initPool(): void {
    // Exact Regular Hexagon bounding quad (PlaneGeometry)
    // The analytical Inigo Quilez regular hexagon SDF uses inradius r = 0.866 and corner radius R = 1.0,
    // which guarantees that all 6 corners and all 6 edges fit completely inside [-1, 1] without clipping.
    const hexGeo = new THREE.PlaneGeometry(2.0, 2.0);
    const outerGeo = new THREE.BufferGeometry();

    // 1. Single Shared Holographic Frosted Glass Shader for all 48 cells (1 single Draw Call)
    (this as any).sharedScanlineMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0.0 }
      },
      vertexShader: `
        attribute vec3 aCellColor;
        attribute vec4 aCellParams;
        attribute vec2 aStrikeHitUV;

        varying vec2 vUv;
        varying vec3 vColor;
        varying float vIsDoubleStroke;
        varying float vOpacity;
        varying float vGrowthProgress;
        varying float vStrikeHitTime;
        varying vec2 vStrikeHitUV;

        void main() {
          vUv = uv;
          vColor = aCellColor;
          vIsDoubleStroke = aCellParams.x;
          vOpacity = aCellParams.y;
          vGrowthProgress = aCellParams.z;
          vStrikeHitTime = aCellParams.w;
          vStrikeHitUV = aStrikeHitUV;

          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vIsDoubleStroke;
        varying float vOpacity;
        varying float vGrowthProgress;
        varying float vStrikeHitTime;
        varying vec2 vStrikeHitUV;

        uniform float uTime;

        // Inigo Quilez exact regular hexagon SDF
        // r is inradius = 0.866025404 (corners reach radius 1.0)
        float sdHexagon(vec2 p, float r) {
          const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
          p = abs(p);
          p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
          p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
          return length(p) * sign(p.y);
        }

        void main() {
          vec2 centered = (vUv - 0.5) * 2.0;

          // Inigo Quilez exact regular hexagon SDF
          float hexDist = sdHexagon(centered, 0.866);

          // Antialiased outer boundary clipping right at the outer edge
          if (hexDist > 0.04) discard;
          float hexMask = 1.0 - smoothstep(0.0, 0.015, hexDist);

          // Screen-space derivative ensures constant 2.5-3.0 pixel stroke width
          // Completely eliminates broken subpixel dashed lines and flickering at any zoom level
          float px = max(fwidth(hexDist), 0.0035);
          float halfWidth = px * 1.35;

          // 1. Primary outer stroke (Line 1): right at the outer perimeter (vivid class color)
          float stroke1 = 1.0 - smoothstep(halfWidth * 0.3, halfWidth * 1.25, abs(hexDist + halfWidth));
          stroke1 = clamp(stroke1, 0.0, 1.0);

          // 2. Tight secondary inner stroke (Line 2): only for top 3 largest classes (EXTREME, SQUALL_LINE, MCS)
          // Centers are ~3.2 screen pixels apart: sleek, tight, parallel double border
          float stroke2 = vIsDoubleStroke * (1.0 - smoothstep(halfWidth * 0.3, halfWidth * 1.25, abs(hexDist + halfWidth * 3.2)));
          stroke2 = clamp(stroke2, 0.0, 1.0);

          float strokeTotal = clamp(stroke1 + stroke2, 0.0, 1.0);

          // 3. Interior translucent body fill
          float innerMask = 1.0 - smoothstep(-halfWidth * 4.5, -halfWidth * 3.4, hexDist);

          // Strike excitation ripple: bright white flash of the SAME base color
          float strikeElapsed = uTime - vStrikeHitTime;
          float strikeFlash = 0.0;
          if (strikeElapsed >= 0.0 && strikeElapsed < 1.0 && hexDist <= 0.0) {
            float distToHit = length(centered - vStrikeHitUV);
            strikeFlash = exp(-strikeElapsed * 3.0) * exp(-pow(distToHit / 0.50, 2.0));
          }

          // Cell growth / tier surge wave
          float growthWave = 0.0;
          if (vGrowthProgress > 0.01 && vGrowthProgress < 0.99) {
            float gWaveFront = exp(-pow((hexDist + 0.8 - vGrowthProgress * 0.8) / 0.12, 2.0));
            growthWave = gWaveFront * (1.0 - vGrowthProgress) * 1.2;
          }

          // COLOR UNIFORMITY
          vec3 paleBodyColor = mix(vColor, vec3(0.92, 0.95, 1.0), 0.28);
          vec3 baseColor = mix(paleBodyColor, vColor, strokeTotal);

          // Strike excitations flash bright white luminosity
          vec3 finalColor = mix(baseColor, vec3(1.0), clamp(strikeFlash * 0.85 + growthWave * 0.5, 0.0, 1.0));

          // ALPHA
          float strokeAlpha = strokeTotal * 0.96;
          float breath = 0.92 + 0.08 * sin(uTime * 2.2);
          float bodyAlpha = innerMask * (0.34 * breath);

          float totalAlpha = clamp(
            (strokeAlpha + bodyAlpha + strikeFlash * 0.35 + growthWave * 0.35) * hexMask,
            0.0,
            0.98
          );

          if (totalAlpha < 0.005) discard;

          gl_FragColor = vec4(finalColor, totalAlpha);
        }
      `
    });

    const instancedGeo = hexGeo.clone();
    const colorAttr = new THREE.InstancedBufferAttribute(this.cellColorsArray, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    instancedGeo.setAttribute('aCellColor', colorAttr);

    const paramsAttr = new THREE.InstancedBufferAttribute(this.cellParamsArray, 4);
    paramsAttr.setUsage(THREE.DynamicDrawUsage);
    instancedGeo.setAttribute('aCellParams', paramsAttr);

    const hitUVAttr = new THREE.InstancedBufferAttribute(this.cellHitUVArray, 2);
    hitUVAttr.setUsage(THREE.DynamicDrawUsage);
    instancedGeo.setAttribute('aStrikeHitUV', hitUVAttr);

    instancedGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), this.globeRadius * 2.5);

    (this as any).instancedHexMesh = new THREE.InstancedMesh(instancedGeo, this.sharedScanlineMat, this.maxCells);
    this.instancedHexMesh.renderOrder = 25;
    this.instancedHexMesh.frustumCulled = false;
    this.instancedHexMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.maxCells; i++) {
      this.instancedHexMesh.setMatrixAt(i, StormCellRadar.ZERO_MATRIX);
    }
    this.instancedHexMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.instancedHexMesh);

    for (let i = 0; i < this.maxCells; i++) {
      // 1. Holographic Frosted Glass Shader Material with Analytical Hexagon SDF & Tight Double-Stroke Support
      const scanlineMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(0x00f0ff) },
          uIsDoubleStroke: { value: 0.0 },
          uOpacity: { value: 0.22 },
          uTime: { value: 0.0 },
          uStrikeHitTime: { value: -100.0 },
          uStrikeHitUV: { value: new THREE.Vector2(0.0, 0.0) },
          uGrowthProgress: { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          uniform vec3 uColor;
          uniform float uIsDoubleStroke;
          uniform float uOpacity;
          uniform float uTime;
          uniform float uStrikeHitTime;
          uniform vec2 uStrikeHitUV;
          uniform float uGrowthProgress;

          // Inigo Quilez exact regular hexagon SDF
          // r is inradius = 0.866025404 (corners reach radius 1.0)
          float sdHexagon(vec2 p, float r) {
            const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
            p = abs(p);
            p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
            p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
            return length(p) * sign(p.y);
          }

          void main() {
            vec2 centered = (vUv - 0.5) * 2.0;

            // Inigo Quilez exact regular hexagon SDF
            float hexDist = sdHexagon(centered, 0.866);

            // Antialiased outer boundary clipping right at the outer edge
            if (hexDist > 0.04) discard;
            float hexMask = 1.0 - smoothstep(0.0, 0.015, hexDist);

            // Screen-space derivative ensures constant 2.5-3.0 pixel stroke width
            // Completely eliminates broken subpixel dashed lines and flickering at any zoom level
            float px = max(fwidth(hexDist), 0.0035);
            float halfWidth = px * 1.35;

            // 1. Primary outer stroke (Line 1): right at the outer perimeter (vivid class color)
            float stroke1 = 1.0 - smoothstep(halfWidth * 0.3, halfWidth * 1.25, abs(hexDist + halfWidth));
            stroke1 = clamp(stroke1, 0.0, 1.0);

            // 2. Tight secondary inner stroke (Line 2): only for top 3 largest classes (EXTREME, SQUALL_LINE, MCS)
            // Centers are ~3.2 screen pixels apart: sleek, tight, parallel double border
            float stroke2 = uIsDoubleStroke * (1.0 - smoothstep(halfWidth * 0.3, halfWidth * 1.25, abs(hexDist + halfWidth * 3.2)));
            stroke2 = clamp(stroke2, 0.0, 1.0);

            float strokeTotal = clamp(stroke1 + stroke2, 0.0, 1.0);

            // 3. Interior translucent body fill
            // Begins inside the double stroke
            float innerMask = 1.0 - smoothstep(-halfWidth * 4.5, -halfWidth * 3.4, hexDist);

            // Strike excitation ripple: bright white flash of the SAME base color
            float strikeElapsed = uTime - uStrikeHitTime;
            float strikeFlash = 0.0;
            if (strikeElapsed >= 0.0 && strikeElapsed < 1.0 && hexDist <= 0.0) {
              float distToHit = length(centered - uStrikeHitUV);
              strikeFlash = exp(-strikeElapsed * 3.0) * exp(-pow(distToHit / 0.50, 2.0));
            }

            // Cell growth / tier surge wave
            float growthWave = 0.0;
            if (uGrowthProgress > 0.01 && uGrowthProgress < 0.99) {
              float gWaveFront = exp(-pow((hexDist + 0.8 - uGrowthProgress * 0.8) / 0.12, 2.0));
              growthWave = gWaveFront * (1.0 - uGrowthProgress) * 1.2;
            }

            // COLOR UNIFORMITY:
            // - Dış stroke: Canlı, parlak, doygun uColor
            // - İç gövde: Aynı rengin biraz daha soluk / yumuşak tonu (mix with pale white/pastel)
            vec3 paleBodyColor = mix(uColor, vec3(0.92, 0.95, 1.0), 0.28);
            vec3 baseColor = mix(paleBodyColor, uColor, strokeTotal);

            // Strike excitations flash bright white luminosity
            vec3 finalColor = mix(baseColor, vec3(1.0), clamp(strikeFlash * 0.85 + growthWave * 0.5, 0.0, 1.0));

            // ALPHA:
            // - Dış stroke: Katı, net, canlı (~0.95 alpha)
            // - İç gövde: Kendini belli eden, belirgin ve okunaklı yarı saydam kaplama (~0.34 alpha)
            float strokeAlpha = strokeTotal * 0.96;
            float breath = 0.92 + 0.08 * sin(uTime * 2.2);
            float bodyAlpha = innerMask * (0.34 * breath);

            float totalAlpha = clamp(
              (strokeAlpha + bodyAlpha + strikeFlash * 0.35 + growthWave * 0.35) * hexMask,
              0.0,
              0.98
            );

            if (totalAlpha < 0.005) discard;

            gl_FragColor = vec4(finalColor, totalAlpha);
          }
        `
      });
      scanlineMat.opacity = 0.20;

      const hexMesh = new THREE.Mesh(hexGeo, scanlineMat);
      hexMesh.visible = false;
      hexMesh.renderOrder = 25;

      // Auxiliary backdrop lens mesh for layer ordering and contrast lens
      const backdropMesh = new THREE.Mesh(hexGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.15, depthWrite: false }));
      backdropMesh.visible = false;
      backdropMesh.renderOrder = 23;

      // 2. Auxiliary laser rim material
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      const outerLine = new THREE.LineLoop(outerGeo, edgeMat);
      outerLine.renderOrder = 26;
      outerLine.visible = true;

      const miniHotspotMesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.ShaderMaterial({ blending: THREE.NormalBlending })
      );
      miniHotspotMesh.renderOrder = 27;
      miniHotspotMesh.scale.set(0.14, 0.14, 1);

      this.hexPool.push({
        mesh: hexMesh,
        backdropMesh,
        material: scanlineMat,
        scanlineMaterial: scanlineMat,
        edgeLine: outerLine,
        outerEdgeLine: outerLine,
        edgeMaterial: edgeMat,
        microHotspotMeshes: [miniHotspotMesh],
        active: false,
        cellId: null,
        cellData: null,

        currentPos: new THREE.Vector3(),
        targetPos: new THREE.Vector3(),
        currentRadius: 0.1,
        targetRadius: 0.1,
        currentOpacity: 0.0,
        targetOpacity: 0.0,
        currentEdgeOpacity: 0.0,
        targetEdgeOpacity: 0.0,

        currentColor: new THREE.Color(0x00f0ff),
        targetColor: new THREE.Color(0x00f0ff),
        currentEdgeColor: new THREE.Color(0x00f0ff),
        targetEdgeColor: new THREE.Color(0x00f0ff),

        lastTimestamp: 0,
        lastLat: 0,
        lastLon: 0,
        driftSpeedKmH: 0,
        driftHeading: '↗',
        passthroughGlitchUntil: 0,
        isDoubleStroke: false
      });
    }
  }

  /**
   * Updates target parameters of storm cell slots from StormCellBatcher.
   */
  public updateCells(cells: StormCell[]): void {
    const activeSlice = cells.slice(0, this.maxCells);
    const usedSlotIndices = new Set<number>();
    const now = Date.now();

    // 1. Match cells to existing slots with same cellId to maintain smooth continuity
    for (let c = 0; c < activeSlice.length; c++) {
      const cell = activeSlice[c];
      let slotIdx = this.hexPool.findIndex((s, idx) => !usedSlotIndices.has(idx) && s.cellId === cell.id);

      // If not found, pick first available inactive or unassigned slot
      if (slotIdx === -1) {
        slotIdx = this.hexPool.findIndex((s, idx) => !usedSlotIndices.has(idx) && !s.active);
      }
      if (slotIdx === -1) {
        slotIdx = this.hexPool.findIndex((_, idx) => !usedSlotIndices.has(idx));
      }

      if (slotIdx !== -1) {
        usedSlotIndices.add(slotIdx);
        const slot = this.hexPool[slotIdx];
        const isNewCell = slot.cellId !== cell.id;
        slot.active = true;
        slot.cellId = cell.id;
        slot.cellData = cell;

        // Dynamic Tone & Footprint Selection according to 6 Meteorological Classes (Foto 2)
        const stormClass = cell.stormClass ?? (
          cell.tier === 'RED' ? 'SUPERCELL' : (cell.tier === 'YELLOW' ? 'MULTICELL' : (cell.tier === 'BLUE' ? 'SINGLE_CELL' : 'ISOLATED'))
        );

        let visualRadius = 0.55;
        let isDoubleStroke = false;

        if (stormClass === 'EXTREME_OUTBREAK' || cell.tier === 'EXTREME') {
          slot.targetColor.copy(StormCellRadar.COLOR_EXTREME);
          visualRadius = 5.40; // 500+ km footprint (Excel)
          isDoubleStroke = true;
        } else if (stormClass === 'SQUALL_LINE') {
          slot.targetColor.copy(StormCellRadar.COLOR_SQUALL_LINE);
          visualRadius = 4.50; // 380 - 600 km footprint (Excel)
          isDoubleStroke = true;
        } else if (stormClass === 'MCS') {
          slot.targetColor.copy(StormCellRadar.COLOR_MCS);
          visualRadius = 3.65; // 280 - 380 km footprint (Excel)
          isDoubleStroke = true;
        } else if (stormClass === 'SUPERCELL') {
          slot.targetColor.copy(StormCellRadar.COLOR_SUPERCELL);
          visualRadius = 2.85; // 190 - 280 km footprint (Excel)
          isDoubleStroke = false;
        } else if (stormClass === 'MULTICELL') {
          slot.targetColor.copy(StormCellRadar.COLOR_MULTICELL);
          visualRadius = 2.05; // 100 - 190 km footprint (Excel)
          isDoubleStroke = false;
        } else if (stormClass === 'SINGLE_CELL') {
          slot.targetColor.copy(StormCellRadar.COLOR_SINGLE_CELL);
          visualRadius = 1.35; // 45 - 100 km footprint (Excel)
          isDoubleStroke = false;
        } else { // ISOLATED
          slot.targetColor.copy(StormCellRadar.COLOR_ISOLATED);
          visualRadius = 0.70; // < 45 km footprint (Excel)
          isDoubleStroke = false;
        }
        slot.targetEdgeColor.copy(slot.targetColor); // Always the EXACT same color!
        slot.targetRadius = visualRadius;
        slot.isDoubleStroke = isDoubleStroke;

        // Sleek Planetary Curvature Compliance (Altitude 1.20u, safely floats above 0.68u traces and 0.50u country polygons)
        const altitudeFraction = 1.20 / this.globeRadius;
        const targetWorldPos = latLngToVector3(
          cell.centroid.latitude,
          cell.centroid.longitude,
          altitudeFraction,
          this.globeRadius
        );
        slot.targetPos.copy(targetWorldPos);

        // Drift speed and heading calculation
        if (slot.lastTimestamp > 0 && (now - slot.lastTimestamp) > 1500) {
          const dtHours = (now - slot.lastTimestamp) / 3600000;
          const dLat = cell.centroid.latitude - slot.lastLat;
          const dLon = cell.centroid.longitude - slot.lastLon;
          const distKm = Math.hypot(dLat * 111, dLon * 111 * Math.cos(cell.centroid.latitude * Math.PI / 180));
          const speed = Math.min(180, distKm / dtHours);
          if (speed > 5) {
            slot.driftSpeedKmH = Math.round(speed);
            const angle = Math.atan2(dLat, dLon) * (180 / Math.PI);
            if (angle > -22.5 && angle <= 22.5) slot.driftHeading = '→';
            else if (angle > 22.5 && angle <= 67.5) slot.driftHeading = '↗';
            else if (angle > 67.5 && angle <= 112.5) slot.driftHeading = '↑';
            else if (angle > 112.5 && angle <= 157.5) slot.driftHeading = '↖';
            else if (angle > -67.5 && angle <= -22.5) slot.driftHeading = '↘';
            else if (angle > -112.5 && angle <= -67.5) slot.driftHeading = '↓';
            else if (angle > -157.5 && angle <= -112.5) slot.driftHeading = '↙';
            else slot.driftHeading = '←';
          }
        }
        slot.lastLat = cell.centroid.latitude;
        slot.lastLon = cell.centroid.longitude;
        slot.lastTimestamp = now;

        // Attach rich metadata to mesh for raycasting
        const totalPowerGW = cell.strikeCount * (Math.abs(cell.meanIntensity) * 0.12);
        slot.mesh.userData = {
          telemetry: {
            id: cell.id,
            cell,
            latitude: cell.centroid.latitude,
            longitude: cell.centroid.longitude,
            radiusKm: cell.boundingRadiusKm,
            strikeCount: cell.strikeCount,
            totalPowerGW,
            driftSpeedKmH: slot.driftSpeedKmH,
            driftHeading: slot.driftHeading,
            warningLevel: cell.warningLevel
          } as StormCellTelemetry
        };

        // Opacity based on fadeProgress (rich, vibrant body fill)
        const fadeMultiplier = Math.max(0, 1.0 - (cell.fadeProgress ?? 0));
        slot.targetOpacity = 0.38 * fadeMultiplier;
        slot.targetEdgeOpacity = 1.0 * fadeMultiplier;

        // If slot was previously inactive or assigned a new cell, snap immediately for instant 0ms appearance
        if (slot.currentOpacity <= 0.01 || isNewCell) {
          slot.currentPos.copy(targetWorldPos);
          slot.currentRadius = visualRadius;
          slot.currentOpacity = slot.targetOpacity;
          slot.currentEdgeOpacity = slot.targetEdgeOpacity;
          slot.currentColor.copy(slot.targetColor);
          slot.currentEdgeColor.copy(slot.targetEdgeColor);
        }

        // Agar.io Style Cell Fusion: converging towards fusion midpoint
        if (cell.fusionState?.active && cell.fusionState.midLat !== undefined && cell.fusionState.midLon !== undefined) {
          const midPos = latLngToVector3(
            cell.fusionState.midLat,
            cell.fusionState.midLon,
            altitudeFraction,
            this.globeRadius
          );
          slot.targetPos.lerp(midPos, cell.fusionState.progress);
        }
      }
    }

    // 2. Slots not assigned to an active cell smoothly fade out
    for (let i = 0; i < this.hexPool.length; i++) {
      if (!usedSlotIndices.has(i)) {
        const slot = this.hexPool[i];
        slot.active = false;
        slot.targetOpacity = 0.0;
        slot.targetEdgeOpacity = 0.0;
      }
    }
  }

  /**
   * Triggers an internal electric discharge excitation ripple strictly inside the targeted honeycomb.
   */
  public triggerCellStrikeImpact(
    cellIdOrLat: string | number,
    hitLatOrLon?: number,
    hitLon?: number,
    _strikeColor?: THREE.Color
  ): void {
    const now = Date.now();
    for (let i = 0; i < this.hexPool.length; i++) {
      const slot = this.hexPool[i];
      if (!slot.active || !slot.cellData) continue;

      let matched = false;
      let strikeLat = 0;
      let strikeLon = 0;

      if (typeof cellIdOrLat === 'string') {
        matched = slot.cellId === cellIdOrLat;
        if (hitLatOrLon !== undefined && hitLon !== undefined) {
          strikeLat = hitLatOrLon;
          strikeLon = hitLon;
        } else {
          strikeLat = slot.lastLat;
          strikeLon = slot.lastLon;
        }
      } else if (hitLatOrLon !== undefined) {
        const d = haversineDistanceKm(cellIdOrLat, hitLatOrLon, slot.lastLat, slot.lastLon);
        matched = d <= slot.cellData.boundingRadiusKm;
        strikeLat = cellIdOrLat;
        strikeLon = hitLatOrLon;
      }

      if (matched) {
        // Internal electrical excitation surge for 450ms
        slot.passthroughGlitchUntil = now + 450;

        // Calculate localized impact UV within the hexagon
        const dLat = (strikeLat - slot.lastLat) * 111.0;
        const dLon = (strikeLon - slot.lastLon) * 111.0 * Math.cos((slot.lastLat * Math.PI) / 180.0);
        const radius = Math.max(10, slot.cellData.boundingRadiusKm);
        const u = Math.max(0.08, Math.min(0.92, 0.5 + (dLon / radius) * 0.45));
        const v = Math.max(0.08, Math.min(0.92, 0.5 + (dLat / radius) * 0.45));

        slot.scanlineMaterial.uniforms.uStrikeHitUV.value.set(u, v);
        slot.scanlineMaterial.uniforms.uStrikeHitTime.value = now / 1000.0;
        break; // Only the struck honeycomb is excited!
      }
    }
  }

  /**
   * Triggers atmospheric pre-ionization warmup on the approached storm cell as the camera dives into range.
   * Gives an organic visual cue that an electrical discharge tension is accumulating.
   */
  public triggerApproachWarmup(
    cellIdOrLat: string | number,
    latOrLon?: number,
    lon?: number,
    durationMs: number = 1500
  ): void {
    const now = Date.now();
    for (let i = 0; i < this.hexPool.length; i++) {
      const slot = this.hexPool[i];
      if (!slot.active || !slot.cellData) continue;

      let matched = false;
      if (typeof cellIdOrLat === 'string') {
        if (slot.cellId === cellIdOrLat) {
          matched = true;
        } else if (latOrLon !== undefined && lon !== undefined) {
          const d = haversineDistanceKm(latOrLon, lon, slot.lastLat, slot.lastLon);
          matched = d <= Math.max(80, slot.cellData.boundingRadiusKm * 1.5);
        }
      } else if (latOrLon !== undefined) {
        const d = haversineDistanceKm(cellIdOrLat, latOrLon, slot.lastLat, slot.lastLon);
        matched = d <= Math.max(80, slot.cellData.boundingRadiusKm * 1.5);
      }

      if (matched) {
        slot.passthroughGlitchUntil = Math.max(slot.passthroughGlitchUntil, now + durationMs);
        slot.scanlineMaterial.uniforms.uStrikeHitUV.value.set(0.5, 0.5);
        slot.scanlineMaterial.uniforms.uStrikeHitTime.value = (now - 200) / 1000.0;
        break;
      }
    }
  }


  /**
   * Finds the active cellId enclosing the coordinates, or null if none.
   */
  public findCellAt(lat: number, lon: number): string | null {
    for (let i = 0; i < this.hexPool.length; i++) {
      const slot = this.hexPool[i];
      if (slot.active && slot.cellData) {
        const d = haversineDistanceKm(lat, lon, slot.lastLat, slot.lastLon);
        if (d <= slot.cellData.boundingRadiusKm) {
          return slot.cellId;
        }
      }
    }
    return null;
  }

  /**
   * Triggers a brief optical passthrough glitch when a lightning bolt penetrates the honeycomb.
   */
  public triggerPassthroughGlitch(lat: number, lon: number): void {
    this.triggerCellStrikeImpact(lat, lon);
  }

  /**
   * Triggers an energetic growth or fusion surge animation on a storm cell.
   */
  public triggerGrowthAnimation(cellId: string, _color?: THREE.Color): void {
    const now = Date.now();
    for (let i = 0; i < this.hexPool.length; i++) {
      const slot = this.hexPool[i];
      if (slot.active && slot.cellId === cellId) {
        slot.growthStartTime = now;
        slot.growthDurationMs = 1200;
        break;
      }
    }
  }

  /**
   * Triggers a cute interior fluid neon saturation ripple when a strike hits inside this storm cell.
   * Only affects the interior body fill (hexDist <= 0), without altering outer rim or neighboring cells.
   */
  public triggerStrikeImpact(cellId: string | null, lat?: number, lon?: number, _peakCurrent?: number): void {
    if (!this.isEnabled) return;
    const now = Date.now();

    for (let i = 0; i < this.hexPool.length; i++) {
      const slot = this.hexPool[i];
      if (!slot.active || !slot.mesh.visible || !slot.cellData) continue;

      let matched = false;
      if (cellId && slot.cellId === cellId) {
        matched = true;
      } else if (lat !== undefined && lon !== undefined) {
        const d = haversineDistanceKm(lat, lon, slot.lastLat, slot.lastLon);
        if (d <= Math.max(10, slot.cellData.boundingRadiusKm)) {
          matched = true;
        }
      }

      if (matched) {
        const cellLat = slot.cellData.centroid.latitude;
        const cellLon = slot.cellData.centroid.longitude;
        const strikeLat = lat ?? cellLat;
        const strikeLon = lon ?? cellLon;
        const dLat = strikeLat - cellLat;
        const dLon = (strikeLon - cellLon) * Math.cos((cellLat * Math.PI) / 180);

        // Normalize offset to UV space [-0.85, 0.85] based on cell radius (1 deg ~ 111 km)
        const radiusDeg = Math.max(0.15, (slot.currentRadius || 25) / 111.0);
        const u = Math.max(-0.85, Math.min(0.85, dLon / radiusDeg));
        const v = Math.max(-0.85, Math.min(0.85, dLat / radiusDeg));

        const uniforms = slot.scanlineMaterial.uniforms;
        uniforms.uStrikeHitTime.value = now / 1000.0;
        uniforms.uStrikeHitUV.value.set(u, v);

        // Subtle interior excitation surge without breaking geometry
        slot.passthroughGlitchUntil = now + 400;
        break;
      }
    }
  }

  /**
   * Performs raycasting against active storm cells, resolving ties by closest centroid and activity.
   */
  public getCellAtRaycast(raycaster: THREE.Raycaster): StormCellTelemetry | null {
    if (!this.isEnabled) return null;

    // Fast check against instanced mesh
    const instancedIntersects = raycaster.intersectObject(this.instancedHexMesh, false);
    if (instancedIntersects.length > 0) {
      const candidates: { telemetry: StormCellTelemetry; distance: number; strikeCount: number }[] = [];
      for (const hit of instancedIntersects) {
        if (hit.instanceId !== undefined) {
          const slot = this.hexPool[hit.instanceId];
          if (slot && slot.active && slot.mesh.visible && slot.mesh.userData?.telemetry) {
            candidates.push({
              telemetry: slot.mesh.userData.telemetry as StormCellTelemetry,
              distance: hit.distance,
              strikeCount: slot.mesh.userData.telemetry.strikeCount ?? 0
            });
          }
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          if (Math.abs(a.strikeCount - b.strikeCount) > 5) {
            return b.strikeCount - a.strikeCount;
          }
          return a.distance - b.distance;
        });
        return candidates[0].telemetry;
      }
    }

    const activeMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < this.hexPool.length; i++) {
      if (this.hexPool[i].active && this.hexPool[i].mesh.visible) {
        activeMeshes.push(this.hexPool[i].mesh);
      }
    }

    if (activeMeshes.length === 0) return null;

    const intersects = raycaster.intersectObjects(activeMeshes, false);
    if (intersects.length === 0) return null;

    // Tie-breaker: If ray intersects multiple overlapping cells, pick closest to centroid with highest strike count
    intersects.sort((a, b) => {
      const telA = a.object.userData?.telemetry as StormCellTelemetry | undefined;
      const telB = b.object.userData?.telemetry as StormCellTelemetry | undefined;
      const countA = telA?.strikeCount ?? 0;
      const countB = telB?.strikeCount ?? 0;
      if (Math.abs(countA - countB) > 5) {
        return countB - countA;
      }
      return a.distance - b.distance;
    });

    return (intersects[0].object.userData?.telemetry as StormCellTelemetry) ?? null;
  }

  /**
   * Frame update: smooth exponential lerp for all active slots with analytical horizon culling.
   */
  public update(delta: number = 0.016, elapsedOrCamera?: number | THREE.Vector3, cameraPosition?: THREE.Vector3): void {
    if (!this.isEnabled) {
      if (this.group.visible) this.group.visible = false;
      return;
    }
    if (!this.group.visible) this.group.visible = true;

    // Resolve camera position for analytical horizon culling (P · C > R^2)
    let camPos: THREE.Vector3 | undefined;
    if (elapsedOrCamera instanceof THREE.Vector3) {
      camPos = elapsedOrCamera;
    } else if (cameraPosition instanceof THREE.Vector3) {
      camPos = cameraPosition;
    } else if (this.camera) {
      camPos = this.camera.position;
    }

    let hasCam = false;
    const localCam = StormCellRadar.TEMP_LOCAL_CAM;
    if (camPos) {
      hasCam = true;
      localCam.copy(camPos);
      if (this.group.parent) {
        this.group.parent.updateWorldMatrix(true, false);
        this.group.worldToLocal(localCam);
      }
    }

    // Frame-rate independent exponential lerp factor (~5.5 Hz)
    const lerpFactor = 1.0 - Math.exp(-5.5 * Math.min(0.1, delta));
    const now = Date.now();

    for (let i = 0; i < this.hexPool.length; i++) {
      const slot = this.hexPool[i];

      // Performance bypass: skip dormant slots that are fully faded out
      if (!slot.active && !slot.mesh.visible && slot.targetOpacity === 0) continue;

      // Interpolate radius, opacities, colors, and positions
      slot.currentRadius += (slot.targetRadius - slot.currentRadius) * lerpFactor;
      slot.currentOpacity += (slot.targetOpacity - slot.currentOpacity) * lerpFactor;
      slot.currentEdgeOpacity += (slot.targetEdgeOpacity - slot.currentEdgeOpacity) * lerpFactor;
      slot.currentPos.lerp(slot.targetPos, lerpFactor);
      // Project cleanly to spherical altitude above globe (eliminates chord dipping & polygon twisting)
      const targetAlt = this.globeRadius + 1.20;
      slot.currentPos.normalize().multiplyScalar(targetAlt);

      slot.currentColor.lerp(slot.targetColor, lerpFactor);
      slot.currentEdgeColor.lerp(slot.targetEdgeColor, lerpFactor);

      // Visibility threshold check
      if (slot.currentOpacity < 0.004 && slot.targetOpacity === 0) {
        if (slot.mesh.visible) {
          slot.mesh.visible = false;
          slot.cellId = null;
          slot.cellData = null;
        }
        this.instancedHexMesh.setMatrixAt(i, StormCellRadar.ZERO_MATRIX);
        this.cellParamsArray[i * 4 + 1] = 0.0;
      } else {
        // Analytical Horizon / Spherical Culling:
        // Culls cells on the rear hemisphere (P · C <= 0) while keeping all front/oblique cells visible
        if (hasCam) {
          const dot = slot.currentPos.dot(localCam);
          if (dot <= 0) {
            if (slot.mesh.visible) {
              slot.mesh.visible = false;
            }
            this.instancedHexMesh.setMatrixAt(i, StormCellRadar.ZERO_MATRIX);
            this.cellParamsArray[i * 4 + 1] = 0.0;
            continue;
          }
        }

        if (!slot.mesh.visible) {
          slot.mesh.visible = true;
        }

        slot.mesh.position.copy(slot.currentPos);
        StormCellRadar.TEMP_NORMAL.copy(slot.currentPos).normalize();
        slot.mesh.quaternion.setFromUnitVectors(StormCellRadar.Z_AXIS, StormCellRadar.TEMP_NORMAL);
        slot.mesh.scale.set(slot.currentRadius, slot.currentRadius, 1);
        StormCellRadar.TEMP_SCALE.set(slot.currentRadius, slot.currentRadius, 1);
        StormCellRadar.TEMP_MATRIX.compose(slot.currentPos, slot.mesh.quaternion, StormCellRadar.TEMP_SCALE);
        this.instancedHexMesh.setMatrixAt(i, StormCellRadar.TEMP_MATRIX);

        slot.scanlineMaterial.uniforms.uTime.value = now / 1000.0;

        // Growth or fusion wave animation
        let prog = 0.0;
        if (slot.growthStartTime && (now - slot.growthStartTime) < (slot.growthDurationMs || 1200)) {
          prog = (now - slot.growthStartTime) / (slot.growthDurationMs || 1200);
          slot.scanlineMaterial.uniforms.uGrowthProgress.value = prog;
        } else {
          slot.scanlineMaterial.uniforms.uGrowthProgress.value = 0.0;
        }

        // Update double stroke and uniform color
        slot.scanlineMaterial.uniforms.uIsDoubleStroke.value = slot.isDoubleStroke ? 1.0 : 0.0;
        slot.scanlineMaterial.uniforms.uColor.value.copy(slot.currentColor);

        // Passthrough glitch / internal electrical excitation surge
        const isImpactSurge = now < slot.passthroughGlitchUntil;
        if (isImpactSurge) {
          const surgeFrac = Math.max(0, (slot.passthroughGlitchUntil - now) / 450);
          slot.scanlineMaterial.uniforms.uOpacity.value = slot.currentOpacity * 0.45;
          slot.edgeMaterial.color.copy(slot.currentColor);
          slot.edgeMaterial.opacity = Math.min(1.0, slot.currentEdgeOpacity + surgeFrac * 0.45);
        } else {
          slot.scanlineMaterial.uniforms.uOpacity.value = slot.currentOpacity;
          slot.edgeMaterial.color.copy(slot.currentColor);
          slot.edgeMaterial.opacity = slot.currentEdgeOpacity;
        }

        // Update instanced attributes
        this.cellColorsArray[i * 3 + 0] = slot.currentColor.r;
        this.cellColorsArray[i * 3 + 1] = slot.currentColor.g;
        this.cellColorsArray[i * 3 + 2] = slot.currentColor.b;

        this.cellParamsArray[i * 4 + 0] = slot.isDoubleStroke ? 1.0 : 0.0;
        this.cellParamsArray[i * 4 + 1] = slot.scanlineMaterial.uniforms.uOpacity.value;
        this.cellParamsArray[i * 4 + 2] = prog;
        this.cellParamsArray[i * 4 + 3] = slot.scanlineMaterial.uniforms.uStrikeHitTime.value;

        this.cellHitUVArray[i * 2 + 0] = slot.scanlineMaterial.uniforms.uStrikeHitUV.value.x;
        this.cellHitUVArray[i * 2 + 1] = slot.scanlineMaterial.uniforms.uStrikeHitUV.value.y;
      }
    }

    this.sharedScanlineMat.uniforms.uTime.value = now / 1000.0;
    this.instancedHexMesh.instanceMatrix.needsUpdate = true;
    (this.instancedHexMesh.geometry.getAttribute('aCellColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.instancedHexMesh.geometry.getAttribute('aCellParams') as THREE.BufferAttribute).needsUpdate = true;
    (this.instancedHexMesh.geometry.getAttribute('aStrikeHitUV') as THREE.BufferAttribute).needsUpdate = true;
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.group.visible = enabled;
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public clear(): void {
    for (let i = 0; i < this.hexPool.length; i++) {
      const slot = this.hexPool[i];
      slot.active = false;
      slot.cellId = null;
      slot.cellData = null;
      slot.targetOpacity = 0.0;
      slot.currentOpacity = 0.0;
      slot.mesh.visible = false;
      this.instancedHexMesh.setMatrixAt(i, StormCellRadar.ZERO_MATRIX);
      this.cellParamsArray[i * 4 + 1] = 0.0;
    }
    this.instancedHexMesh.instanceMatrix.needsUpdate = true;
    (this.instancedHexMesh.geometry.getAttribute('aCellParams') as THREE.BufferAttribute).needsUpdate = true;
  }

  public destroy(): void {
    this.clear();
    for (let i = 0; i < this.hexPool.length; i++) {
      this.hexPool[i].scanlineMaterial.dispose();
      this.hexPool[i].edgeMaterial.dispose();
    }
    this.instancedHexMesh.geometry.dispose();
    this.sharedScanlineMat.dispose();
  }
}


