import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LightningBoltPool } from '../src/world/vfx/LightningBoltPool';
import { StormCellRadar } from '../src/world/vfx/StormCellRadar';
import { StormCellBatcher } from '../src/services/clustering/StormCellBatcher';
import type { LightningEvent } from '../src/types/lightning';

test('FAZ 1B - Strict Layer Ordering (renderOrder Z-Index)', () => {
  const boltPool = new LightningBoltPool({ poolSize: 4 });
  const radar = new StormCellRadar(100);

  // 1. Check Bolt Pool layers
  const slot = (boltPool as any).pool[0];
  assert.equal(slot.mesh.renderOrder, 30, 'Bolt mesh must have renderOrder = 30 (top layer)');
  assert.equal(slot.cascadingCharges.renderOrder, 31, 'Cascading charge beads must have renderOrder = 31 (above bolt wire)');
  assert.equal(slot.shockwaveRing.renderOrder, 5, 'Mach shockwave ring must have renderOrder = 5 (ground surface, beneath honeycombs)');

  // 2. Check Storm Cell Radar layers (Strictly above traces at renderOrder 15)
  const hexSlot = (radar as any).hexPool[0];
  assert.equal(hexSlot.backdropMesh.renderOrder, 23, 'Contrast lens backdrop must have renderOrder = 23 (above traces)');
  assert.equal(hexSlot.mesh.renderOrder, 25, 'Honeycomb scanline face must have renderOrder = 25');
  assert.equal(hexSlot.outerEdgeLine.renderOrder, 26, 'Honeycomb neon laser rim must have renderOrder = 26');
  assert.equal(hexSlot.microHotspotMeshes[0].renderOrder, 27, 'Micro-hotspot mini white hexagons must have renderOrder = 27');

  boltPool.destroy();
  radar.destroy();
});

test('FAZ 1B - Cascading Electric Charges & Extended Durations for SEVERE, VIOLENT, and SUPERBOLT', () => {
  const boltPool = new LightningBoltPool({ poolSize: 8 });
  const start = new THREE.Vector3(0, 118, 0);
  const end = new THREE.Vector3(0, 100, 0);

  // 1. Minor strike (<10 kA) - Turquoise Cyan (Foto 2: 1 bead)
  const minorBolt = boltPool.acquire(start, end, 0.5, undefined, 1000, -8);
  assert.ok(minorBolt);
  assert.equal(minorBolt.durationMs, 200, 'Minor bolt duration should be 200ms');
  assert.equal(minorBolt.chargeCount, 1, 'Minor bolt must have 1 cascading charge bead');
  assert.equal(minorBolt.cascadingCharges?.visible, true);

  // 2. Standard strike (10-35 kA) - Neon Lilac (Foto 2: 2 beads)
  const stdBolt = boltPool.acquire(start, end, 1.0, undefined, 1000, -25);
  assert.ok(stdBolt);
  assert.equal(stdBolt.durationMs, 350, 'Standard bolt duration should be 350ms');
  assert.equal(stdBolt.chargeCount, 2, 'Standard bolt must have 2 cascading charge beads');
  assert.equal(stdBolt.cascadingCharges?.visible, true);

  // 3. SEVERE strike (35-75 kA) - Amber Gold (Foto 2: 4 beads)
  const severeBolt = boltPool.acquire(start, end, 1.5, undefined, 1000, -55);
  assert.ok(severeBolt);
  assert.equal(severeBolt.durationMs, 1200, 'Severe bolt duration must be extended to 1200ms (1.2s)');
  assert.equal(severeBolt.chargeCount, 2, 'Severe bolt must have 2 amber gold cascading charge beads (reduced per user prompt)');
  assert.equal(severeBolt.cascadingCharges?.visible, true, 'Cascading charges points mesh must be visible');

  // 4. VIOLENT strike (75-150 kA) - Ionic Fuchsia (Reduced bead count per user prompt: 3)
  const violentBolt = boltPool.acquire(start, end, 2.0, undefined, 1000, -110);
  assert.ok(violentBolt);
  assert.equal(violentBolt.durationMs, 1800, 'Violent bolt duration must be extended to 1800ms (1.8s)');
  assert.equal(violentBolt.chargeCount, 3, 'Violent bolt must have 3 luminous electric beads');
  assert.equal(violentBolt.cascadingCharges?.visible, true);

  // 5. SUPERBOLT strike (>150 kA) - Cosmic Ice-White (Reduced bead count per user prompt: 4)
  const superBolt = boltPool.acquire(start, end, 3.0, undefined, 1000, -210);
  assert.ok(superBolt);
  assert.equal(superBolt.durationMs, 2800, 'Superbolt duration must be extended to 2800ms (2.8s)');
  assert.equal(superBolt.chargeCount, 4, 'Superbolt must have 4 platinum gold hyper-energetic beads');
  assert.equal(superBolt.cascadingCharges?.visible, true);

  // 6. Test update loop animation & downward sliding
  boltPool.update(1500); // 500ms elapsed
  assert.equal(superBolt.active, true, 'Superbolt should still be active at 500ms');

  // Verify positions were calculated without NaN
  const posAttr = superBolt.cascadingCharges?.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < 12 * 3; i++) {
    assert.equal(isNaN(posAttr.array[i]), false, 'Bead coordinates must not be NaN');
  }

  // 7. Verify expiration
  boltPool.update(4000); // 3000ms elapsed (> 2800ms)
  assert.equal(superBolt.active, false, 'Superbolt must expire after its duration');
  assert.equal(superBolt.cascadingCharges?.visible, false, 'Cascading charges must be hidden on expiry');

  boltPool.destroy();
});

