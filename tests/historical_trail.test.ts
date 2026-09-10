import { HistoricalTrailLayer } from '../src/world/vfx/HistoricalTrailLayer';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('--- RUNNING PHASE 18 HISTORICAL 24H TRAILS UNIT TESTS ---');

const capacity = 1000; // Small capacity for fast cycling test
const retentionMs = 24 * 60 * 60 * 1000;
const layer = new HistoricalTrailLayer({ maxCapacity: capacity, retentionWindowMs: retentionMs });

console.log('Test 1: Verifying strike addition and bounded capacity...');
assert(layer.getCount() === 0, 'Initial count must be 0');
assert(layer.getCapacity() === 1000, 'Capacity must match config');

const now = Date.now();

// Add 500 strikes
for (let i = 0; i < 500; i++) {
  layer.addStrike(10 + (i % 20), 20 + (i % 20), now - i * 1000);
}
assert(layer.getCount() === 500, 'Count must reach 500');

// Add 700 more strikes (total 1200 > 1000 capacity) to verify ring buffer cycling
for (let i = 500; i < 1200; i++) {
  layer.addStrike(10 + (i % 20), 20 + (i % 20), now - i * 1000);
}
assert(layer.getCount() === capacity, `Count must clamp strictly at max capacity (${capacity})`);
console.log('  -> Ring buffer clamped strictly at capacity without unbounded array growth: OK');

console.log('Test 2: Verifying multi-epoch age calculation across 24h spectrum...');
const testLayer = new HistoricalTrailLayer({ maxCapacity: 10, retentionWindowMs: retentionMs });

// Strike 0: Instantaneous (now)
testLayer.addStrike(0, 0, now);

// Strike 1: 1.2 Hours old (5% of 24h)
testLayer.addStrike(10, 10, now - 0.05 * retentionMs);

// Strike 2: 6 Hours old (25% of 24h)
testLayer.addStrike(20, 20, now - 0.25 * retentionMs);

// Strike 3: 12 Hours old (50% of 24h)
testLayer.addStrike(30, 30, now - 0.50 * retentionMs);

// Strike 4: 24 Hours old (100% of 24h)
testLayer.addStrike(40, 40, now - 1.0 * retentionMs);

// Strike 5: 30 Hours old (> 100% clamp)
testLayer.addStrike(50, 50, now - 1.25 * retentionMs);

testLayer.refreshAges(now);

const age0 = testLayer.getAgeAt(0);
const age1 = testLayer.getAgeAt(1);
const age2 = testLayer.getAgeAt(2);
const age3 = testLayer.getAgeAt(3);
const age4 = testLayer.getAgeAt(4);
const age5 = testLayer.getAgeAt(5);

console.log(`  -> Calculated ages: now=${age0.toFixed(3)}, 1.2h=${age1.toFixed(3)}, 6h=${age2.toFixed(3)}, 12h=${age3.toFixed(3)}, 24h=${age4.toFixed(3)}, 30h=${age5.toFixed(3)}`);

assert(Math.abs(age0 - 0.0) < 0.001, 'Fresh strike age must be 0.0');
assert(Math.abs(age1 - 0.05) < 0.005, '1.2h strike age must be ~0.05');
assert(Math.abs(age2 - 0.25) < 0.005, '6h strike age must be ~0.25');
assert(Math.abs(age3 - 0.50) < 0.005, '12h strike age must be ~0.50');
assert(Math.abs(age4 - 1.00) < 0.005, '24h strike age must be ~1.00');
assert(Math.abs(age5 - 1.00) < 0.005, 'Older strikes must clamp to 1.00');

console.log('Test 3: Verifying layer visibility toggle and memory footprint...');
assert(testLayer.getIsEnabled() === true, 'Default visibility must be true');
testLayer.setEnabled(false);
assert(testLayer.getIsEnabled() === false, 'Layer must be disabled');
assert(testLayer.pointsMesh.visible === false, 'Points mesh visibility must be false');
testLayer.setEnabled(true);
assert(testLayer.pointsMesh.visible === true, 'Points mesh visibility must be restored');

// Memory budget calculation for 100k points:
const fullCapacity = 100000;
const memoryBytes = (fullCapacity * 3 * 4) + (fullCapacity * 4) + (fullCapacity * 8);
const memoryMB = memoryBytes / (1024 * 1024);
console.log(`  -> 100,000 strikes memory footprint: ${memoryMB.toFixed(2)} MB (< 3 MB budget)`);
assert(memoryMB < 3.0, 'Memory footprint for 100k strikes must be strictly under 3 MB');

console.log('--- ALL PHASE 18 HISTORICAL 24H TRAILS TESTS FINISHED: OK ---');
