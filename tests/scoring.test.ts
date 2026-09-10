import { ActivityScorer } from '../src/services/scoring/ActivityScorer';
import type { LightningCluster } from '../src/types/cluster';
import type { LightningEvent } from '../src/types/lightning';

console.log('--- RUNNING ACTIVITY SCORER UNIT TESTS ---');

const baseTime = Date.now();

function createDummyEvent(id: string, timestamp: number, peakCurrent: number = -35): LightningEvent {
  return {
    id,
    timestamp,
    latitude: 0,
    longitude: 0,
    peakCurrent,
    type: 'CG',
    source: 'synthetic'
  };
}

function createDummyCluster(
  id: string,
  eventTimestamps: number[],
  boundingRadiusKm: number,
  peakCurrent: number = -35
): LightningCluster {
  const events = eventTimestamps.map((ts, idx) => createDummyEvent(`${id}-ev-${idx}`, ts, peakCurrent));
  const minTime = Math.min(...eventTimestamps);
  const maxTime = Math.max(...eventTimestamps);

  return {
    id,
    centroid: { latitude: 0, longitude: 0 },
    boundingRadiusKm,
    eventCount: events.length,
    events,
    firstEventTimestamp: minTime,
    lastEventTimestamp: maxTime
  };
}

const scorer = new ActivityScorer();

// ----------------------------------------------------
// TEST 1: High Frequency Storm vs Low Frequency Storm
// ----------------------------------------------------
// Intense storm: 40 events in last 2 minutes
const intenseTimestamps = Array.from({ length: 40 }, (_, i) => baseTime - 1000 * (i * 2));
const intenseCluster = createDummyCluster('intense-storm', intenseTimestamps, 45, -60);

// Mild storm: 4 events spread over 9 minutes
const mildTimestamps = [baseTime - 9 * 60000, baseTime - 6 * 60000, baseTime - 3 * 60000, baseTime];
const mildCluster = createDummyCluster('mild-storm', mildTimestamps, 45, -20);

const scoredIntense = scorer.scoreCluster(intenseCluster, baseTime);
const scoredMild = scorer.scoreCluster(mildCluster, baseTime);

if (scoredIntense.activityScore <= scoredMild.activityScore) {
  throw new Error(
    `Intense storm score (${scoredIntense.activityScore}) not higher than mild (${scoredMild.activityScore})`
  );
}
if (scoredIntense.breakdown.rateScore <= scoredMild.breakdown.rateScore) {
  throw new Error('Rate score for intense storm must exceed mild storm rate score');
}
console.log('1. Frequency superiority (Intense vs Mild): PASS');

// ----------------------------------------------------
// TEST 2: Explosive Growing Storm vs Decaying Storm
// ----------------------------------------------------
// Growing storm: 20 events total, 18 of them in last 90 seconds (recent)
const growingTimestamps = [
  baseTime - 8 * 60000,
  baseTime - 7 * 60000,
  ...Array.from({ length: 18 }, (_, i) => baseTime - 1000 * (i * 4))
];
const growingCluster = createDummyCluster('growing-storm', growingTimestamps, 50, -35);

// Decaying storm: 20 events total, 18 of them between 6-8 minutes ago, only 2 in last 2 mins
const decayingTimestamps = [
  baseTime - 10000,
  baseTime - 30000,
  ...Array.from({ length: 18 }, (_, i) => baseTime - 6 * 60000 - 1000 * (i * 5))
];
const decayingCluster = createDummyCluster('decaying-storm', decayingTimestamps, 50, -35);

const scoredGrowing = scorer.scoreCluster(growingCluster, baseTime);
const scoredDecaying = scorer.scoreCluster(decayingCluster, baseTime);

if (scoredGrowing.breakdown.growthScore <= scoredDecaying.breakdown.growthScore) {
  throw new Error(
    `Growing storm growthScore (${scoredGrowing.breakdown.growthScore}) not higher than decaying (${scoredDecaying.breakdown.growthScore})`
  );
}
if (scoredGrowing.activityScore <= scoredDecaying.activityScore) {
  throw new Error(
    `Growing storm activityScore (${scoredGrowing.activityScore}) must beat decaying (${scoredDecaying.activityScore})`
  );
}
console.log('2. Explosive growth bonus superiority: PASS');

