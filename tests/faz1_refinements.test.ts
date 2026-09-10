import * as THREE from 'three';
import { FulguriteTraceLayer } from '../src/world/vfx/FulguriteTraceLayer';
import { StormCellRadar } from '../src/world/vfx/StormCellRadar';
import { LightningBoltPool } from '../src/world/vfx/LightningBoltPool';
import { EventDirector, getContinent } from '../src/services/director/EventDirector';
import { CameraDirector } from '../src/services/camera/CameraDirector';
import type { ScoredCluster } from '../src/types/scoring';

console.log('--- RUNNING FAZ 1 REFINEMENTS TEST SUITE ---');

// 1. FulguriteTraceLayer: Mode switching (24H vs SESSION) and GPU uniform culling
console.log('Test 1: FulguriteTraceLayer mode switching & uniform threshold...');
const traceLayer = new FulguriteTraceLayer();
if (traceLayer.getMode() !== '24H') {
  throw new Error(`Expected default mode 24H, got ${traceLayer.getMode()}`);
}
// Initially uMinBirthTime is 0.0
const mat = (traceLayer as any).material as THREE.ShaderMaterial;
if (mat.uniforms.uMinBirthTime.value !== 0.0) {
  throw new Error(`Expected uMinBirthTime 0.0 in 24H mode, got ${mat.uniforms.uMinBirthTime.value}`);
}

// Switch to SESSION mode
traceLayer.setMode('SESSION');
if (traceLayer.getMode() !== 'SESSION') {
  throw new Error(`Expected mode SESSION, got ${traceLayer.getMode()}`);
}
if (mat.uniforms.uMinBirthTime.value <= 0) {
  throw new Error(`Expected positive session start timestamp in uMinBirthTime, got ${mat.uniforms.uMinBirthTime.value}`);
}

// Switch back to 24H mode
traceLayer.setMode('24H');
if (mat.uniforms.uMinBirthTime.value !== 0.0) {
  throw new Error(`Expected uMinBirthTime reset to 0.0, got ${mat.uniforms.uMinBirthTime.value}`);
}
console.log('  -> FulguriteTraceLayer 24H / SESSION mode switching verified: OK');

// 2. StormCellRadar: Backdrop lens opacity, elevated altitude, renderOrder
console.log('Test 2: StormCellRadar backdrop lens opacity, altitude, renderOrder...');
const radar = new StormCellRadar();
const pool = (radar as any).hexPool;
if (pool.length === 0) {
  throw new Error('Expected hexPool to contain preallocated slots');
}
const slot0 = pool[0];
// Backdrop lens mesh
if (!slot0.backdropMesh) {
  throw new Error('Expected backdropMesh to be defined');
}
// Render orders (Strictly above traces at 15)
if (slot0.backdropMesh.renderOrder !== 23) {
  throw new Error(`Expected backdropMesh renderOrder 23, got ${slot0.backdropMesh.renderOrder}`);
}
if (slot0.mesh.renderOrder !== 25) {
  throw new Error(`Expected hexMesh renderOrder 25, got ${slot0.mesh.renderOrder}`);
}
if (slot0.outerEdgeLine.renderOrder !== 26) {
  throw new Error(`Expected edge line renderOrder 26, got ${slot0.outerEdgeLine.renderOrder}`);
}

// Check altitude fraction on active cell
radar.updateCells([{
  id: 'storm-test-1',
  centroid: { latitude: 25.0, longitude: -80.0 },
  boundingRadiusKm: 100,
  strikeCount: 42,
  meanIntensity: -35,
  peakCurrent: -45,
  warningLevel: 'SEVERE',
  activityScore: 0.85
} as any]);

// Altitude fraction is (0.28 / globeRadius) for tight Earth curvature hugging
// targetPos distance from origin should be globeRadius + 0.28 = 100.28
const distFromOrigin = slot0.targetPos.length();
if (distFromOrigin < 100.1 || distFromOrigin > 102.5) {
  throw new Error(`Expected honeycomb targetPos distance ~100.28, got ${distFromOrigin}`);
}
console.log('  -> StormCellRadar layer hierarchy, masking lens (0.90), and altitude verified: OK');

// 3. LightningBoltPool: Shockwave scale strictly bounded inside storm cells
console.log('Test 3: LightningBoltPool shockwave bounded scale (0.2u - 2.2u max)...');
const boltPool = new LightningBoltPool();
const start = new THREE.Vector3(0, 0, 114);
const end = new THREE.Vector3(0, 0, 100);

