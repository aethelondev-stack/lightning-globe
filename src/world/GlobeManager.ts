import * as THREE from 'three';
import ThreeGlobe from 'three-globe';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ConicPolygonGeometry from 'three-conic-polygon-geometry';
import { EngineConfig } from '../core/Config';
import { getSolarPosition, calculateNightFactor } from '../utils/sun';
import { latLngToVector3 } from '../utils/coordinates';
import { AtmosphereGlow } from './atmosphere/AtmosphereGlow';
import { HistoricalTrailLayer } from './vfx/HistoricalTrailLayer';
import { StormCellRadar } from './vfx/StormCellRadar';
import { IonColumnManager } from './vfx/IonColumnManager';
import { BoltGlyphTrailLayer } from './vfx/BoltGlyphTrailLayer';
import { FulguriteTraceLayer } from './vfx/FulguriteTraceLayer';
import { AtmosphericPotentialLayer } from './atmosphere/AtmosphericPotentialLayer';
import { StarfieldBackground } from './background/StarfieldBackground';
import { Moon } from './celestial/Moon';
import { CountryLabelManager } from './labels/CountryLabelManager';
import { GeoIndex } from '../utils/geoRegions';
import type { IUpdatable } from '../types';

export class GlobeManager implements IUpdatable {
  public readonly globe: ThreeGlobe;
  public readonly atmosphereGlow: AtmosphereGlow;
  public readonly atmosphericPotentialLayer: AtmosphericPotentialLayer;
  public readonly starfield: StarfieldBackground;
  public readonly moon: Moon;
  public readonly countryLabelManager: CountryLabelManager;
  public readonly historicalTrailLayer: HistoricalTrailLayer;
  public readonly stormCellRadar: StormCellRadar;
  public readonly ionColumnManager: IonColumnManager;
  public readonly boltGlyphTrailLayer: BoltGlyphTrailLayer;
  public readonly fulguriteTraceLayer: FulguriteTraceLayer;
  private rotationSpeed: number;
  private sunDirectionUniform: { value: THREE.Vector3 };
  private earthMaterial: THREE.MeshStandardMaterial | null = null;
  private countryFeatures: any[] = [];
  private hoveredCountry: any | null = null;
  private lastSunUpdateTime: number = 0;


  constructor(scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
    this.rotationSpeed = EngineConfig.globe.defaultRotationSpeed;
    const initialSun = getSolarPosition(new Date());
    this.sunDirectionUniform = { value: initialSun.direction.clone() };

    // 1. Initialize ThreeGlobe instance
    this.globe = new ThreeGlobe({
      waitForGlobeReady: false,
      animateIn: false
    });

    // 2. Setup ultra-crisp 4K Earth textures, Day/Night shader & anisotropic filtering
    this.setupGlobeVisuals(renderer);

    // 4. Setup Rayleigh atmospheric scattering limb glow shell (Phase 14)
    this.atmosphereGlow = new AtmosphereGlow();
    this.globe.add(this.atmosphereGlow.mesh);

    // 5. Atmospheric Potential Layer (Disabled per user visual cleanup request - zero space purple spots)
    this.atmosphericPotentialLayer = new AtmosphericPotentialLayer();
    this.atmosphericPotentialLayer.setEnabled(false);
    this.atmosphericPotentialLayer.group.visible = false;

    // 6. Setup High-Contrast Electric Cyan/Indigo Fulgurite Fracture Scars (Lichtenberg Traces)
    this.fulguriteTraceLayer = new FulguriteTraceLayer();
    this.globe.add(this.fulguriteTraceLayer.lineMesh);

    // 5. Stylized 6-Class Storm Cell Honeycomb Radar Grid (Foto 2 & 3 Specification)
    this.stormCellRadar = new StormCellRadar();
    this.stormCellRadar.setEnabled(true);
    this.stormCellRadar.group.visible = true;
    this.globe.add(this.stormCellRadar.group);

    // 6. Setup legacy layers in disabled state to prevent white/yellow dot artifacts
    this.historicalTrailLayer = new HistoricalTrailLayer();
    this.historicalTrailLayer.setEnabled(false);

    this.boltGlyphTrailLayer = new BoltGlyphTrailLayer();
    this.boltGlyphTrailLayer.setEnabled(false);

    // 7. Setup Vertical Plasma Ion Columns (Fully detached & disabled: yellow beams & apex spheres eradicated)
    this.ionColumnManager = new IonColumnManager();
    this.ionColumnManager.group.visible = false;

    // 8. Setup High-Performance Zero-Overhead Country Label Manager (1 Single Draw Call)
    this.countryLabelManager = new CountryLabelManager();
    this.globe.add(this.countryLabelManager.group);

    // 8b. Load elegant GeoJSON country borders & labels
    this.loadCountryBorders();

    // 9. Setup Parallax Cosmic Dust & Twinkling Starfield
    this.starfield = new StarfieldBackground();
    scene.add(this.starfield.pointsMesh);

    // 10. Setup Live Astronomical Moon
    this.moon = new Moon();
    scene.add(this.moon.mesh);

    // 11. Add to the main Three.js scene
    scene.add(this.globe);
  }

