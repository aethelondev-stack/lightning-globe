import { ClusterEngine } from '../src/services/clustering/ClusterEngine';
import { calculateSphericalCentroid, haversineDistanceKm } from '../src/utils/coordinates';
import type { LightningEvent } from '../src/types/lightning';

console.log('--- RUNNING CLUSTERING ENGINE UNIT TESTS ---');

const baseTime = Date.now();

function makeEvent(id: string, lat: number, lon: number, offsetMs: number = 0): LightningEvent {
  return {
    id,
    timestamp: baseTime + offsetMs,
    latitude: lat,
    longitude: lon,
    peakCurrent: -45,
    type: 'CG',
    source: 'synthetic'
  };
}

// ----------------------------------------------------
// TEST 1: calculateSphericalCentroid accuracy & antimeridian behavior
// ----------------------------------------------------
const coordsNormal = [
  { latitude: 40.0, longitude: 28.0 },
  { latitude: 42.0, longitude: 30.0 }
];
const centroidNormal = calculateSphericalCentroid(coordsNormal);
if (Math.abs(centroidNormal.latitude - 41.0) > 0.1 || Math.abs(centroidNormal.longitude - 29.0) > 0.1) {
  throw new Error(`Spherical centroid normal calculation failed! Got: ${JSON.stringify(centroidNormal)}`);
}

// Antimeridian test: +179° and -179° (which is 181°) -> Center should be 180° / -180°, NOT 0°!
const coordsAntimeridian = [
  { latitude: 10.0, longitude: 179.0 },
  { latitude: 10.0, longitude: -179.0 }
];
const centroidAnti = calculateSphericalCentroid(coordsAntimeridian);
if (Math.abs(centroidAnti.latitude - 10.0) > 0.1) {
  throw new Error(`Antimeridian centroid latitude wrong! Got: ${centroidAnti.latitude}`);
}
if (Math.abs(Math.abs(centroidAnti.longitude) - 180.0) > 0.1) {
  throw new Error(`Antimeridian centroid longitude wrong! Expected near +-180, got: ${centroidAnti.longitude}`);
}
console.log('1. calculateSphericalCentroid (Normal & Antimeridian): OK');

// ----------------------------------------------------
// TEST 2: Distinct storm separation (Istanbul vs Tokyo)
// ----------------------------------------------------
const engine = new ClusterEngine({
  spatialRadiusKm: 150,
  temporalWindowMs: 600000, // 10 min
  minClusterEvents: 3,
  minBoundingRadiusKm: 25
});

const istanbulEvents: LightningEvent[] = [
  makeEvent('ist-1', 41.0082, 28.9784, 1000),
  makeEvent('ist-2', 41.0200, 28.9800, 2000),
  makeEvent('ist-3', 41.0500, 29.0100, 3000),
  makeEvent('ist-4', 40.9900, 28.9500, 4000),
  makeEvent('ist-5', 41.0300, 29.0200, 5000)
];

const tokyoEvents: LightningEvent[] = [
  makeEvent('tky-1', 35.6762, 139.6503, 1000),
  makeEvent('tky-2', 35.6800, 139.6600, 2000),
  makeEvent('tky-3', 35.7000, 139.7000, 3000),
  makeEvent('tky-4', 35.6500, 139.6400, 4000),
  makeEvent('tky-5', 35.6900, 139.6700, 5000)
];

const distinctClusters = engine.clusterEvents([...istanbulEvents, ...tokyoEvents], baseTime + 10000);

if (distinctClusters.length !== 2) {
  throw new Error(`Expected exactly 2 clusters, got ${distinctClusters.length}`);
}

const cluster1 = distinctClusters.find(c => Math.abs(c.centroid.latitude - 41.0) < 1.0);
const cluster2 = distinctClusters.find(c => Math.abs(c.centroid.latitude - 35.7) < 1.0);

if (!cluster1 || !cluster2) {
  throw new Error('Could not identify Istanbul and Tokyo clusters!');
}

if (cluster1.eventCount !== 5 || cluster2.eventCount !== 5) {
  throw new Error(`Cluster event counts mismatch: ${cluster1.eventCount}, ${cluster2.eventCount}`);
}

console.log('2. Distinct storm separation (Istanbul vs Tokyo): OK');

// ----------------------------------------------------
// TEST 3: Noise rejection (isolated events < 3)
// ----------------------------------------------------
const noiseEvents: LightningEvent[] = [
  makeEvent('noise-1', 48.8566, 2.3522, 1000), // Paris strike 1
  makeEvent('noise-2', 48.8600, 2.3600, 2000)  // Paris strike 2 (only 2 events)
];

const noiseResult = engine.clusterEvents(noiseEvents, baseTime + 10000);
if (noiseResult.length !== 0) {
  throw new Error(`Expected 0 clusters for isolated noise (<3 events), got ${noiseResult.length}`);
}
console.log('3. Noise rejection (< 3 events filtered out): OK');

// ----------------------------------------------------
// TEST 4: Antimeridian cluster continuity (+-180 degrees)
// ----------------------------------------------------
// Two points on east of 180 (+179.8) and two points on west of 180 (-179.8)
// Distance across 180 is approx 44 km, well within 150 km threshold
const antimeridianEvents: LightningEvent[] = [
  makeEvent('anti-1', 5.0, 179.8, 1000),
  makeEvent('anti-2', 5.1, 179.9, 2000),
  makeEvent('anti-3', 5.0, -179.8, 3000),
  makeEvent('anti-4', 5.1, -179.9, 4000)
];

const antiClusters = engine.clusterEvents(antimeridianEvents, baseTime + 10000);
if (antiClusters.length !== 1) {
  throw new Error(`Expected exactly 1 merged cluster across antimeridian, got ${antiClusters.length}`);
}
const antiCluster = antiClusters[0];
if (antiCluster.eventCount !== 4) {
  throw new Error(`Expected 4 events in antimeridian cluster, got ${antiCluster.eventCount}`);
}
if (Math.abs(Math.abs(antiCluster.centroid.longitude) - 180.0) > 1.0) {
  throw new Error(`Antimeridian cluster centroid longitude should be near 180/-180, got ${antiCluster.centroid.longitude}`);
}
console.log('4. Antimeridian cluster continuity (+-180 deg): OK');

// ----------------------------------------------------
// TEST 5: Bounding radius clamping (min 25 km) & ID generation
// ----------------------------------------------------
const tightEvents: LightningEvent[] = [
  makeEvent('tight-1', 0.0, 0.0, 1000),
  makeEvent('tight-2', 0.001, 0.001, 2000),
  makeEvent('tight-3', 0.002, 0.002, 3000)
];

const tightClusters = engine.clusterEvents(tightEvents, baseTime + 10000);
if (tightClusters.length !== 1) {
  throw new Error(`Expected 1 cluster for tight events, got ${tightClusters.length}`);
}
if (tightClusters[0].boundingRadiusKm !== 25) {
  throw new Error(`Expected bounding radius clamped to 25 km, got ${tightClusters[0].boundingRadiusKm}`);
}
if (tightClusters[0].id !== 'cluster_tight-1') {
  throw new Error(`Expected deterministic cluster id 'cluster_tight-1', got '${tightClusters[0].id}'`);
}
console.log('5. Bounding radius clamp (min 25km) & Deterministic ID: OK');

console.log('--- ALL CLUSTER ENGINE UNIT TESTS FINISHED: OK ---');
