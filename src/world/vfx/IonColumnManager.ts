import * as THREE from 'three';
import { latLngToVector3 } from '../../utils/coordinates';
import { EnergyProxy } from '../../domain/energy/EnergyProxy';
import { EngineConfig } from '../../core/Config';
import type { IUpdatable } from '../../types';

interface IonColumnSlot {
  group: THREE.Group;
  cylinderMesh: THREE.Mesh;
  cylinderMat: THREE.MeshBasicMaterial;
  topSphereMesh: THREE.Mesh;
  topSphereMat: THREE.MeshBasicMaterial;
  startTime: number;
  durationMs: number;
  active: boolean;
  baseHeight: number;
}

/**
 * IonColumnManager: Vertical plasma ion beam columns scaling with strike peak current (Phase 23).
 *
 * Capabilities:
 * - 32 pre-allocated pooled 3D meshes extending radially from Earth surface into space.
 * - Dynamic geometric scaling based on EnergyProxy (6 units for standard strikes up to 28 units for superbolts).
 * - High-energy superbolt (>60 kA) plasma sphere bloom at the ionization apex.
 * - Additive blending with smooth exponential alpha decay over 450ms.
 * - Zero GC allocations in active frame update loop.
 */
export class IonColumnManager implements IUpdatable {
  public readonly group: THREE.Group;
  private readonly globeRadius: number;
  private readonly pool: IonColumnSlot[] = [];
  private readonly poolSize: number = 32;

  private static readonly UP_VECTOR = new THREE.Vector3(0, 1, 0);
  private static readonly TEMP_NORMAL = new THREE.Vector3();

  constructor(globeRadius: number = EngineConfig.globe.radius) {
    this.globeRadius = globeRadius;
    this.group = new THREE.Group();
    this.group.name = 'IonColumnManagerGroup';

    this.initPool();
  }

  private initPool(): void {
    // Base cylinder: height 1.0, radius 0.25, translated so base is at origin (0, 0, 0)
    const cylinderGeo = new THREE.CylinderGeometry(0.12, 0.28, 1.0, 8, 1);
    cylinderGeo.translate(0, 0.5, 0);

    const sphereGeo = new THREE.SphereGeometry(0.5, 8, 8);

    for (let i = 0; i < this.poolSize; i++) {
      const columnGroup = new THREE.Group();

      const cylinderMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const cylinderMesh = new THREE.Mesh(cylinderGeo, cylinderMat);
      columnGroup.add(cylinderMesh);

      const sphereMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const topSphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
      topSphereMesh.visible = false;
      columnGroup.add(topSphereMesh);

      columnGroup.visible = false;
      this.group.add(columnGroup);

      this.pool.push({
        group: columnGroup,
        cylinderMesh,
        cylinderMat,
        topSphereMesh,
        topSphereMat: sphereMat,
        startTime: 0,
        durationMs: 450,
        active: false,
        baseHeight: 1.0
      });
    }
  }

  private cameraDistance: number = 320;

  /**
   * Sets current camera distance for adaptive high-altitude visibility scaling.
   */
  public setCameraDistance(distance: number): void {
    this.cameraDistance = distance;
  }

  /**
   * Triggers a vertical plasma column at given geographic coordinates with peak current scaling.
   * Dynamically scales column height and radius when viewing Earth from high altitudes.
   */
  public trigger(lat: number, lon: number, peakCurrent: number = 25): void {
    // Find next available or oldest slot
    let chosenSlot: IonColumnSlot | null = null;
    let oldestTime = Infinity;

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      if (!slot.active) {
        chosenSlot = slot;
        break;
      }
      if (slot.startTime < oldestTime) {
        oldestTime = slot.startTime;
        chosenSlot = slot;
      }
    }

    if (!chosenSlot) return;

    const energy = EnergyProxy.calculate(peakCurrent);
    const absCurrent = Math.abs(peakCurrent);
    const isSuperbolt = absCurrent >= 60;

    // Adaptive altitude scaling: 1.0x at close focus (160u) up to 2.8x from orbital view (320u+)
    const distMultiplier = Math.max(1.0, Math.min(2.8, this.cameraDistance / 160.0));

    const normalizedPower = (energy - EnergyProxy.MIN_CLAMP) / (EnergyProxy.MAX_CLAMP - EnergyProxy.MIN_CLAMP);
    // Height scaled between 8 units (low energy) and 26 units (superbolt), magnified by altitude
    const height = (8.0 + normalizedPower * 18.0) * distMultiplier;
    const radiusScale = (0.8 + normalizedPower * 1.5) * distMultiplier;

    // Calculate position on globe surface
    const surfacePos = latLngToVector3(lat, lon, 0.002, this.globeRadius);
    chosenSlot.group.position.copy(surfacePos);

    // Align Y axis radially outward along sphere normal
    IonColumnManager.TEMP_NORMAL.copy(surfacePos).normalize();
    chosenSlot.group.quaternion.setFromUnitVectors(IonColumnManager.UP_VECTOR, IonColumnManager.TEMP_NORMAL);

    // Scale cylinder
    chosenSlot.cylinderMesh.scale.set(radiusScale, height, radiusScale);
    chosenSlot.baseHeight = height;

    // Chromatic styling: Radiant Amber for high energy / superbolts, Electric Cyan for normal
    const colorHex = isSuperbolt ? 0xf59e0b : (absCurrent > 35 ? 0x60a5fa : 0x38bdf8);
    chosenSlot.cylinderMat.color.setHex(colorHex);
    chosenSlot.cylinderMat.opacity = 0.90;

    // Apex plasma sphere: only visible for superbolts
    const showSphere = isSuperbolt;
    if (showSphere) {
      chosenSlot.topSphereMesh.visible = true;
      chosenSlot.topSphereMesh.position.set(0, height, 0);
      const sphereScale = (0.9 + normalizedPower * 1.3) * distMultiplier;
      chosenSlot.topSphereMesh.scale.set(sphereScale, sphereScale, sphereScale);
      chosenSlot.topSphereMat.color.setHex(isSuperbolt ? 0xffedd5 : 0xe0f2fe);
      chosenSlot.topSphereMat.opacity = 0.95;
    } else {
      chosenSlot.topSphereMesh.visible = false;
    }

    chosenSlot.startTime = Date.now();
    chosenSlot.durationMs = isSuperbolt ? 600 : Math.round(420 * Math.min(1.4, distMultiplier));
    chosenSlot.active = true;
    chosenSlot.group.visible = true;
  }

  /**
   * Per-frame update loop: fades opacities smoothly to zero.
   */
  public update(_delta?: number): void {
    const now = Date.now();

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      if (!slot.active) continue;

      const elapsed = now - slot.startTime;
      if (elapsed >= slot.durationMs) {
        slot.active = false;
        slot.group.visible = false;
        continue;
      }

      const progress = elapsed / slot.durationMs;
      // Exponential ease-out alpha fade
      const alpha = Math.max(0, (1.0 - progress) * (1.0 - progress));

      slot.cylinderMat.opacity = alpha * 0.85;
      if (slot.topSphereMesh.visible) {
        slot.topSphereMat.opacity = alpha * 0.95;
      }
    }
  }

  public clear(): void {
    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      slot.active = false;
      slot.group.visible = false;
    }
  }

  public destroy(): void {
    this.clear();
    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      slot.cylinderMat.dispose();
      slot.topSphereMat.dispose();
    }
  }
}
