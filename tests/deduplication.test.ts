import { EventDeduplicator } from '../src/services/store/EventDeduplicator';
import type { LightningEvent } from '../src/types/lightning';

console.log('--- RUNNING SPATIAL/TEMPORAL DEDUPLICATION TESTS ---');

const dedup = new EventDeduplicator(15, 500); // 15 km, 500 ms

const baseTime = 1700000000000;

function createEvent(id: string, lat: number, lon: number, timeOffsetMs: number): LightningEvent {
  return {
    id,
    timestamp: baseTime + timeOffsetMs,
    latitude: lat,
    longitude: lon,
    peakCurrent: -35,
    type: 'CG',
    source: 'synthetic'
  };
}

// 1. Initial event should be accepted
const ev1 = createEvent('ev-1', 41.0082, 28.9784, 0);
if (dedup.isDuplicate(ev1)) {
  throw new Error('Initial unique event was incorrectly marked as duplicate!');
}
console.log('1. Initial unique event accepted: PASS');

// 2. Exact duplicate 100ms later should be rejected
const ev2 = createEvent('ev-2', 41.0082, 28.9784, 100);
if (!dedup.isDuplicate(ev2)) {
  throw new Error('Identical strike 100ms later was not detected as duplicate!');
}
console.log('2. Immediate duplicate (0 km, 100 ms) rejected: PASS');

// 3. Nearby strike (5 km away, 200 ms later) should be rejected (< 15 km)
// ~0.04° lat ~ 4.4 km
const ev3 = createEvent('ev-3', 41.0482, 28.9784, 200);
if (!dedup.isDuplicate(ev3)) {
  throw new Error('Nearby strike (4.4 km, 200 ms) was not detected as duplicate!');
}
console.log('3. Nearby strike (4.4 km, 200 ms) rejected: PASS');

// 4. Nearby strike (5 km away) but 600 ms later (> 500 ms) should be ACCEPTED
const ev4 = createEvent('ev-4', 41.0482, 28.9784, 600);
if (dedup.isDuplicate(ev4)) {
  throw new Error('Strike outside time window (600 ms) was incorrectly rejected!');
}
console.log('4. Outside time window (600 ms) accepted: PASS');

// 5. Far away strike (45 km away) at same timestamp should be ACCEPTED
// 0.4° lat ~ 44.5 km
const ev5 = createEvent('ev-5', 41.4082, 28.9784, 600);
if (dedup.isDuplicate(ev5)) {
  throw new Error('Distant strike (45 km away) was incorrectly rejected!');
}
console.log('5. Outside distance threshold (45 km) accepted: PASS');

// 6. Antimeridian wrap-around (+179.95° vs -179.95° at equator)
// Delta lon = 0.1° ~ 11.1 km (< 15 km)
const evDateLine1 = createEvent('ev-dl-1', 0.0, 179.95, 1000);
const evDateLine2 = createEvent('ev-dl-2', 0.0, -179.95, 1100);

if (dedup.isDuplicate(evDateLine1)) {
  throw new Error('First antimeridian event failed to register!');
}
if (!dedup.isDuplicate(evDateLine2)) {
  throw new Error('Antimeridian wrap-around duplicate was not detected!');
}
console.log('6. Antimeridian wrap-around (+179.95° / -179.95°, 11 km) rejected: PASS');

// 7. Metrics check
console.log('7. Deduplication stats:', {
  totalChecked: dedup.getTotalChecked(),
  duplicates: dedup.getDuplicateCount()
});
if (dedup.getDuplicateCount() !== 3) {
  throw new Error(`Expected exactly 3 duplicates, got ${dedup.getDuplicateCount()}`);
}

console.log('Deduplication unit tests completed.');
