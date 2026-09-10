import test from 'node:test';
import assert from 'node:assert/strict';
import { StormCellBatcher } from '../src/services/clustering/StormCellBatcher';
import type { LightningEvent } from '../src/types/lightning';
import { haversineDistanceKm } from '../src/utils/coordinates';

function makeStrike(lat: number, lon: number, timestamp: number, peakCurrent: number = -40): LightningEvent {
  return {
    id: `ev-${lat}-${lon}-${timestamp}-${Math.random()}`,
    latitude: lat,
    longitude: lon,
    timestamp,
    peakCurrent,
    type: 'CG',
    source: 'synthetic'
  };
}

test('StormCellBatcher: < 5 strikes in 30s window does not form a StormCell', () => {
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5 });
  const now = 100000;

  // Add 4 strikes
  for (let i = 0; i < 4; i++) {
    batcher.addStrike(makeStrike(28.0 + i * 0.05, -82.0 + i * 0.05, now - 1000 * i));
  }

  assert.equal(batcher.getEventCount(), 4);
  const cells = batcher.getActiveStormCells(now);
  assert.equal(cells.length, 0, 'Should not form a cell with only 4 strikes');
});

test('StormCellBatcher: >= 5 strikes within 150km in 30s forms an active StormCell', () => {
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5, spatialRadiusKm: 150 });
  const now = 100000;

  // Add 6 strikes around Florida (28.5N, -81.5W)
  for (let i = 0; i < 6; i++) {
    batcher.addStrike(makeStrike(28.5 + (i - 3) * 0.1, -81.5 + (i - 3) * 0.1, now - 2000 * i, -45));
  }

  const cells = batcher.getActiveStormCells(now);
  assert.equal(cells.length, 1, 'Should form exactly 1 active StormCell');
  assert.equal(cells[0].strikeCount, 6);
  assert.ok(Math.abs(cells[0].centroid.latitude - 28.5) < 0.5, 'Centroid latitude matches cluster center');
  assert.ok(Math.abs(cells[0].centroid.longitude - (-81.5)) < 0.5, 'Centroid longitude matches cluster center');
  assert.ok(cells[0].boundingRadiusKm >= 30, 'Bounding radius respects minRadiusKm');
  assert.equal(cells[0].meanIntensity, 45);
});

test('StormCellBatcher: sliding window prunes strikes older than 30s', () => {
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5 });

  // Add 5 strikes at t = 70,000 (30 seconds before t0)
  for (let i = 0; i < 5; i++) {
    batcher.addStrike(makeStrike(0.0, 25.0, 70000 + i * 100));
  }

  // At t = 95,000, they are 25s old, still active (< 30s)
  let cells = batcher.getActiveStormCells(95000);
  assert.equal(cells.length, 1, 'Should be active at 25 seconds');

  // At t = 105,000, they are 35s old, must be evicted
  cells = batcher.getActiveStormCells(105000);
  assert.equal(cells.length, 0, 'Strikes older than 30s should be pruned');
  assert.equal(batcher.getEventCount(), 0, 'Buffer should be empty after pruning');
});

test('StormCellBatcher: forms multiple distinct cells in geographically separated areas', () => {
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5, spatialRadiusKm: 150 });
  const now = 200000;

  // 5 strikes in Florida (28N, -82W)
  for (let i = 0; i < 5; i++) {
    batcher.addStrike(makeStrike(28.0 + i * 0.02, -82.0 + i * 0.02, now - 1000));
  }

  // 7 strikes in Congo Basin (0N, 25E)
  for (let i = 0; i < 7; i++) {
    batcher.addStrike(makeStrike(0.5 + i * 0.02, 25.0 + i * 0.02, now - 1000));
  }

  const cells = batcher.getActiveStormCells(now);
  assert.equal(cells.length, 2, 'Should form 2 distinct StormCells');
  // First cell is sorted by strike count descending
  assert.equal(cells[0].strikeCount, 7, 'First cell is Congo with 7 strikes');
  assert.equal(cells[1].strikeCount, 5, 'Second cell is Florida with 5 strikes');
});