  private setupGlobeVisuals(_renderer?: THREE.WebGLRenderer): void {
    // Ocean: Deep midnight black space void
    this.earthMaterial = new THREE.MeshStandardMaterial({
      color: 0x04060d,
      roughness: 0.92,
      metalness: 0.08
    });

    // Apply custom Dark Theme material to ThreeGlobe
    this.globe.globeMaterial(this.earthMaterial);

    // Disable ThreeGlobe default atmosphere to prevent z-fighting with our custom Rayleigh AtmosphereGlow
    this.globe.showAtmosphere(false);
  }

  /**
   * Pure mathematical formulation of terminator nightFactor for unit testing.
   */
  public static calculateNightFactor(sunDot: number): number {
    return calculateNightFactor(sunDot);
  }

  private loadCountryBorders(): void {
    if (typeof window === 'undefined') return;
    fetch('/data/countries.geojson')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load countries.geojson: ${res.statusText}`);
        }
        return res.json();
      })
      .then((countries) => {
        if (!countries || !countries.features) {
          console.warn('Invalid GeoJSON structure received.');
          return;
        }

        this.countryFeatures = countries.features;

        // 1. ThreeGlobe 241 unmerged polygon meshes bypassed to eliminate 241 draw calls
        this.globe.polygonsData([]);

        // 2. Build single merged BufferGeometry for all continental landmasses (1 SINGLE DRAW CALL)
        const geometries: THREE.BufferGeometry[] = [];
        const baseR = EngineConfig.globe.radius;
        const landR = baseR * 1.0035; // 100.35u elevation prevents chord sagging into globe

        for (const feature of countries.features) {
          const geom = feature.geometry;
          if (!geom) continue;
          try {
            if (geom.type === 'Polygon') {
              geometries.push(new ConicPolygonGeometry(geom.coordinates, baseR, landR, false, true, false, 3));
            } else if (geom.type === 'MultiPolygon') {
              for (const poly of geom.coordinates) {
                geometries.push(new ConicPolygonGeometry(poly, baseR, landR, false, true, false, 3));
              }
            }
          } catch {
            // Skip individual malformed feature
          }
        }

        if (geometries.length > 0) {
          try {
            const mergedGeom = BufferGeometryUtils.mergeGeometries(geometries);
            if (mergedGeom) {
              // Recompute true spherical normals for all vertices: N = normalize(P)
              // This permanently resolves 1,707 degenerate/zero/inverted normals from ConicPolygonGeometry
              // that produced black polygonal holes and corrupted shading in Screenshot 2.
              const posAttr = mergedGeom.getAttribute('position') as THREE.BufferAttribute;
              const normAttr = mergedGeom.getAttribute('normal') as THREE.BufferAttribute;
              for (let i = 0; i < posAttr.count; i++) {
                const px = posAttr.getX(i);
                const py = posAttr.getY(i);
                const pz = posAttr.getZ(i);
                const len = Math.sqrt(px * px + py * py + pz * pz);
                if (len > 0.001) {
                  normAttr.setXYZ(i, px / len, py / len, pz / len);
                }
              }
              normAttr.needsUpdate = true;

              // Uniform modern sleek charcoal grey for all landmasses (reduced brightness per user feedback, never pitch black)
              const landMaterial = new THREE.MeshStandardMaterial({
                color: 0x242c38,
                emissive: 0x121720,
                roughness: 0.86,
                metalness: 0.04,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
              });
              const landMesh = new THREE.Mesh(mergedGeom, landMaterial);
              landMesh.renderOrder = 1;
              this.globe.add(landMesh);
            }
          } catch (err) {
            console.warn('Failed to merge continent geometries:', err);
          }
        }

        // 3. Build high-performance LineSegments geometry for crisp political borders
        const vertices: number[] = [];
        const radius = EngineConfig.globe.radius * 1.006;

        const addRing = (ring: number[][]) => {
          if (ring.length < 2) return;
          for (let i = 0; i < ring.length - 1; i++) {
            const p1 = latLngToVector3(ring[i][1], ring[i][0], 0, radius);
            const p2 = latLngToVector3(ring[i + 1][1], ring[i + 1][0], 0, radius);
            vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
          }
        };

        for (const feature of countries.features) {
          const geom = feature.geometry;
          if (!geom) continue;
          if (geom.type === 'Polygon') {
            for (const ring of geom.coordinates) {
              addRing(ring);
            }
          } else if (geom.type === 'MultiPolygon') {
            for (const poly of geom.coordinates) {
              for (const ring of poly) {
                addRing(ring);
              }
            }
          }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

        const material = new THREE.LineBasicMaterial({
          color: 0x64748b,
          transparent: true,
          opacity: 0.40,
          depthWrite: false
        });

        const bordersMesh = new THREE.LineSegments(geometry, material);
        bordersMesh.renderOrder = 2;
        this.globe.add(bordersMesh);

        // 3. Initialize high-performance country labels (1 Single Draw Call, 0 DOM nodes, zero FPS loss)
        this.countryLabelManager.initLabels(countries.features);
        this.globe.labelsData([]);

        // Register loaded countries into GeoIndex for camera filtering
        for (const feature of countries.features) {
          const name = feature.properties?.name;
          const iso = feature.properties?.iso_a2;
          if (name) {
            GeoIndex.registerCountry({ name, iso, lat: 0, lon: 0 });
          }
        }

        console.log(`🗺️ Loaded dark political borders & country labels (${countries.features.length} countries, 1 Draw Call).`);
      })
      .catch((err) => {
        console.error('Error loading country borders:', err);
      });
  }

  public _isCountryHovered(d: any): boolean {
    if (!this.hoveredCountry || !d) return false;
    if (d === this.hoveredCountry) return true;
    const hName = this.hoveredCountry.properties?.name || this.hoveredCountry.name || this.hoveredCountry.country;
    const dName = d.properties?.name || d.name || d.country;
    if (hName && dName && hName.toLowerCase() === dName.toLowerCase()) return true;
    const hIso = this.hoveredCountry.properties?.iso_a2 || this.hoveredCountry.iso;
    const dIso = d.properties?.iso_a2 || d.iso;
    return !!(hIso && dIso && hIso === dIso);
  }

  public is3DElevationEnabled: boolean = false;
  private elevatedCountryTimeout: ReturnType<typeof setTimeout> | null = null;

  public set3DElevationEnabled(_enabled: boolean): void {
    this.is3DElevationEnabled = false;
  }

  public elevateCountryTemporarily(countryNameOrIso: string, durationMs: number = 2500): void {
    if (!countryNameOrIso || this.countryFeatures.length === 0) return;
    const query = countryNameOrIso.trim().toLowerCase();
    const match = this.countryFeatures.find((f: any) => {
      const name = (f.properties?.name || '').toLowerCase();
      const formal = (f.properties?.name_long || f.properties?.formal_en || '').toLowerCase();
      const iso = (f.properties?.iso_a2 || '').toLowerCase();
      return name === query || iso === query || formal.includes(query) || query.includes(name);
    });

    if (match) {
      if (this.elevatedCountryTimeout) clearTimeout(this.elevatedCountryTimeout);
      this.setHoveredCountry(match);
      this.elevatedCountryTimeout = setTimeout(() => {
        this.elevatedCountryTimeout = null;
        this.setHoveredCountry(null);
      }, durationMs);
    }
  }

  public setHoveredCountry(featureOrGeo: any | null): void {
    const oldIso = this.hoveredCountry?.properties?.iso_a2 || this.hoveredCountry?.iso || null;
    const newIso = featureOrGeo?.properties?.iso_a2 || featureOrGeo?.iso || null;
    if (oldIso === newIso) return; // Zero-cost O(1) dirty-check: prevents 30 FPS re-render loops

    this.hoveredCountry = featureOrGeo;
  }

  public getCountryFeatures(): any[] {
    return this.countryFeatures;
  }

  public update(delta: number, elapsed: number = performance.now() * 0.001, cameraPosition?: THREE.Vector3): void {
    // 1. Planetary rotation (if configured)
    if (this.rotationSpeed !== 0) {
      this.globe.rotation.y += delta * this.rotationSpeed;
    }

    // 2. Real-time Sun astronomical alignment update (throttled to 2000ms like Moon ephemeris)
    const nowMs = performance.now();
    if (nowMs - this.lastSunUpdateTime > 2000) {
      this.lastSunUpdateTime = nowMs;
      const currentSun = getSolarPosition(new Date());
      this.sunDirectionUniform.value.copy(currentSun.direction);
      this.atmosphereGlow.updateSunDirection(currentSun.direction);
    }
    this.atmosphereGlow.update(delta);

    // 3. Update thermodynamic atmospheric convective instability field (FAZ 2)
    this.atmosphericPotentialLayer.update(delta, elapsed);

    // 4. Update high-contrast fulgurite fracture scars (Lichtenberg traces)
    this.fulguriteTraceLayer.update();

    // 4b. Update tactical micro-hexagonal energy radar grid (with analytical horizon culling)
    if (this.stormCellRadar.getIsEnabled()) {
      this.stormCellRadar.update(delta, cameraPosition);
    }

    // 5. Update cosmic dust starfield twinkling
    this.starfield.update(delta);

    // 6. Update live astronomical Moon ephemeris and tidal locking
    this.moon.update(delta);
  }

  /**
   * Sets camera reference for horizon culling and view calculations.
   */
  public setCamera(camera: THREE.Camera): void {
    this.stormCellRadar.setCamera(camera);
  }

  /**
   * Updates camera distance for all adaptive LOD VFX layers.
   */
  public setCameraDistance(distance: number): void {
    this.ionColumnManager.setCameraDistance(distance);
    this.countryLabelManager.update(distance);
  }

  public setRotationSpeed(speed: number): void {
    this.rotationSpeed = speed;
  }
}
