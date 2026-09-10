import * as THREE from 'three';
import { latLngToVector3 } from '../../utils/coordinates';
import { EngineConfig } from '../../core/Config';
import type { IUpdatable } from '../../types';

export interface BoltGlyphTrailConfig {
  maxCapacity?: number;
  globeRadius?: number;
}

/**
 * BoltGlyphTrailLayer: 3D Persistent Yellow Lightning Bolt Symbol Trails (⚡).
 *
 * Capabilities:
 * - Procedural vector zigzag ⚡ glyph built via THREE.Shape & THREE.ShapeGeometry.
 * - Ultra-high performance single draw-call THREE.InstancedMesh (5,000 capacity ring buffer).
 * - Spherical tangential surface orientation via quaternion rotation.
 * - Vivid electric amber-yellow chromatic styling (#facc15).
 * - Zero memory allocation per strike ingestion.
 */
export class BoltGlyphTrailLayer implements IUpdatable {
  public readonly mesh: THREE.InstancedMesh;
  private readonly maxCapacity: number;
  private readonly globeRadius: number;

  private headIndex: number = 0;
  private count: number = 0;
  private isEnabled: boolean = true;

  private static readonly Z_AXIS = new THREE.Vector3(0, 0, 1);
  private static readonly DUMMY = new THREE.Object3D();
  private static readonly TEMP_NORMAL = new THREE.Vector3();
  private static readonly COLOR_YELLOW = new THREE.Color(0xfacc15);

  constructor(config?: BoltGlyphTrailConfig) {
    this.maxCapacity = config?.maxCapacity ?? 5000;
    this.globeRadius = config?.globeRadius ?? EngineConfig.globe.radius;

    // 1. Build precise zigzag ⚡ vector shape
    const shape = new THREE.Shape();
    shape.moveTo(0.0, 0.85);
    shape.lineTo(-0.35, 0.12);
    shape.lineTo(-0.06, 0.12);
    shape.lineTo(-0.28, -0.85);
    shape.lineTo(0.35, -0.05);
    shape.lineTo(0.08, -0.05);
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    // Scale shape down to appropriate planetary glyph dimensions (~0.5 units)
    geometry.scale(0.55, 0.55, 0.55);

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, this.maxCapacity);
    this.mesh.name = 'BoltGlyphTrailInstancedMesh';
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Initialize all instances with identity hidden matrix
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxCapacity; i++) {
      this.mesh.setMatrixAt(i, zeroMatrix);
      this.mesh.setColorAt(i, BoltGlyphTrailLayer.COLOR_YELLOW);
    }
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
  }

  /**
   * Adds a new strike location as a 3D yellow lightning symbol (⚡) on the globe.
   */
  public addStrike(lat: number, lon: number): void {
    if (!this.isEnabled) return;

    const idx = this.headIndex;
    this.headIndex = (this.headIndex + 1) % this.maxCapacity;
    if (this.count < this.maxCapacity) {
      this.count++;
      this.mesh.count = this.count;
    }

    // Position glyph slightly above terrain (altitude fraction 0.0035)
    const pos = latLngToVector3(lat, lon, 0.0035, this.globeRadius);
    BoltGlyphTrailLayer.DUMMY.position.copy(pos);

    // Orient tangential to globe normal
    BoltGlyphTrailLayer.TEMP_NORMAL.copy(pos).normalize();
    BoltGlyphTrailLayer.DUMMY.quaternion.setFromUnitVectors(
      BoltGlyphTrailLayer.Z_AXIS,
      BoltGlyphTrailLayer.TEMP_NORMAL
    );
    BoltGlyphTrailLayer.DUMMY.scale.set(1, 1, 1);
    BoltGlyphTrailLayer.DUMMY.updateMatrix();

    this.mesh.setMatrixAt(idx, BoltGlyphTrailLayer.DUMMY.matrix);
    this.mesh.setColorAt(idx, BoltGlyphTrailLayer.COLOR_YELLOW);

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  public update(): void {
    // Zero-overhead frame hook
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.mesh.visible = enabled;
  }

  public clear(): void {
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxCapacity; i++) {
      this.mesh.setMatrixAt(i, zeroMatrix);
    }
    this.headIndex = 0;
    this.count = 0;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public destroy(): void {
    this.clear();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
