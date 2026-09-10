import { LiveEventStore } from '../src/services/store/LiveEventStore';
import { ClusterEngine } from '../src/services/clustering/ClusterEngine';
import { ActivityScorer } from '../src/services/scoring/ActivityScorer';
import { EventDirector } from '../src/services/director/EventDirector';
import { ScenarioManager } from '../src/services/scenarios/ScenarioManager';
import { LightningNormalizer, type RawLightningPacket } from '../src/services/normalizer/LightningNormalizer';

console.log('--- RUNNING DEMO SCENARIOS & STRESS TESTING UNIT TESTS ---');

const now = Date.now();

function createRaw(lat: number, lon: number, time: number = now, peakCurrent: number = 25.0): RawLightningPacket {
  return {
    time,
    lat,
    lon,
    peak_current: peakCurrent
  };
}

// ----------------------------------------------------
// TEST 1: SINGLE_STRIKE (Noise Rejection: 0 clusters formed)
// ----------------------------------------------------
const store1 = new LiveEventStore();
const clusterEngine = new ClusterEngine();

const singleStrikes: RawLightningPacket[] = [
  createRaw(38.5, 15.2, now),
  createRaw(-25.3, -54.8, now + 100),
  createRaw(14.2, 112.5, now + 200),
  createRaw(-35.1, 172.8, now + 300),
  createRaw(51.5, 0.1, now + 400)
];

for (const raw of singleStrikes) {
  const norm = LightningNormalizer.normalize(raw, 'mock');
  if (norm) store1.addEvent(norm);
}

const clusters1 = clusterEngine.clusterEvents(store1.getRecentEvents(600000));
if (clusters1.length !== 0) {
  throw new Error(`Expected 0 clusters for isolated single strikes, got ${clusters1.length}`);
}
console.log('1. SINGLE_STRIKE noise rejection (5 isolated strikes -> 0 clusters): OK');

// ----------------------------------------------------
// TEST 2: LOCAL_CLUSTER (Costa Rica localized cell -> LOCAL class)
// ----------------------------------------------------
const store2 = new LiveEventStore();
const scorer = new ActivityScorer();

for (let i = 0; i < 15; i++) {
  const angle = (i * 137.5 * Math.PI) / 180;
  const radius = (i % 5) * 0.08 + 0.15; // 0.15° to 0.47° (~16 to 52 km)
  const lat = 9.5 + Math.cos(angle) * radius;
  const lon = -84.0 + Math.sin(angle) * radius;
  const norm = LightningNormalizer.normalize(createRaw(lat, lon, now + i * 200), 'mock');
  if (norm) store2.addEvent(norm);
}

const clusters2 = clusterEngine.clusterEvents(store2.getRecentEvents(600000));
if (clusters2.length !== 1) {
  throw new Error(`Expected 1 cluster for local Costa Rica cell, got ${clusters2.length}`);
}

const scored2 = scorer.rankClusters(clusters2);
if (scored2[0].presentationClass !== 'LOCAL') {
  throw new Error(`Expected LOCAL presentation class, got ${scored2[0].presentationClass}`);
}
console.log('2. LOCAL_CLUSTER localized framing (15 strikes -> 1 LOCAL cluster): OK');

// ----------------------------------------------------
// TEST 3: INTENSE_STORM (Congo Basin surge -> Explosive growth score > 0.65)
// ----------------------------------------------------
const store3 = new LiveEventStore();

// Phase 1: 5 background strikes
for (let i = 0; i < 5; i++) {
  const norm = LightningNormalizer.normalize(createRaw(-1.5 + i * 0.02, 23.5 + i * 0.02, now - 15000 + i * 2000), 'mock');
  if (norm) store3.addEvent(norm);
}

// Phase 2: Sudden explosive surge of 40 rapid high-current strikes over 30 seconds
for (let i = 0; i < 40; i++) {
  const angle = (i * 137.5 * Math.PI) / 180;
  const radius = (i % 5) * 0.15 + 0.1; // 10 to 35 km
  const lat = -1.5 + Math.cos(angle) * radius;
  const lon = 23.5 + Math.sin(angle) * radius;
  // Timestamps spaced by 600ms to exceed 500ms deduplication threshold
  const time = now - 25000 + i * 600;
  const norm = LightningNormalizer.normalize(createRaw(lat, lon, time, 75.0), 'mock');
  if (norm) store3.addEvent(norm);
}

const clusters3 = clusterEngine.clusterEvents(store3.getRecentEvents(600000));
const scored3 = scorer.rankClusters(clusters3);

if (scored3.length === 0) {
  throw new Error('Expected at least 1 cluster for intense storm');
}
if (scored3[0].activityScore < 0.65) {
  throw new Error(`Expected activityScore >= 0.65 for intense storm, got ${scored3[0].activityScore}`);
}
if (scored3[0].growthRate < 1.1) {
  throw new Error(`Expected explosive growth rate > 1.1, got ${scored3[0].growthRate}`);
}
console.log('3. INTENSE_STORM explosive surge (activityScore > 0.65 verified): OK');

