import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateBoltSegments, writeSegmentsToBuffer } from '../src/world/vfx/ProceduralBoltGeometry';
import { LightningBoltPool } from '../src/world/vfx/LightningBoltPool';
import { StormCellRadar } from '../src/world/vfx/StormCellRadar';
import type { StormCell } from '../src/types/cluster';

test('Bolt Pool: procedural midpoint displacement geometry generation and NaN safety', () => {
  const cloudPoint = new THREE.Vector3(0, 108, 0);
  const groundPoint = new THREE.Vector3(0, 100, 0);

  const segments = generateBoltSegments(cloudPoint, groundPoint, {
    depth: 4,
    displacementScale: 2.0,
    branchProbability: 0.35
  });

  assert.ok(segments.length >= 8, `Expected at least 8 segments, got ${segments.length}`);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    assert.ok(!isNaN(seg.start.x) && !isNaN(seg.start.y) && !isNaN(seg.start.z));
    assert.ok(!isNaN(seg.end.x) && !isNaN(seg.end.y) && !isNaN(seg.end.z));
  }

  const buffer = new Float32Array(192 * 3);
  const vertCount = writeSegmentsToBuffer(segments, buffer);
  assert.equal(vertCount, segments.length * 2);
});

test('Bolt Pool: zero-length and coincident points guard', () => {
  const identicalPoint = new THREE.Vector3(50, 50, 50);
  const zeroSegments = generateBoltSegments(identicalPoint, identicalPoint.clone());
  assert.equal(zeroSegments.length, 0);

  const microDistStart = new THREE.Vector3(0, 100, 0);
  const microDistEnd = new THREE.Vector3(0, 100.0001, 0);
  const microSegments = generateBoltSegments(microDistStart, microDistEnd);
  assert.equal(microSegments.length, 0);
});

test('Bolt Pool: fixed pool capacity limit and recycling', () => {
  const testPool = new LightningBoltPool({ poolSize: 6, boltDurationMs: 250 });
  const baseStart = new THREE.Vector3(0, 108, 0);
  const baseEnd = new THREE.Vector3(0, 100, 0);

  for (let i = 0; i < 10; i++) {
    testPool.acquire(baseStart, baseEnd, 1.0);
  }

  assert.equal(testPool.getActiveCount(), 6);
  assert.equal(testPool.getAvailableCount(), 0);
});

test('Bolt Pool: automated expiration decay and lifecycle cleanup', () => {
  const testPool = new LightningBoltPool({ poolSize: 6, boltDurationMs: 250 });
  const baseStart = new THREE.Vector3(0, 108, 0);
  const baseEnd = new THREE.Vector3(0, 100, 0);

  const baseTime = Date.now();
  testPool.acquire(baseStart, baseEnd, 1.0, 250, baseTime);
  testPool.acquire(baseStart, baseEnd, 1.0, 250, baseTime);
  testPool.acquire(baseStart, baseEnd, 1.0, 250, baseTime);

  assert.equal(testPool.getActiveCount(), 3);
  assert.equal(testPool.getAvailableCount(), 3);

  testPool.update(baseTime + 100);
  assert.equal(testPool.getActiveCount(), 3);

  testPool.update(baseTime + 300);
  assert.equal(testPool.getActiveCount(), 0);
  assert.equal(testPool.getAvailableCount(), 6);
});