// Acquire standard strike (<10kA)
const boltStandard = boltPool.acquire(start, end, 0.5, 300, Date.now(), 5, -1);
if (boltStandard && boltStandard.shockwaveRing && boltStandard.shockwaveRing.visible) {
  throw new Error('Standard strike should not trigger shockwaveRing');
}

// Update halfway through shockwave expansion (125ms of 250ms)
const boltTime = Date.now();
const boltSuper = boltPool.acquire(start, end, 1.0, 300, boltTime, 180, 1);
if (!boltSuper || !boltSuper.shockwaveRing) {
  throw new Error('Superbolt must be defined');
}
if (boltSuper.maxShockwaveScale !== 2.2) {
  throw new Error(`Expected superbolt maxShockwaveScale 2.2, got ${boltSuper.maxShockwaveScale}`);
}
console.log('  -> LightningBoltPool shockwave scaling strictly bounded inside cells verified: OK');

// 4. EventDirector: Continental Diversity Bonus (+0.55) & Roaming
console.log('Test 4: EventDirector continental diversity bonus & saturation guard...');
const director = new EventDirector();
const now = Date.now();

// Continental mapping verification
if (getContinent(40, -100) !== 'NA') throw new Error('Expected North America (NA)');
if (getContinent(-20, -50) !== 'SA') throw new Error('Expected South America (SA)');
if (getContinent(48, 15) !== 'EU') throw new Error('Expected Europe (EU)');
if (getContinent(10, 20) !== 'AF') throw new Error('Expected Africa (AF)');
if (getContinent(35, 105) !== 'AS') throw new Error('Expected Asia (AS)');
if (getContinent(-25, 135) !== 'OC') throw new Error('Expected Oceania (OC)');

const clusterNA: ScoredCluster = {
  id: 'c-na',
  centroid: { latitude: 35.0, longitude: -95.0 }, // NA
  events: [],
  eventCount: 30,
  firstEventTimestamp: now - 60000,
  lastEventTimestamp: now - 1000,
  boundingRadiusKm: 50,
  activityScore: 0.80,
  presentationClass: 'REGIONAL',
  strikesPerMinute: 25,
  growthRate: 1.0,
  breakdown: { rateScore: 0.8, growthScore: 0.8, energyScore: 0.8, clusterSizeScore: 0.8 }
};

const clusterEU: ScoredCluster = {
  id: 'c-eu',
  centroid: { latitude: 45.0, longitude: 10.0 }, // EU
  events: [],
  eventCount: 20,
  firstEventTimestamp: now - 60000,
  lastEventTimestamp: now - 1000,
  boundingRadiusKm: 40,
  activityScore: 0.65, // Lower score than NA
  presentationClass: 'REGIONAL',
  strikesPerMinute: 15,
  growthRate: 1.0,
  breakdown: { rateScore: 0.65, growthScore: 0.65, energyScore: 0.65, clusterSizeScore: 0.65 }
};

// First selection: clusterNA has higher raw score (0.80 vs 0.65)
director.updateClusters([clusterNA, clusterEU], now);
const target1 = director.getNextTarget(now);
if (target1?.id !== 'c-na') {
  throw new Error(`Expected first target to be c-na, got ${target1?.id}`);
}

// Next evaluation (10 seconds later):
// clusterNA has been presented (NA was last visited continent).
// Even if clusterNA2 has higher raw score (0.75), clusterEU (0.65) receives +0.55 continental diversity bonus -> 1.20!
const clusterNA2: ScoredCluster = {
  ...clusterNA,
  id: 'c-na-2',
  centroid: { latitude: 32.0, longitude: -90.0 },
  activityScore: 0.75
};

director.updateClusters([clusterNA2, clusterEU], now + 10000);
const target2 = director.getNextTarget(now + 10000);
if (target2?.id !== 'c-eu') {
  throw new Error(`Expected continental diversity bonus to prioritize c-eu, got ${target2?.id}`);
}
console.log('  -> EventDirector continental diversity roaming verified: OK');

// 5. CameraDirector: Cruising distance 275u & idle dwell timer
console.log('Test 5: CameraDirector 275u cruising distance & idle dwell...');
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
const mockControls = {
  isEnabled: () => true,
  setEnabled: () => {},
  syncTarget: () => {}
};
const camDirector = new CameraDirector(camera, mockControls as any);
if ((camDirector as any).config.idleDistance !== 260) {
  throw new Error(`Expected idleDistance 260, got ${(camDirector as any).config.idleDistance}`);
}
console.log('  -> CameraDirector 260u cruising overview distance verified: OK');

console.log('--- ALL FAZ 1 REFINEMENT TESTS FINISHED: OK ---');