test('FAZ 1B - 4-Tier Storm Cell Evolution (WHITE, BLUE, YELLOW, RED)', () => {
  const batcher = new StormCellBatcher({ windowMs: 4 * 3600 * 1000, minStrikes: 5 });
  const baseTime = 1700000000000;

  // Helper to generate a cluster of strikes
  const makeStrikes = (count: number, lat: number, lon: number, time: number): LightningEvent[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `ev-${time}-${i}`,
      latitude: lat + (Math.random() - 0.5) * 0.2,
      longitude: lon + (Math.random() - 0.5) * 0.2,
      timestamp: time + i * 10,
      peakCurrent: -30,
      type: 'CG',
      source: 'blitzortung'
    }));
  };

  // 1. Fresh Convective Core (<30m age, 5 strikes) -> WHITE tier
  batcher.addStrikes(makeStrikes(5, 25.0, -80.0, baseTime));
  let cells = batcher.getActiveStormCells(baseTime + 1000);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'WHITE', 'Fresh convective core must be WHITE tier');

  // 2. Organizing regional cell (45 minutes age, 35 strikes) -> BLUE tier
  batcher.clear();
  const oldTime = baseTime - 45 * 60 * 1000; // 45m ago
  // First, register cell at oldTime
  batcher.addStrikes(makeStrikes(35, 25.0, -80.0, oldTime));
  batcher.getActiveStormCells(oldTime);
  // Keep alive with 5 fresh strikes at baseTime
  batcher.addStrikes(makeStrikes(5, 25.0, -80.0, baseTime));
  cells = batcher.getActiveStormCells(baseTime);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'BLUE', 'Organizing regional storm (45m) must be BLUE tier');

  // 3. Mature storm system (75 minutes age, 95 strikes) -> YELLOW tier
  batcher.clear();
  const matureTime = baseTime - 75 * 60 * 1000; // 75m ago
  batcher.addStrikes(makeStrikes(95, 25.0, -80.0, matureTime));
  batcher.getActiveStormCells(matureTime);
  batcher.addStrikes(makeStrikes(5, 25.0, -80.0, baseTime));
  cells = batcher.getActiveStormCells(baseTime);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'YELLOW', 'Mature storm system (75m) must be YELLOW tier');

  // 4. Supercell macro area (150 minutes age, 225 strikes) -> RED tier
  batcher.clear();
  const superTime = baseTime - 150 * 60 * 1000; // 150m ago
  batcher.addStrikes(makeStrikes(225, 25.0, -80.0, superTime));
  batcher.getActiveStormCells(superTime);
  batcher.addStrikes(makeStrikes(5, 25.0, -80.0, baseTime));
  cells = batcher.getActiveStormCells(baseTime);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'RED', 'Supercell macro area (150m, 225 strikes) must be RED tier');
  assert.ok(cells[0].boundingRadiusKm <= 220, 'Supercell bounding radius must be strictly clamped <= 220 km');

  batcher.clear();
});