test('StormCellRadar: Analytical Horizon / Spherical Culling (P · C > R^2)', () => {
  const globeRadius = 100;
  const radar = new StormCellRadar(globeRadius);
  const now = Date.now();

  const frontCell: StormCell = {
    id: 'cell-front',
    centroid: { latitude: 0, longitude: 0 },
    boundingRadiusKm: 50,
    strikeCount: 20,
    events: [],
    firstSeen: now,
    lastSeen: now,
    ageSeconds: 10,
    meanIntensity: -30,
    warningLevel: 'NORMAL'
  };

  const backCell: StormCell = {
    id: 'cell-back',
    centroid: { latitude: 0, longitude: 180 },
    boundingRadiusKm: 50,
    strikeCount: 20,
    events: [],
    firstSeen: now,
    lastSeen: now,
    ageSeconds: 10,
    meanIntensity: -30,
    warningLevel: 'NORMAL'
  };

  radar.updateCells([frontCell, backCell]);

  const pool = (radar as any).hexPool;
  const frontSlot = pool.find((s: any) => s.cellId === 'cell-front');
  const backSlot = pool.find((s: any) => s.cellId === 'cell-back');

  assert.ok(frontSlot, 'Front slot should be assigned');
  assert.ok(backSlot, 'Back slot should be assigned');

  // 1. Camera in front on +Z axis at (0, 0, 300)
  // Front slot (lon 0, lat 0) is around (0, 0, 101.2) -> P · C > R^2 (10000) -> visible
  // Back slot (lon 180, lat 0) is around (0, 0, -101.2) -> P · C <= R^2 -> culled
  const camPosFront = new THREE.Vector3(0, 0, 300);
  radar.update(0.016, camPosFront);

  assert.equal(frontSlot.mesh.visible, true, 'Front-facing cell must be visible');
  assert.equal(backSlot.mesh.visible, false, 'Back-facing cell behind Earth must be culled (visible=false)');

  // 2. Camera flips to the rear (-Z axis at 0, 0, -300)
  // Now frontCell is behind Earth (culled), backCell is in front (visible)
  const camPosBack = new THREE.Vector3(0, 0, -300);
  radar.update(0.016, camPosBack);

  assert.equal(frontSlot.mesh.visible, false, 'Previously visible cell now behind Earth must be culled');
  assert.equal(backSlot.mesh.visible, true, 'Previously culled cell now facing camera must become visible');

  // 3. Fallback when setCamera is used
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 300);
  radar.setCamera(camera);
  radar.update(0.016); // cameraPosition omitted, should resolve from camera

  assert.equal(frontSlot.mesh.visible, true, 'Front-facing cell visible via setCamera');
  assert.equal(backSlot.mesh.visible, false, 'Back-facing cell culled via setCamera');

  radar.destroy();
});

test('VFX Draw Call Minimization: InstancedMesh consolidation for shockwave rings & storm radar cells', () => {
  const poolSize = 8;
  const boltPool = new LightningBoltPool({ poolSize });
  const radar = new StormCellRadar(100);

  // 1. LightningBoltPool: InstancedMesh validation
  assert.ok(boltPool.shockwaveMesh instanceof THREE.InstancedMesh, 'shockwaveMesh must be an InstancedMesh');
  assert.ok(boltPool.rippleMesh instanceof THREE.InstancedMesh, 'rippleMesh must be an InstancedMesh');
  assert.equal(boltPool.shockwaveMesh.count, poolSize);
  assert.equal(boltPool.rippleMesh.count, poolSize);
  assert.equal(boltPool.shockwaveMesh.renderOrder, 5, 'shockwaveMesh must render at renderOrder 5');
  assert.equal(boltPool.rippleMesh.renderOrder, 24, 'rippleMesh must render at renderOrder 24');

  // Verify boltPool.group children count: meshes + charges + lights + sparkPoints + 2 instanced meshes
  // Crucially, individual 64+64 ring meshes are NOT in group children!
  const ringChildren = boltPool.group.children.filter(c => c instanceof THREE.InstancedMesh);
  assert.equal(ringChildren.length, 2, 'Must contain exactly 2 InstancedMeshes (shockwave & ripple) instead of 2x poolSize meshes');

  // 2. StormCellRadar: InstancedMesh validation
  assert.ok(radar.instancedHexMesh instanceof THREE.InstancedMesh, 'instancedHexMesh must be an InstancedMesh');
  assert.equal(radar.instancedHexMesh.count, 64, 'instancedHexMesh must support 64 cells');
  assert.equal(radar.instancedHexMesh.renderOrder, 25, 'instancedHexMesh must render at renderOrder 25');

  // Verify radar.group has instancedHexMesh as its drawing node
  assert.ok(radar.group.children.includes(radar.instancedHexMesh), 'instancedHexMesh must be in radar group');
  assert.equal(radar.group.children.filter(c => c === radar.instancedHexMesh).length, 1, 'Only 1 consolidated InstancedMesh for 64 cells');

  boltPool.destroy();
  radar.destroy();
});


