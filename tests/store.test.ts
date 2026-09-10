import { LiveEventStore } from '../src/services/store/LiveEventStore';
import type { LightningEvent } from '../src/types/lightning';

console.log('--- RUNNING LIVE EVENT STORE UNIT TESTS ---');

const baseTime = Date.now();

function makeEvent(id: string, lat: number, lon: number, offsetMs: number = 0): LightningEvent {
  return {
    id,
    timestamp: baseTime + offsetMs,
    latitude: lat,
    longitude: lon,
    peakCurrent: -40,
    type: 'CG',
    source: 'synthetic'
  };
}

// 1. Basic insertion and deduplication rejection
const store = new LiveEventStore(100, 60000, 15, 500); // capacity: 100, retention: 60s
const evA = makeEvent('ev-A', 41.0082, 28.9784, 0);
const evADup = makeEvent('ev-A-dup', 41.0082, 28.9784, 50); // Duplicate!
const evB = makeEvent('ev-B', 48.8566, 2.3522, 100); // Paris, unique

if (!store.addEvent(evA)) throw new Error('Failed to add first event!');
if (store.addEvent(evADup)) throw new Error('Duplicate event was accepted by store!');
if (!store.addEvent(evB)) throw new Error('Failed to add unique second event!');

console.log('1. Add event and deduplication integration: PASS');

// 2. FIFO Capacity Limit Enforcement
const boundedStore = new LiveEventStore(5, 60000, 1, 1); // maxCapacity: 5
for (let i = 0; i < 12; i++) {
  boundedStore.addEvent(makeEvent(`fifo-${i}`, i * 2, i * 2, i * 1000));
}
if (boundedStore.getEventCount() !== 5) {
  throw new Error(`Expected exactly 5 events in bounded store, got ${boundedStore.getEventCount()}`);
}
const recent = boundedStore.getRecentEvents(60000);
if (recent[0].id !== 'fifo-7' || recent[4].id !== 'fifo-11') {
  throw new Error(`FIFO order violated! Oldest is ${recent[0].id}, newest is ${recent[4].id}`);
}
console.log('2. Strict FIFO capacity enforcement: PASS');

// 3. Temporal Pruning Test
const pruneStore = new LiveEventStore(100, 10000, 1, 1); // retention: 10s
const event1 = makeEvent('event-1', 10, 10, -5000); // 5s ago (fresh, within 10s retention)
const event2 = makeEvent('event-2', 20, 20, 0); // now (fresh)

pruneStore.addEvent(event1);
pruneStore.addEvent(event2);
if (pruneStore.getEventCount() !== 2) {
  throw new Error(`Expected 2 events before prune, got ${pruneStore.getEventCount()}`);
}

// Explicitly prune 6 seconds after baseTime (cutoff = baseTime - 4000; event1 at -5000 is pruned, event2 at 0 is kept)
const prunedCount = pruneStore.prune(baseTime + 6000);
if (prunedCount !== 1 || pruneStore.getEventCount() !== 1) {
  throw new Error(`Expected 1 event after prune, got ${pruneStore.getEventCount()} (pruned: ${prunedCount})`);
}
if (pruneStore.getRecentEvents(30000)[0].id !== 'event-2') {
  throw new Error('Fresh event was incorrectly pruned!');
}
console.log('3. Temporal pruning of stale events: PASS');

// 4. Area Search (getEventsInArea)
const areaStore = new LiveEventStore(100, 60000);
// Center: Istanbul (41.0082, 28.9784)
const istCenter = makeEvent('ist-center', 41.0082, 28.9784, 0);
// Kadikoy (~6 km away)
const istClose = makeEvent('ist-close', 40.9900, 29.0200, 1000);
// Ankara (~350 km away)
const ankara = makeEvent('ankara', 39.9334, 32.8597, 2000);

areaStore.addEvent(istCenter);
areaStore.addEvent(istClose);
areaStore.addEvent(ankara);

// Query 50 km around Istanbul within last 60s
const within50km = areaStore.getEventsInArea(41.0082, 28.9784, 50, 60000);
if (within50km.length !== 2) {
  throw new Error(`Expected 2 events within 50 km of Istanbul, got ${within50km.length}`);
}
const within400km = areaStore.getEventsInArea(41.0082, 28.9784, 400, 60000);
if (within400km.length !== 3) {
  throw new Error(`Expected 3 events within 400 km of Istanbul, got ${within400km.length}`);
}
console.log('4. Spatial proximity query (getEventsInArea): PASS');

// 5. Reactive Subscription Test
const pubSubStore = new LiveEventStore(100, 60000);
const receivedEvents: string[] = [];
const unsubscribe = pubSubStore.subscribe((ev) => {
  receivedEvents.push(ev.id);
});

pubSubStore.addEvent(makeEvent('sub-1', 10, 10, 0));
pubSubStore.addEvent(makeEvent('sub-2', 20, 20, 1000));
unsubscribe();
pubSubStore.addEvent(makeEvent('sub-3', 30, 30, 2000));

if (receivedEvents.length !== 2 || receivedEvents[0] !== 'sub-1' || receivedEvents[1] !== 'sub-2') {
  throw new Error(`Pub/Sub listener failed! Received: ${receivedEvents.join(', ')}`);
}
console.log('5. Reactive observer subscription and cleanup: PASS');

// 6. Statistics Verification
const stats = store.getStats();
console.log('6. Store statistics snapshot:', stats);
if (stats.totalReceived !== 3 || stats.totalStored !== 2 || stats.totalDuplicatesRejected !== 1) {
  throw new Error('Store stats numbers mismatch!');
}

console.log('Live event store unit tests completed.');