test('FAZ 1B - Micro-Hotspot Mini White Hexagons inside RED / Mature Cells', () => {
  const batcher = new StormCellBatcher({ windowMs: 4 * 3600 * 1000, minStrikes: 5 });
  const baseTime = 1700000000000;
  const superTime = baseTime - 150 * 60 * 1000;

  // Build a RED tier cell at superTime (>= 220 strikes for RED tier)
  const initialStrikes: LightningEvent[] = [];
  for (let i = 0; i < 225; i++) {
    initialStrikes.push({
      id: `init-${i}`,
      latitude: 30.0 + (Math.random() - 0.5) * 0.2,
      longitude: -85.0 + (Math.random() - 0.5) * 0.2,
      timestamp: superTime + i * 10,
      peakCurrent: -45,
      type: 'CG',
      source: 'blitzortung'
    });
  }
  batcher.addStrikes(initialStrikes);
  batcher.getActiveStormCells(superTime + 1000);

  // Add 5 fresh strikes at baseTime including 3 recent strikes in sector 2
  batcher.addStrike({ id: 'base-1', latitude: 30.0, longitude: -85.0, timestamp: baseTime - 20000, peakCurrent: -30, type: 'CG', source: 'blitzortung' });
  batcher.addStrike({ id: 'base-2', latitude: 30.01, longitude: -85.01, timestamp: baseTime - 15000, peakCurrent: -30, type: 'CG', source: 'blitzortung' });
  batcher.addStrike({ id: 'hs-1', latitude: 30.15, longitude: -84.85, timestamp: baseTime - 10000, peakCurrent: -40, type: 'CG', source: 'blitzortung' });
  batcher.addStrike({ id: 'hs-2', latitude: 30.16, longitude: -84.84, timestamp: baseTime - 5000, peakCurrent: -40, type: 'CG', source: 'blitzortung' });
  batcher.addStrike({ id: 'hs-3', latitude: 30.14, longitude: -84.86, timestamp: baseTime - 2000, peakCurrent: -40, type: 'CG', source: 'blitzortung' });

  const cells = batcher.getActiveStormCells(baseTime);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'RED');
  assert.ok(cells[0].subHotspots, 'RED cell must have subHotspots property');
  assert.ok(cells[0].subHotspots!.length >= 1, 'Sector with 3 recent strikes must generate a micro-hotspot');

  const hs = cells[0].subHotspots![0];
  assert.ok(hs.strikeCount >= 2, 'Hotspot must have >= 2 strikes');
  assert.ok(hs.alpha > 0.5, 'Hotspot alpha must be active/pulsing');

  batcher.clear();
});

test('FAZ 1B - Agar.io Style Cell Fusion (Converging Animation & Red Assimilation)', () => {
  // Use spatialRadiusKm: 25 so two clusters separated by ~33 km form distinct cells
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 3, spatialRadiusKm: 25 });
  const now = 1700000000000;

  // Create two WHITE tier cells separated by ~33 km (within 42 km fusion threshold)
  // Cell 1 at (20.0, 10.0)
  for (let i = 0; i < 4; i++) {
    batcher.addStrike({ id: `c1-${i}`, latitude: 20.0, longitude: 10.0, timestamp: now - 5000, peakCurrent: -25, type: 'CG', source: 'blitzortung' });
  }
  // Cell 2 at (20.3, 10.0) ~ 33 km away
  for (let i = 0; i < 4; i++) {
    batcher.addStrike({ id: `c2-${i}`, latitude: 20.3, longitude: 10.0, timestamp: now - 5000, peakCurrent: -25, type: 'CG', source: 'blitzortung' });
  }

  const cells = batcher.getActiveStormCells(now);
  assert.equal(cells.length, 2, 'Must form 2 distinct cells prior to fusion convergence');
  // Fusion detection should flag fusionState on both
  const fusingCell = cells.find((c) => c.fusionState?.active);
  assert.ok(fusingCell, 'Cells within 42 km must initiate fusionState');
  assert.ok(fusingCell!.fusionState!.midLat > 0, 'Fusion state must have converging midpoint');

  batcher.clear();
});