// ----------------------------------------------------
// TEST 4: COMPETING_STORMS (Dual planetary hubs in Amazon & SE Asia)
// ----------------------------------------------------
const store4 = new LiveEventStore();
const director = new EventDirector();

// Amazon: 12 strikes
for (let i = 0; i < 12; i++) {
  const norm = LightningNormalizer.normalize(createRaw(-3.2 + (i % 3) * 0.05, -60.5 + (i % 4) * 0.05, now + i * 100), 'mock');
  if (norm) store4.addEvent(norm);
}

// SE Asia: 14 strikes
for (let i = 0; i < 14; i++) {
  const norm = LightningNormalizer.normalize(createRaw(-0.8 + (i % 3) * 0.05, 114.2 + (i % 4) * 0.05, now + i * 100), 'mock');
  if (norm) store4.addEvent(norm);
}

const clusters4 = clusterEngine.clusterEvents(store4.getRecentEvents(600000));
if (clusters4.length !== 2) {
  throw new Error(`Expected 2 distinct clusters for Amazon and SE Asia, got ${clusters4.length}`);
}

const scored4 = scorer.rankClusters(clusters4);
director.updateClusters(scored4, now);

if (director.getQueue().length !== 2) {
  throw new Error(`Expected 2 queued storms in director, got ${director.getQueue().length}`);
}
console.log('4. COMPETING_STORMS dual planetary hubs (Amazon & SE Asia 2 queues): OK');

// ----------------------------------------------------
// TEST 5: DATELINE_STORM (Cross-antimeridian continuity at ±180°)
// ----------------------------------------------------
const store5 = new LiveEventStore();

// 12 strikes alternating across +179.8° and -179.8° (physical distance < 45km)
for (let i = 0; i < 12; i++) {
  const isEast = i % 2 === 0;
  const lon = isEast ? 179.80 : -179.80;
  const lat = -16.2 + (i % 3) * 0.04;
  const norm = LightningNormalizer.normalize(createRaw(lat, lon, now + i * 100), 'mock');
  if (norm) store5.addEvent(norm);
}

const clusters5 = clusterEngine.clusterEvents(store5.getRecentEvents(600000));
if (clusters5.length !== 1) {
  throw new Error(`Expected 1 merged cluster across antimeridian, got ${clusters5.length}`);
}

// Centroid longitude must be near 180° / -180°
const centroidLon = Math.abs(clusters5[0].centroid.longitude);
if (centroidLon < 178.0) {
  throw new Error(`Expected centroid near antimeridian, got ${clusters5[0].centroid.longitude}`);
}
console.log('5. DATELINE_STORM unbroken antimeridian cluster (±180° single cluster): OK');

// ----------------------------------------------------
// TEST 6: EXTREME_SURGE (High volume stress test: 500 events bounded)
// ----------------------------------------------------
const store6 = new LiveEventStore(5000);

for (let i = 0; i < 500; i++) {
  const lat = -10 + (i % 20);
  const lon = 20 + (i % 30);
  const norm = LightningNormalizer.normalize(createRaw(lat, lon, now + i * 10), 'mock');
  if (norm) store6.addEvent(norm);
}

if (store6.getEventCount() !== 500) {
  throw new Error(`Expected 500 stored events, got ${store6.getEventCount()}`);
}
const stats6 = store6.getStats();
if (stats6.totalReceived !== 500) {
  throw new Error(`Expected totalReceived 500, got ${stats6.totalReceived}`);
}
console.log('6. EXTREME_SURGE high-volume throughput (500 events zero drop): OK');

// ----------------------------------------------------
// TEST 7: ScenarioManager Teardown & Clean State Switching
// ----------------------------------------------------
const testStore = new LiveEventStore();
const testDirector = new EventDirector();
const manager = new ScenarioManager('COMPETING_STORMS');

// Fill store and director with dummy data
testStore.addEvent(LightningNormalizer.normalize(createRaw(0, 0), 'mock')!);
testDirector.updateClusters([scored2[0]], now);

if (testStore.getEventCount() === 0 || testDirector.getQueue().length === 0) {
  throw new Error('Setup failed: store or director empty before teardown');
}

// Register teardown hooks
manager.registerTeardownHook(() => {
  testStore.clear();
  testDirector.clear();
});

// Switch scenario -> triggers teardown hooks
manager.setScenario('LOCAL_CLUSTER');

if (testStore.getEventCount() !== 0) {
  throw new Error(`Store was not wiped during scenario switch: count is ${testStore.getEventCount()}`);
}
if (testDirector.getQueue().length !== 0) {
  throw new Error(`Director was not wiped during scenario switch: queue length is ${testDirector.getQueue().length}`);
}
if (manager.getActiveScenarioId() !== 'LOCAL_CLUSTER') {
  throw new Error(`Expected active scenario LOCAL_CLUSTER, got ${manager.getActiveScenarioId()}`);
}

console.log('7. ScenarioManager atomic teardown & clean switching: OK');

console.log('--- ALL DEMO SCENARIOS & STRESS TESTING UNIT TESTS FINISHED: OK ---');