test('StormCellBatcher: clear empties buffer', () => {
  const batcher = new StormCellBatcher();
  batcher.addStrike(makeStrike(10, 10, Date.now()));
  assert.equal(batcher.getEventCount(), 1);
  batcher.clear();
  assert.equal(batcher.getEventCount(), 0);
  assert.equal(batcher.getActiveStormCells().length, 0);
});

test('StormCellBatcher: 30s heartbeat resets whenever a new strike hits within cell boundary', () => {
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5 });
  const t0 = 100000;

  // Form initial cell at t0 with 5 strikes
  for (let i = 0; i < 5; i++) {
    batcher.addStrike(makeStrike(30.0, 31.0, t0 - 500 * i));
  }

  let cells = batcher.getActiveStormCells(t0);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].fadeProgress ?? 0, 0);

  // Advance 25 seconds (t0 + 25000) - cell is nearing expiry (< 5s left)
  const t25 = t0 + 25000;
  cells = batcher.getActiveStormCells(t25);
  assert.equal(cells.length, 1);
  assert.ok(cells[0].heartbeatRemainingMs! <= 5500, 'Heartbeat should have ~5s remaining');

  // A single new strike lands inside cell at t0 + 26000
  const t26 = t0 + 26000;
  batcher.addStrike(makeStrike(30.05, 31.02, t26));

  // At t0 + 27000, verify heartbeat was RESET back to nearly 29s!
  const t27 = t0 + 27000;
  cells = batcher.getActiveStormCells(t27);
  assert.equal(cells.length, 1);
  assert.ok(cells[0].heartbeatRemainingMs! >= 28000, 'Heartbeat was renewed by fresh strike!');
  assert.equal(cells[0].fadeProgress ?? 0, 0, 'Cell is not fading out');
});

test('StormCellBatcher: dynamic radius is strictly bounded at maxRadiusKm (220 km)', () => {
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5, maxRadiusKm: 220, spatialRadiusKm: 300 });
  const now = 500000;

  // Add 10 strikes distributed across 250+ km
  for (let i = 0; i < 10; i++) {
    batcher.addStrike(makeStrike(10.0 + i * 0.3, 20.0 + i * 0.3, now - 1000));
  }

  const cells = batcher.getActiveStormCells(now);
  assert.equal(cells.length, 1);
  assert.ok(cells[0].boundingRadiusKm <= 220, `Bounding radius ${cells[0].boundingRadiusKm} must not exceed 220 km`);
});

test('StormCellBatcher: assigns CRITICAL warning tone to massive storm clusters', () => {
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5 });
  const now = 600000;

  // Add 20 strikes into one intense storm cell
  for (let i = 0; i < 20; i++) {
    batcher.addStrike(makeStrike(15.0 + (i % 5) * 0.02, 45.0 + Math.floor(i / 5) * 0.02, now - 500 * i, -65));
  }

  const cells = batcher.getActiveStormCells(now);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].warningLevel, 'CRITICAL', 'Dense 20-strike storm receives CRITICAL warning level');
});

