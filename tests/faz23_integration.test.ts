import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StrikeArchiveDB } from '../src/services/storage/StrikeArchiveDB';
import { LiveStreamProvider } from '../src/services/providers/LiveStreamProvider';
import { GlobeManager } from '../src/world/GlobeManager';
import { IonColumnManager } from '../src/world/vfx/IonColumnManager';
import { BoltGlyphTrailLayer } from '../src/world/vfx/BoltGlyphTrailLayer';
import { StormCellRadar } from '../src/world/vfx/StormCellRadar';
import { EnergyProxy } from '../src/domain/energy/EnergyProxy';
import type { LightningEvent } from '../src/types/lightning';
import type { StormCell } from '../src/types/cluster';

console.log('--- RUNNING FAZ 23 INTEGRATION & VERIFICATION SUITE ---');

async function testFaz23() {
  // 1. VERIFY CLEAN LIVE BOOT (Zero Synthetic Fallback)
  console.log('Test 1: Verifying LiveStreamProvider synthetic fallback is completely disabled by default...');
  const liveProvider = new LiveStreamProvider(); // Default options
  assert.equal(liveProvider.isFallbackActive(), false, 'Fallback must be inactive on creation');
  // Trigger internal connection failure behavior
  (liveProvider as any).handleConnectionFailure();
  assert.equal(liveProvider.isFallbackActive(), false, 'Fallback must remain false when enableSyntheticFallback is disabled');
  assert.equal(liveProvider.getStats().totalEventsReceived, 0, 'Zero synthetic events should be emitted');
  console.log('  -> Live boot cleanliness verified: 0 synthetic strikes emitted.');

  // 2. VERIFY CHRONOLOGICAL TAKVİMLİ INDEXEDDB ARŞİV
  console.log('Test 2: Verifying StrikeArchiveDB calendar indexing and bulk buffer...');
  const archiveDB = new StrikeArchiveDB({
    dbName: 'TestFaz23Archive',
    flushIntervalMs: 50,
    maxBufferSize: 3
  });

  const now = Date.parse('2026-09-06T15:30:00Z');
  const dummyStrike: LightningEvent = {
    id: 'strike-faz23-01',
    timestamp: now,
    latitude: 39.92,
    longitude: 32.85,
    peakCurrent: -75, // Superbolt
    type: 'CG',
    source: 'blitzortung'
  };

  archiveDB.saveStrike(dummyStrike, 'Turkey');
  await archiveDB.flush();

  const count = await archiveDB.getTotalCount();
  assert.equal(count, 1, `Expected 1 archived strike, got ${count}`);

  const byDate = await archiveDB.getStrikesByDateRange('2026-09-06', '2026-09-06');
  assert.equal(byDate.length, 1);
  assert.equal(byDate[0].country, 'Turkey');
  assert.equal(byDate[0].peakCurrent, -75);
  console.log('  -> StrikeArchiveDB calendar record verified: 1 strike recorded.');
  archiveDB.close();

  // 3. VERIFY DİKEY İYON PLAZMA SÜTUNLARI (IonColumnManager)
  console.log('Test 3: Verifying IonColumnManager 32-mesh pool & superbolt plasma apex...');
  const ionManager = new IonColumnManager(100);
  assert.equal(ionManager.group.children.length, 32, 'Must pre-allocate 32 ion column meshes');

  // Trigger standard strike
  ionManager.trigger(41.0, 29.0, 25);
  const slot1 = (ionManager as any).pool[0];
  assert.equal(slot1.active, true, 'Slot 1 must be active');
  assert.equal(slot1.topSphereMesh.visible, false, 'Standard strike should not display superbolt apex sphere');

  // Trigger superbolt (>60kA)
  ionManager.trigger(41.0, 29.0, -85);
  const slot2 = (ionManager as any).pool[1];
  assert.equal(slot2.active, true, 'Slot 2 must be active');
  assert.equal(slot2.topSphereMesh.visible, true, 'Superbolt must display top plasma sphere');
  assert.ok(slot2.baseHeight > slot1.baseHeight, 'Superbolt ion beam must be taller than standard strike');
  console.log('  -> IonColumnManager verified: standard vs superbolt scaling with apex bloom.');
  ionManager.destroy();

  // 4. VERIFY 3D SARI ŞİMŞEK (⚡) SEMBOL İZLERİ (BoltGlyphTrailLayer)
  console.log('Test 4: Verifying BoltGlyphTrailLayer 3D zigzag glyph geometry and instancing...');
  const glyphLayer = new BoltGlyphTrailLayer({ maxCapacity: 100 });
  assert.equal(glyphLayer.mesh.count, 0, 'Instanced mesh count starts at 0');

  glyphLayer.addStrike(39.9, 32.8);
  assert.equal(glyphLayer.mesh.count, 1, 'Mesh count increments to 1 on first strike');

  const matrix = new THREE.Matrix4();
  glyphLayer.mesh.getMatrixAt(0, matrix);
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  assert.ok(scale.x > 0.5, 'Glyph must have non-zero scale matrix on globe');
  console.log('  -> BoltGlyphTrailLayer verified: 3D vector ⚡ glyph placed on sphere surface.');
  glyphLayer.destroy();

  // 5. VERIFY BAL PETEĞİ (HEXAGONAL) FIRTINA AĞI (StormCellRadar)
  console.log('Test 5: Verifying StormCellRadar hexagonal honeycomb network (10-15% opacity)...');
  const radar = new StormCellRadar(100);
  assert.ok((radar as any).hexPool.length >= 16, 'Hex pool must have at least 16 pre-allocated slots');

  const dummyCell: StormCell = {
    id: 'storm-test-01',
    centroid: { latitude: 10.0, longitude: 20.0 },
    boundingRadiusKm: 180,
    strikeCount: 25,
    meanIntensity: 65,
    events: [],
    firstSeen: Date.now() - 10000,
    lastSeen: Date.now(),
    ageSeconds: 10
  };

  radar.updateCells([dummyCell]);
  radar.update(0.016);

  const hexSlot0 = (radar as any).hexPool[0];
  assert.equal(hexSlot0.active, true, 'Hex slot 0 must be active');
  assert.equal(hexSlot0.mesh.visible, true, 'Hex mesh must be visible');
  assert.ok(hexSlot0.material.opacity >= 0.10 && hexSlot0.material.opacity <= 0.25, 'Hexagon fill opacity must be in translucent range (10-25%)');
  assert.equal(hexSlot0.edgeLine.visible, true, 'Hexagon perimeter line must be visible');
  console.log('  -> StormCellRadar hexagonal honeycomb footprint verified.');
  radar.destroy();

  console.log('--- ALL FAZ 23 INTEGRATION TESTS FINISHED: OK ---');
  process.exit(0);
}

testFaz23().catch((err) => {
  console.error('Faz 23 Test Failed:', err);
  process.exit(1);
});