test('FAZ 1B - StormCellRadar Passthrough Glitch Effect', () => {
  const radar = new StormCellRadar(100);
  const slot = (radar as any).hexPool[0];
  slot.active = true;
  slot.mesh.visible = true;
  slot.lastLat = 35.0;
  slot.lastLon = -75.0;
  slot.cellData = { boundingRadiusKm: 100 };
  slot.currentOpacity = 0.18;

  // Trigger glitch at coordinates
  radar.triggerPassthroughGlitch(35.1, -75.1);
  assert.ok(slot.passthroughGlitchUntil > Date.now(), 'passthroughGlitchUntil must be set into the future');

  // During glitch, update() should dip the opacity
  radar.update(0.016);
  assert.ok(slot.scanlineMaterial.uniforms.uOpacity.value < 0.10, 'Holographic scanline opacity must dip during passthrough glitch');

  radar.destroy();
});

test('FAZ 1B Refinement - Doppler Radar Sizing, NormalBlending & 24H Spatial Agglomeration', () => {
  const radar = new StormCellRadar(100);
  const batcher = new StormCellBatcher();
  const now = Date.now();

  // 1. Verify Proportional Scale & Blending in StormCellRadar
  const dummyRedCell = {
    id: 'test-red-cell',
    centroid: { latitude: 35.0, longitude: -80.0 },
    boundingRadiusKm: 180,
    strikeCount: 95,
    events: [],
    firstSeen: now - 3600000,
    lastSeen: now,
    ageSeconds: 3600,
    meanIntensity: -45,
    warningLevel: 'CRITICAL' as const,
    tier: 'RED' as const,
    subHotspots: [
      { id: 'hs-0', sectorIndex: 0, latitude: 35.0, longitude: -80.0, strikeCount: 10, lastStrikeTime: now, alpha: 0.9 }
    ]
  };

  radar.updateCells([dummyRedCell]);
  const slot = (radar as any).hexPool[0];

  assert.equal(slot.targetRadius, 2.85, 'Red tier / Supercell cell visual radius must be 2.85u (190-280 km footprint per Excel)');
  const miniMat = slot.microHotspotMeshes[0].material as THREE.ShaderMaterial;
  assert.equal(miniMat.blending, THREE.NormalBlending, 'Micro convective nodes must use NormalBlending');
  assert.equal(slot.microHotspotMeshes[0].scale.x, 0.14, 'Micro convective node scale must be 0.14');
  assert.ok(slot.outerEdgeLine, 'Crisp 1px outer laser rim must be initialized');

  // 2. Verify 24H Spatial Agglomeration
  // Two groups of strikes separated by 120 km (both with >= 5 strikes)
  const strikes: LightningEvent[] = [];
  // Cluster 1 at (40.0, -90.0)
  for (let i = 0; i < 8; i++) {
    strikes.push({ id: `c1-${i}`, latitude: 40.0, longitude: -90.0, timestamp: now - 10000, peakCurrent: -30, type: 'CG', source: 'blitzortung' });
  }
  // Cluster 2 at (40.8, -90.0) ~88 km away
  for (let i = 0; i < 8; i++) {
    strikes.push({ id: `c2-${i}`, latitude: 40.8, longitude: -90.0, timestamp: now - 10000, peakCurrent: -30, type: 'CG', source: 'blitzortung' });
  }

  batcher.recompute24hCells(strikes, now);
  batcher.setMode('24H');
  const cells24h = batcher.getActiveStormCells(now);

  assert.equal(cells24h.length, 1, 'Two clusters within 320 km must be merged into 1 aggregated regional storm cell');
  assert.equal(cells24h[0].strikeCount, 16, 'Merged cell must preserve all 16 strikes');

  radar.destroy();
  batcher.clear();
});
