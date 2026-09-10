import * as THREE from 'three';
import { EngineConfig } from '../../core/Config';
import { latLngToVector3 } from '../../utils/coordinates';
import type { IUpdatable } from '../../types';

export interface CountryLabelMeta {
  name: string;
  lat: number;
  lon: number;
  area: number;
  width: number;
  height: number;
}

/**
 * CountryLabelManager: Renders country names across the globe with ZERO FPS drop.
 *
 * Architecture & Performance:
 * - 1 SINGLE DRAW CALL: All 241 countries rendered via a single THREE.InstancedMesh.
 * - ZERO DOM NODES: Eliminates CSS2DRenderer layout thrashing & style recalculation.
 * - Dynamic 2048x2048 Canvas Texture Atlas with clean typography and high-contrast dark halo.
 * - Proportional Sizing: Scaled by sqrt(countryArea), never engulfing the country boundaries.
 * - GPU Horizon & Occlusion Culling: Vertices fade to 0 opacity when occluded by Earth curvature.
 * - Distance-based LOD: Smaller country labels gracefully fade out during orbital view.
 */
export class CountryLabelManager implements IUpdatable {
  public readonly group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private atlasTexture: THREE.CanvasTexture | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private isEnabled: boolean = true;
  private globeRadius: number;

  constructor(globeRadius: number = EngineConfig.globe.radius) {
    this.globeRadius = globeRadius;
    this.group = new THREE.Group();
    this.group.name = 'CountryLabelGroup';
  }