test('StormCellBatcher REGRESSION: Florida coastal thunderstorm lines (Tampa vs Daytona) remain separate cells (no ghost cell in Orlando)', () => {
  // Default spatialRadiusKm = 48 km
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5 });
  const now = 700000;

  // 6 strikes on Tampa West Coast (27.95 N, -82.45 W)
  for (let i = 0; i < 6; i++) {
    batcher.addStrike(makeStrike(27.95 + i * 0.02, -82.45 + i * 0.02, now - 1000 * i));
  }

  // 6 strikes on Daytona East Coast (29.21 N, -81.02 W)
  for (let i = 0; i < 6; i++) {
    batcher.addStrike(makeStrike(29.21 + i * 0.02, -81.02 + i * 0.02, now - 1000 * i));
  }

  const cells = batcher.getActiveStormCells(now);
  assert.equal(cells.length, 2, 'Must form exactly 2 distinct cells for Tampa and Daytona, NOT 1 merged cell');

  // Verify centroids sit directly on their respective strike clusters
  for (const cell of cells) {
    let closestStrikeDist = Infinity;
    for (const ev of cell.events) {
      const d = haversineDistanceKm(cell.centroid.latitude, cell.centroid.longitude, ev.latitude, ev.longitude);
      if (d < closestStrikeDist) closestStrikeDist = d;
    }
    assert.ok(closestStrikeDist <= 15, `Centroid must sit on real strikes (closest is ${closestStrikeDist.toFixed(1)} km)`);

    // Verify NO cell is placed in Central Florida / Orlando (28.53, -81.38)
    const distToOrlando = haversineDistanceKm(cell.centroid.latitude, cell.centroid.longitude, 28.53, -81.38);
    assert.ok(distToOrlando >= 50, `Cell must NOT sit in empty Orlando dead-zone (dist is ${distToOrlando.toFixed(1)} km)`);
  }
});

test('StormCellBatcher REGRESSION: Dead-Zone Guard locks centroid to peak density core (medoid) if mathematical center-of-mass falls in empty void', () => {
  // Even if spatialRadiusKm is enlarged to force linking separated clusters into 1 cell:
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5, spatialRadiusKm: 250 });
  const now = 800000;

  // Dense cluster of 12 strikes in Miami (25.76 N, -80.19 W)
  for (let i = 0; i < 12; i++) {
    batcher.addStrike(makeStrike(25.76 + (i % 3) * 0.01, -80.19 + Math.floor(i / 3) * 0.01, now - 500 * i, -60));
  }

  // Sparsely distributed 5 strikes in Fort Myers (26.64 N, -81.87 W) ~180 km away
  for (let i = 0; i < 5; i++) {
    batcher.addStrike(makeStrike(26.64 + i * 0.01, -81.87 + i * 0.01, now - 500 * i, -30));
  }

  const cells = batcher.getActiveStormCells(now);
  assert.equal(cells.length, 1, 'Forced 1 cluster due to 250km radius');

  const cell = cells[0];
  // Verify distance from centroid to closest real strike: MUST NOT be in empty Everglades (>18km)
  let closestDist = Infinity;
  for (const ev of cell.events) {
    const d = haversineDistanceKm(cell.centroid.latitude, cell.centroid.longitude, ev.latitude, ev.longitude);
    if (d < closestDist) closestDist = d;
  }

  assert.ok(closestDist <= 18, `Dead-zone guard must ensure centroid sits <= 18km of real strikes (was ${closestDist.toFixed(1)} km)`);

  // It should be anchored to the densest core (Miami: ~25.76, -80.19)
  const distToMiami = haversineDistanceKm(cell.centroid.latitude, cell.centroid.longitude, 25.76, -80.19);
  assert.ok(distToMiami <= 20, `Centroid must anchor to the dense Miami core (dist: ${distToMiami.toFixed(1)} km)`);
});