// ----------------------------------------------------
// TEST 3: Mathematical Normalization & Clamp [0.0, 1.0]
// ----------------------------------------------------
// Super extreme storm: 200 events, 300 kA current, all within 30 seconds
const extremeTimestamps = Array.from({ length: 200 }, (_, i) => baseTime - i * 100);
const extremeCluster = createDummyCluster('extreme-storm', extremeTimestamps, 25, -300);
const scoredExtreme = scorer.scoreCluster(extremeCluster, baseTime);

if (scoredExtreme.activityScore > 1.0 || scoredExtreme.activityScore < 0.0) {
  throw new Error(`Score out of bounds! Got: ${scoredExtreme.activityScore}`);
}
if (scoredExtreme.activityScore !== 1.0) {
  throw new Error(`Extreme storm expected to saturate at 1.0, got ${scoredExtreme.activityScore}`);
}

// Minimal storm: 3 events, low current, spread out
const minimalTimestamps = [baseTime - 9 * 60000, baseTime - 5 * 60000, baseTime - 3 * 60000];
const minimalCluster = createDummyCluster('minimal-storm', minimalTimestamps, 25, -5);
const scoredMinimal = scorer.scoreCluster(minimalCluster, baseTime);

if (scoredMinimal.activityScore < 0.0 || scoredMinimal.activityScore > 1.0) {
  throw new Error(`Minimal score out of bounds! Got: ${scoredMinimal.activityScore}`);
}
console.log('3. Mathematical normalization & [0.0, 1.0] clamp: PASS');

// ----------------------------------------------------
// TEST 4: Presentation Class Thresholds (MACRO, LOCAL, REGIONAL, CONTINENTAL)
// ----------------------------------------------------
const dummyTimestamps = [baseTime - 2000, baseTime - 1000, baseTime];

const macroCluster = scorer.scoreCluster(createDummyCluster('c-macro', dummyTimestamps, 25), baseTime);
const localCluster = scorer.scoreCluster(createDummyCluster('c-local', dummyTimestamps, 60), baseTime);
const regionalCluster = scorer.scoreCluster(createDummyCluster('c-reg', dummyTimestamps, 140), baseTime);
const continentalCluster = scorer.scoreCluster(createDummyCluster('c-cont', dummyTimestamps, 350), baseTime);

if (macroCluster.presentationClass !== 'MACRO') {
  throw new Error(`Expected MACRO for 25km radius, got: ${macroCluster.presentationClass}`);
}
if (localCluster.presentationClass !== 'LOCAL') {
  throw new Error(`Expected LOCAL for 60km radius, got: ${localCluster.presentationClass}`);
}
if (regionalCluster.presentationClass !== 'REGIONAL') {
  throw new Error(`Expected REGIONAL for 140km radius, got: ${regionalCluster.presentationClass}`);
}
if (continentalCluster.presentationClass !== 'CONTINENTAL') {
  throw new Error(`Expected CONTINENTAL for 350km radius, got: ${continentalCluster.presentationClass}`);
}
console.log('4. Presentation class radius thresholds: PASS');

// ----------------------------------------------------
// TEST 5: rankClusters deterministic order & ranking
// ----------------------------------------------------
const ranked = scorer.rankClusters(
  [minimalCluster, intenseCluster, decayingCluster, growingCluster],
  baseTime
);

if (ranked[0].id !== 'intense-storm') {
  throw new Error(`Expected top ranked storm to be intense-storm, got: ${ranked[0].id}`);
}
if (ranked[1].id !== 'growing-storm') {
  throw new Error(`Expected second ranked storm to be growing-storm, got: ${ranked[1].id}`);
}
if (ranked[ranked.length - 1].id !== 'minimal-storm') {
  throw new Error(`Expected lowest ranked storm to be minimal-storm, got: ${ranked[ranked.length - 1].id}`);
}
console.log('5. Deterministic cluster ranking (rankClusters): PASS');

console.log('Activity scorer unit tests completed.');
