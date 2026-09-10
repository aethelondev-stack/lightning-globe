import { EventDirector } from '../src/services/director/EventDirector';
import type { ScoredCluster } from '../src/types/scoring';

console.log('--- RUNNING EVENT DIRECTOR & PRESENTATION QUEUE UNIT TESTS ---');

function makeCluster(
  id: string,
  lat: number,
  lon: number,
  score: number,
  lastEventTimestamp: number
): ScoredCluster {
  return {
    id,
    centroid: { latitude: lat, longitude: lon },
    boundingRadiusKm: 50,
    eventCount: Math.round(score * 40),
    events: [],
    firstEventTimestamp: lastEventTimestamp - 60000,
    lastEventTimestamp,
    activityScore: score,
    presentationClass: 'LOCAL',
    strikesPerMinute: 20,
    growthRate: 1.0,
    breakdown: {
      rateScore: score,
      growthScore: score,
      energyScore: score,
      clusterSizeScore: score
    }
  };
}

const now = 1000000;

// ----------------------------------------------------
// TEST 1: Queue Ranking & Bounded Capacity (Max 8)
// ----------------------------------------------------
const director = new EventDirector({ maxQueueSize: 8 });

const candidateClusters: ScoredCluster[] = [];
for (let i = 0; i < 12; i++) {
  // Scores from 0.12 down to 0.01 (multiplied by 0.08)
  const score = Number((0.10 + i * 0.07).toFixed(3));
  candidateClusters.push(makeCluster(`cluster-${i}`, 10 + i, 20 + i, score, now));
}

// Update clusters
director.updateClusters(candidateClusters, now);
const queue = director.getQueue();

if (queue.length !== 8) {
  throw new Error(`Expected queue capped at 8, got ${queue.length}`);
}

// Verify descending order
for (let i = 0; i < queue.length - 1; i++) {
  if (queue[i].priority < queue[i + 1].priority) {
    throw new Error(`Queue not sorted descending: [${i}] ${queue[i].priority} < [${i + 1}] ${queue[i + 1].priority}`);
  }
}

// Highest score must be at head (0.10 + 11 * 0.07 = 0.87)
if (queue[0].priority < 0.85) {
  throw new Error(`Expected head cluster priority >= 0.85, got ${queue[0].priority}`);
}

console.log('1. Priority queue ranking & max 8 capacity: OK');

// ----------------------------------------------------
// TEST 2: Presentation & Temporal Cooldown (45s)
// ----------------------------------------------------
const testDirector = new EventDirector({ clusterCooldownMs: 45000 });

const congoCluster = makeCluster('c-congo', 0, 25, 0.90, now);
const amazonCluster = makeCluster('c-amazon', -3, -60, 0.75, now);
const seAsiaCluster = makeCluster('c-seasia', 5, 105, 0.60, now);

testDirector.updateClusters([congoCluster, amazonCluster, seAsiaCluster], now);

// First target must be Congo
const target1 = testDirector.getNextTarget(now);
if (!target1 || target1.id !== 'c-congo') {
  throw new Error(`Expected target1 to be c-congo, got ${target1?.id}`);
}

// 5 seconds later: all 3 clusters still active
const tPlus5s = now + 5000;
testDirector.updateClusters([congoCluster, amazonCluster, seAsiaCluster], tPlus5s);

// Congo should be suppressed due to 45s cooldown; next target must be Amazon
const target2 = testDirector.getNextTarget(tPlus5s);
if (!target2 || target2.id !== 'c-amazon') {
  throw new Error(`Expected target2 to be c-amazon (Congo in cooldown), got ${target2?.id}`);
}

// Active cooldown count should be 2 (Congo & Amazon)
if (testDirector.getActiveCooldownCount(tPlus5s) !== 2) {
  throw new Error(`Expected 2 active cooldowns, got ${testDirector.getActiveCooldownCount(tPlus5s)}`);
}

// 50 seconds later: Congo's 45s cooldown expires
const tPlus50s = now + 50000;
testDirector.updateClusters([congoCluster, amazonCluster, seAsiaCluster], tPlus50s);

// Congo should now be eligible again because cooldown expired
const queueAfter50s = testDirector.getQueue();
const hasCongo = queueAfter50s.some((item) => item.cluster.id === 'c-congo');
if (!hasCongo) {
  throw new Error('Expected c-congo to re-enter queue after 45s cooldown expired');
}

console.log('2. Presentation & 45s temporal cooldown: OK');

// ----------------------------------------------------
// TEST 3: Spatial Proximity Cooldown (150 km Radius)
// ----------------------------------------------------
const spatialDirector = new EventDirector({
  clusterCooldownMs: 45000,
  spatialCooldownRadiusKm: 150
});

const centralCluster = makeCluster('c-origin', 10.0, 20.0, 0.85, now);
spatialDirector.updateClusters([centralCluster], now);

// Present central cluster
const originTarget = spatialDirector.getNextTarget(now);
if (!originTarget || originTarget.id !== 'c-origin') {
  throw new Error('Failed to acquire initial central cluster');
}

// A new cluster emerges nearby: ~38 km away (lat 10.3, lon 20.2)
const nearbyCluster = makeCluster('c-nearby-38km', 10.3, 20.2, 0.80, now + 1000);