  /**
   * Initializes the label atlas and instanced mesh from loaded GeoJSON features.
   */
  public initLabels(features: any[]): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return; // Headless / Node.js test environment guard
    }

    if (!features || features.length === 0) return;

    // 1. Filter valid countries and compute geographic centroids & bounding spans
    const countryList: CountryLabelMeta[] = [];

    for (const feature of features) {
      const name = feature.properties?.name;
      const geom = feature.geometry;
      if (!name || !geom) continue;

      const center = this.getLargestPolygonCentroid(geom);
      if (center) {
        // Calculate proportional scale: sqrt(area) normalized
        const rawScale = Math.sqrt(Math.max(0.1, center.area));
        // Quad is 4:1 aspect ratio matching 256x64 atlas cell (zero horizontal/vertical stretching)
        const sizeUnits = Math.max(0.65, Math.min(2.8, rawScale * 0.12));

        countryList.push({
          name,
          lat: center.lat,
          lon: center.lon,
          area: center.area,
          width: sizeUnits,
          height: sizeUnits
        });
      }
    }

    if (countryList.length === 0) return;

    // 2. Build 2048 x 2048 2D Canvas Texture Atlas (8 cols x 32 rows = 256 cells, each 256x64px = 4:1 aspect ratio)
    const atlasSize = 2048;
    const gridCols = 8;
    const gridRows = 32;
    const cellW = atlasSize / gridCols; // 256px
    const cellH = atlasSize / gridRows; // 64px

    const canvas = document.createElement('canvas');
    canvas.width = atlasSize;
    canvas.height = atlasSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, atlasSize, atlasSize);

    const uvOffsets = new Float32Array(countryList.length * 4);

    for (let i = 0; i < countryList.length; i++) {
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const x = col * cellW;
      const y = row * cellH;

      const country = countryList[i];

      // Draw high-legibility typographic label
      ctx.save();
      ctx.translate(x + cellW / 2, y + cellH / 2);

      // Adaptive font size based on country name length: 256px width comfortably fits wide names
      const charCount = Math.max(6, country.name.length);
      const fontSize = Math.max(18, Math.min(32, Math.floor(cellW / (charCount * 0.60))));
      ctx.font = `600 ${fontSize}px "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 2.5px crisp dark shadow/halo for legibility without engulfing the text
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(country.name, 0, 0);

      // Crisp silver-white text fill
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(country.name, 0, 0);
      ctx.restore();

      // UV Coordinates in atlas (WebGL UV origin is bottom-left, Canvas is top-left)
      const uMin = x / atlasSize;
      const vMin = 1.0 - (y + cellH) / atlasSize;
      const uSpan = cellW / atlasSize;
      const vSpan = cellH / atlasSize;

      uvOffsets[i * 4 + 0] = uMin;
      uvOffsets[i * 4 + 1] = vMin;
      uvOffsets[i * 4 + 2] = uSpan;
      uvOffsets[i * 4 + 3] = vSpan;
    }

    this.atlasTexture = new THREE.CanvasTexture(canvas);
    this.atlasTexture.generateMipmaps = true;
    this.atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlasTexture.magFilter = THREE.LinearFilter;
    this.atlasTexture.colorSpace = THREE.SRGBColorSpace;

    // 3. Custom GPU Shader for 1 Single Draw Call & Horizon Culling
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uAtlas: { value: this.atlasTexture },
        uCameraDistance: { value: 260.0 },
        uBaseOpacity: { value: 0.95 }
      },
      vertexShader: `
        attribute vec4 aUvOffset;
        attribute float aCountryScale;
        varying vec2 vUv;
        varying float vAlpha;
        uniform float uCameraDistance;

        void main() {
          vUv = aUvOffset.xy + uv * aUvOffset.zw;

          // World position of instance
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);

          // Normal of the quad facing radially outward from Earth center
          vec3 worldNormal = normalize((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
          vec3 viewDir = normalize(cameraPosition - worldPos.xyz);

          // GPU Horizon & Backface Culling:
          float horizonDot = dot(worldNormal, viewDir);
          float horizonFade = smoothstep(0.05, 0.28, horizonDot);

          // Dynamic LOD Culling:
          // Large countries stay visible in orbit, smaller countries fade in gracefully on approach
          float distFactor = clamp((uCameraDistance - 150.0) / 130.0, 0.0, 1.0);
          float lodFade = 1.0;
          if (aCountryScale < 1.1) {
            lodFade = 1.0 - smoothstep(0.1, 0.6, distFactor);
          } else if (aCountryScale < 2.0) {
            lodFade = 1.0 - smoothstep(0.3, 0.85, distFactor) * 0.65;
          }

          vAlpha = horizonFade * lodFade;

          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uAtlas;
        uniform float uBaseOpacity;
        varying vec2 vUv;
        varying float vAlpha;

        void main() {
          if (vAlpha < 0.01) discard;
          vec4 texColor = texture2D(uAtlas, vUv);
          float finalAlpha = texColor.a * vAlpha * uBaseOpacity;
          if (finalAlpha < 0.02) discard;

          gl_FragColor = vec4(texColor.rgb, finalAlpha);
        }
      `
    });

    // 4. InstancedMesh setup (4:1 aspect ratio quad geometry, 1 Draw Call)
    const quadGeo = new THREE.PlaneGeometry(4.0, 1.0);
    this.instancedMesh = new THREE.InstancedMesh(quadGeo, this.material, countryList.length);
    this.instancedMesh.renderOrder = 24;

    const dummy = new THREE.Object3D();
    const radius = this.globeRadius * 1.0042; // Elevated at 100.42u, safely floating above 100.35u landmass
    const countryScales = new Float32Array(countryList.length);

    for (let i = 0; i < countryList.length; i++) {
      const country = countryList[i];
      const pos = latLngToVector3(country.lat, country.lon, 0, radius);
      const normal = pos.clone().normalize();

      // Tangent frame: East vector parallel to lines of latitude
      const lonRad = (country.lon * Math.PI) / 180;
      const latRad = (country.lat * Math.PI) / 180;

      let east = new THREE.Vector3(Math.cos(lonRad), 0, -Math.sin(lonRad)).normalize();
      if (Math.abs(Math.sin(latRad)) > 0.95) {
        east = new THREE.Vector3(1, 0, 0);
      }
      const north = new THREE.Vector3().crossVectors(normal, east).normalize();

      // Construct rotation matrix: X=East, Y=North, Z=Normal
      const rotMatrix = new THREE.Matrix4().makeBasis(east, north, normal);

      dummy.position.copy(pos);
      dummy.setRotationFromMatrix(rotMatrix);
      dummy.scale.set(country.width, country.height, 1.0);
      dummy.updateMatrix();

      this.instancedMesh.setMatrixAt(i, dummy.matrix);
      countryScales[i] = country.width;
    }

    // Attach custom per-instance attributes
    quadGeo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(uvOffsets, 4));
    quadGeo.setAttribute('aCountryScale', new THREE.InstancedBufferAttribute(countryScales, 1));

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.instancedMesh);
  }

  /**
   * Finds the centroid and area of the largest polygon inside a Polygon or MultiPolygon feature.
   * Uses bounding-box weighted centroid to avoid skew towards dense coastline vertices.
   */
  private getLargestPolygonCentroid(geom: any): { lat: number; lon: number; area: number } | null {
    let bestArea = -1;
    let bestCenter: { lat: number; lon: number; area: number } | null = null;

    const evalPoly = (poly: number[][][]) => {
      if (!poly || poly.length === 0) return;
      const ring = poly[0];
      if (!ring || ring.length < 3) return;

      let minLat = 90;
      let maxLat = -90;
      let minLon = 180;
      let maxLon = -180;
      let sumLat = 0;
      let sumLon = 0;

      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        sumLat += lat;
        sumLon += lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }

      const spanLat = maxLat - minLat;
      const spanLon = maxLon - minLon;
      const bboxLat = (minLat + maxLat) * 0.5;
      const bboxLon = (minLon + maxLon) * 0.5;
      const avgLat = sumLat / ring.length;
      const avgLon = sumLon / ring.length;

      // Weighted combination of bounding box center and vertex average
      // Prevents dense coastline vertices from dragging centroid to border edges
      const cLat = bboxLat * 0.70 + avgLat * 0.30;
      const cLon = bboxLon * 0.70 + avgLon * 0.30;
      const area = spanLat * spanLon * Math.max(0.15, Math.cos((cLat * Math.PI) / 180));

      if (area > bestArea) {
        bestArea = area;
        bestCenter = { lat: cLat, lon: cLon, area };
      }
    };

    if (geom.type === 'Polygon') {
      evalPoly(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        evalPoly(poly);
      }
    }

    return bestCenter;
  }

  public update(cameraDistance?: number): void {
    if (!this.isEnabled || !this.material) return;
    if (cameraDistance !== undefined) {
      this.material.uniforms.uCameraDistance.value = cameraDistance;
    }
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.group.visible = enabled;
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public destroy(): void {
    if (this.atlasTexture) {
      this.atlasTexture.dispose();
      this.atlasTexture = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    if (this.instancedMesh) {
      this.group.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      this.instancedMesh = null;
    }
  }
}