test('StormCellBatcher REGRESSION: Cell fusion preserves dominant cell core centroid rather than placing cell in midpoint void', () => {
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 3, spatialRadiusKm: 48 });
  const now = 900000;

  // Form Cell 1: Dominant 10-strike cluster at (32.0, -90.0)
  for (let i = 0; i < 10; i++) {
    batcher.addStrike(makeStrike(32.0 + (i % 3) * 0.02, -90.0 + Math.floor(i / 3) * 0.02, now - 500 * i, -50));
  }
  // Form Cell 2: Subordinate 4-strike cluster at (32.25, -90.25) ~36 km away
  for (let i = 0; i < 4; i++) {
    batcher.addStrike(makeStrike(32.25 + i * 0.01, -90.25 + i * 0.01, now - 500 * i, -30));
  }

  let cells = batcher.getActiveStormCells(now);
  // Trigger fusion cycles
  for (let step = 1; step <= 15; step++) {
    cells = batcher.getActiveStormCells(now + step * 100);
  }

  // Once fused, only 1 cell remains
  assert.equal(cells.length, 1);
  const fusedCell = cells[0];
  assert.equal(fusedCell.strikeCount, 14);

  // Centroid must be anchored to dominant core (32.0, -90.0), NOT at the empty midpoint (~32.125, -90.125)
  const distToDominantCore = haversineDistanceKm(fusedCell.centroid.latitude, fusedCell.centroid.longitude, 32.0, -90.0);
  assert.ok(distToDominantCore <= 15, `Fused centroid must be anchored to dominant core (dist: ${distToDominantCore.toFixed(1)} km)`);
});

test('StormCellBatcher REGRESSION: Tiered Demotion Ladder (RED -> YELLOW -> BLUE -> WHITE -> DISSOLVE) and dynamic radius shrinking', () => {
  const batcher = new StormCellBatcher({ minStrikes: 5, spatialRadiusKm: 48 });
  const t0 = 10000000;

  // Add 500 strikes clustered at (35.0, 40.0) within 15 km -> classifies as MCS / RED tier
  for (let i = 0; i < 500; i++) {
    batcher.addStrike(makeStrike(35.0 + (i % 10) * 0.01, 40.0 + Math.floor(i / 10) * 0.003, t0 - 100 * i, -65));
  }

  let cells = batcher.getActiveStormCells(t0);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'RED', 'Initial dense cluster must be RED tier');
  const initialRadius = cells[0].boundingRadiusKm;
  assert.ok(initialRadius >= 30, 'Initial radius must be substantial');

  // Advance 5 minutes without strikes (t0 + 300,000ms) -> Demotes to YELLOW!
  const t5min = t0 + 300000 + 1000;
  cells = batcher.getActiveStormCells(t5min);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'YELLOW', 'After 5m inactivity, RED demotes to YELLOW');
  assert.ok(cells[0].boundingRadiusKm < initialRadius, 'Radius must shrink on demotion');
  const yellowRadius = cells[0].boundingRadiusKm;

  // Advance 4 minutes more without strikes (t0 + 300,000 + 240,000ms) -> Demotes to BLUE!
  const t9min = t5min + 240000 + 1000;
  cells = batcher.getActiveStormCells(t9min);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'BLUE', 'After 4m further inactivity, YELLOW demotes to BLUE');
  assert.ok(cells[0].boundingRadiusKm < yellowRadius, 'Radius must shrink further on demotion');
  const blueRadius = cells[0].boundingRadiusKm;

  // Advance 3 minutes more without strikes -> Demotes to WHITE!
  const t12min = t9min + 180000 + 1000;
  cells = batcher.getActiveStormCells(t12min);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'WHITE', 'After 3m further inactivity, BLUE demotes to WHITE');
  assert.ok(cells[0].boundingRadiusKm < blueRadius, 'Radius shrinks to isolated scale');

  // Single-Strike Trap Guard: A single strike lands at t12min!
  // It must NOT resurrect the cell to RED or YELLOW; it remains WHITE with refreshed timer.
  batcher.addStrike(makeStrike(35.01, 40.01, t12min + 100));
  cells = batcher.getActiveStormCells(t12min + 1000);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].tier, 'WHITE', 'Single strike must NOT resurrect dead supercell to RED');

  // Advance past white timeout (2 min + 4s fade) -> Cell completely dissolves!
  const t15min = t12min + 1000 + 120000 + 4000;
  cells = batcher.getActiveStormCells(t15min);
  assert.equal(cells.length, 0, 'Cell must fully dissolve and vanish from globe');
});