// A new cluster emerges far away: ~1000 km away (lat 15.0, lon 30.0)
const farCluster = makeCluster('c-far-1000km', 15.0, 30.0, 0.70, now + 1000);

spatialDirector.updateClusters([centralCluster, nearbyCluster, farCluster], now + 1000);
const spatialQueue = spatialDirector.getQueue();

// Nearby cluster must be filtered out by 150 km spatial cooldown
const hasNearby = spatialQueue.some((item) => item.cluster.id === 'c-nearby-38km');
if (hasNearby) {
  throw new Error('Spatial proximity suppression failed: c-nearby-38km should be suppressed');
}

// Far cluster must be admitted
const hasFar = spatialQueue.some((item) => item.cluster.id === 'c-far-1000km');
if (!hasFar) {
  throw new Error('Distant cluster should be accepted in spatial queue');
}

console.log('3. Spatial proximity cooldown (150 km threshold): OK');

// ----------------------------------------------------
// TEST 4: Emergency Interrupt Threshold Validation
// ----------------------------------------------------
const interruptDirector = new EventDirector({
  interruptMinScore: 0.70,
  interruptScoreRatio: 1.5
});

const moderateStorm = makeCluster('c-mod', 0, 0, 0.40, now);
interruptDirector.updateClusters([moderateStorm], now);
interruptDirector.getNextTarget(now); // currentPresentation is c-mod (0.40)

// Candidate 1: Minor candidate (0.45) -> Ratio 1.125 < 1.5 -> REJECT
const candidateMinor = makeCluster('c-minor', 10, 10, 0.45, now);
if (interruptDirector.checkInterrupt(candidateMinor)) {
  throw new Error('Interrupt should be rejected for ratio < 1.5');
}

// Candidate 2: High ratio (0.65 vs 0.40 = 1.625) but score < 0.70 -> REJECT
const candidateMid = makeCluster('c-mid', 20, 20, 0.65, now);
if (interruptDirector.checkInterrupt(candidateMid)) {
  throw new Error('Interrupt should be rejected for score < 0.70');
}

// Candidate 3: Severe outbreak (0.85 vs 0.40 = 2.125 >= 1.5, score >= 0.70) -> ACCEPT
const candidateSevere = makeCluster('c-severe', 30, 30, 0.85, now);
if (!interruptDirector.checkInterrupt(candidateSevere)) {
  throw new Error('Interrupt should be approved for severe outbreak (score: 0.85 vs 0.40)');
}

// Candidate same as current -> REJECT
if (interruptDirector.checkInterrupt(moderateStorm)) {
  throw new Error('Interrupt should be rejected when candidate is current storm');
}

console.log('4. Emergency interrupt threshold validation: OK');

// ----------------------------------------------------
// TEST 5: Empty Queue & Stale Storms Graceful Handling
// ----------------------------------------------------
const emptyDirector = new EventDirector({ queueStaleTimeoutMs: 60000 });

// Empty queue gives null
if (emptyDirector.getNextTarget(now) !== null) {
  throw new Error('Expected null target for empty queue');
}

// Candidate older than 60s stale timeout
const staleStorm = makeCluster('c-stale', 0, 0, 0.90, now - 70000);
emptyDirector.updateClusters([staleStorm], now);

if (emptyDirector.getQueue().length !== 0) {
  throw new Error('Stale storm was not filtered out of the queue');
}
if (emptyDirector.getNextTarget(now) !== null) {
  throw new Error('Expected null target when all candidates are stale');
}

console.log('5. Empty queue & stale storms graceful handling: OK');

// ----------------------------------------------------
// TEST 6: Rare Region Discovery Interleaving (Slot % 3 === 0)
// ----------------------------------------------------
const discoveryDirector = new EventDirector({ maxQueueSize: 8 });

// Cluster in North America (active storm)
const usStorm = makeCluster('c-us', 35, -95, 0.70, now);
// Cluster in Europe (rare continent, lower natural activity score)
const euStorm = makeCluster('c-eu', 48, 10, 0.40, now);

// Slot 0 (startup, presentationCount = 0): US storm should win naturally by activity score
discoveryDirector.setPresentationCount(0);
discoveryDirector.updateClusters([usStorm, euStorm], now);
let topTarget = discoveryDirector.getNextTarget(now);
if (!topTarget || topTarget.id !== 'c-us') {
  throw new Error(`Expected c-us on slot 0, got ${topTarget?.id}`);
}

// Now presentationCount is 1. Simulate advancing to Slot 3 (Discovery Slot, presentationCount = 3)
discoveryDirector.clear();
discoveryDirector.setPresentationCount(3);
if (!discoveryDirector.isDiscoverySlotActive()) {
  throw new Error('Expected isDiscoverySlotActive() to be true when presentationCount is 3');
}

// Update clusters again on Discovery Slot: Europe should receive +2.50 discovery bonus and surpass US storm
discoveryDirector.updateClusters([usStorm, euStorm], now);
topTarget = discoveryDirector.getNextTarget(now);
if (!topTarget || topTarget.id !== 'c-eu') {
  throw new Error(`Expected c-eu to win during Discovery Slot via +2.50 bonus, got ${topTarget?.id}`);
}
console.log('6. Rare Region Discovery Interleaving (+2.50 bonus on slot % 3 === 0): OK');

console.log('--- ALL EVENT DIRECTOR UNIT TESTS FINISHED: OK ---');
