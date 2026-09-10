import * as THREE from 'three';
import { EventDirector } from '../src/services/director/EventDirector';
import { CameraDirector } from '../src/services/camera/CameraDirector';
import type { ControlsManager } from '../src/core/ControlsManager';
import type { ScoredCluster, PresentationClass } from '../src/types/scoring';

console.log('--- RUNNING UI HUD, CONTROLS & ACCESSIBILITY UNIT TESTS ---');

class MockControlsManager {
  private enabled = true;
  public setEnabled(val: boolean) { this.enabled = val; }
  public isEnabled(): boolean { return this.enabled; }
  public onInteraction(_cb: () => void) { return () => {}; }
}

function makeTestCluster(
  id: string,
  presentationClass: PresentationClass,
  score: number,
  lat: number,
  lon: number,
  timestamp: number
): ScoredCluster {
  return {
    id,
    centroid: { latitude: lat, longitude: lon },
    boundingRadiusKm: 50,
    eventCount: 30,
    events: [],
    firstEventTimestamp: timestamp - 60000,
    lastEventTimestamp: timestamp,
    activityScore: score,
    presentationClass,
    strikesPerMinute: 25,
    growthRate: 1.2,
    breakdown: {
      rateScore: score,
      growthScore: score,
      energyScore: score,
      clusterSizeScore: score
    }
  };
}

const now = 5000000;

// ----------------------------------------------------
// TEST 1: Class Filtering Hierarchy in EventDirector
// ----------------------------------------------------
const director = new EventDirector();

const clusterMacro = makeTestCluster('c-macro', 'MACRO', 0.35, 10, 20, now);
const clusterLocal = makeTestCluster('c-local', 'LOCAL', 0.55, -10, -20, now);
const clusterReg = makeTestCluster('c-reg', 'REGIONAL', 0.75, 30, 40, now);
const clusterCont = makeTestCluster('c-cont', 'CONTINENTAL', 0.95, -30, -40, now);

const allClusters = [clusterMacro, clusterLocal, clusterReg, clusterCont];

// 1. ALL Filter: Should admit all 4 clusters
director.setClassFilter('ALL');
director.updateClusters(allClusters, now);
if (director.getQueue().length !== 4) {
  throw new Error(`Expected 4 clusters for ALL filter, got ${director.getQueue().length}`);
}

// 2. LOCAL Filter: Should exclude MACRO (3 remaining)
director.setClassFilter('LOCAL');
director.updateClusters(allClusters, now);
const queueLocal = director.getQueue();
if (queueLocal.length !== 3 || queueLocal.some((i) => i.cluster.presentationClass === 'MACRO')) {
  throw new Error(`LOCAL filter failed: got ${queueLocal.length} items, MACRO not excluded`);
}

// 3. REGIONAL Filter: Should exclude MACRO and LOCAL (2 remaining: REGIONAL, CONTINENTAL)
director.setClassFilter('REGIONAL');
director.updateClusters(allClusters, now);
const queueReg = director.getQueue();
if (queueReg.length !== 2) {
  throw new Error(`Expected 2 clusters for REGIONAL filter, got ${queueReg.length}`);
}
for (const item of queueReg) {
  if (item.cluster.presentationClass !== 'REGIONAL' && item.cluster.presentationClass !== 'CONTINENTAL') {
    throw new Error(`Unexpected class in REGIONAL filter: ${item.cluster.presentationClass}`);
  }
}

// 4. CONTINENTAL Filter: Should only admit CONTINENTAL (1 remaining)
director.setClassFilter('CONTINENTAL');
director.updateClusters(allClusters, now);
const queueCont = director.getQueue();
if (queueCont.length !== 1 || queueCont[0].cluster.presentationClass !== 'CONTINENTAL') {
  throw new Error(`CONTINENTAL filter failed: expected 1 CONTINENTAL, got ${queueCont.length}`);
}

console.log('1. Class filtering hierarchy (ALL -> LOCAL+ -> REGIONAL+ -> CONTINENTAL): OK');

// ----------------------------------------------------
// TEST 2: Manual Mode Automation Suppression in CameraDirector
// ----------------------------------------------------
const mockCamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
mockCamera.position.set(0, 0, 350);
const mockControls = new MockControlsManager() as unknown as ControlsManager;
const camDirector = new CameraDirector(mockCamera, mockControls);

camDirector.setCandidateTarget(clusterCont);

// Engage manual mode
camDirector.setManualMode(true);
if (!camDirector.isManualMode()) {
  throw new Error('isManualMode should return true');
}

// Update loop: Should remain in IDLE because manual mode suppresses auto-approach
camDirector.update(0.016);
if (camDirector.getState() !== 'IDLE') {
  throw new Error(`Manual mode failed to suppress auto-approach: state is ${camDirector.getState()}`);
}

// Disable manual mode: Should now lock and start APPROACH
camDirector.setManualMode(false);
camDirector.update(0.016);
if (camDirector.getState() !== 'APPROACH') {
  throw new Error(`Auto approach failed to resume after disabling manual mode: state is ${camDirector.getState()}`);
}

console.log('2. Manual mode automation suppression: OK');

// ----------------------------------------------------
// TEST 3: Direct User Selection (flyToCluster)
// ----------------------------------------------------
const directCam = new CameraDirector(mockCamera, mockControls);
directCam.setManualMode(true); // Even in manual mode!

if (directCam.getState() !== 'IDLE') {
  throw new Error('Initial state should be IDLE');
}

// Direct selection should bypass manual mode and immediately initiate approach
directCam.flyToCluster(clusterReg);

if (directCam.getState() !== 'APPROACH') {
  throw new Error(`flyToCluster failed to initiate APPROACH, state is ${directCam.getState()}`);
}
if (directCam.getTarget()?.clusterId !== 'c-reg') {
  throw new Error(`flyToCluster target mismatch: expected c-reg, got ${directCam.getTarget()?.clusterId}`);
}

console.log('3. Direct user selection (flyToCluster) override: OK');

// ----------------------------------------------------
// TEST 4: Reduced Motion Kinematic Scaling
// ----------------------------------------------------
const motionCam = new CameraDirector(mockCamera, mockControls, {
  approachDurationMs: 3000,
  holdDurationMs: 6000,
  returnDurationMs: 2500
});

const baseDurations = motionCam.getKinematicDurations();

// Enable reduced motion
motionCam.setReducedMotion(true);
if (!motionCam.isReducedMotion()) {
  throw new Error('isReducedMotion should return true');
}

const scaledDurations = motionCam.getKinematicDurations();
const expectedApproach = Math.round(3000 * 1.8);
const expectedHold = Math.round(6000 * 1.8);
const expectedReturn = Math.round(2500 * 1.8);

if (scaledDurations.approach !== expectedApproach) {
  throw new Error(`Reduced motion approach mismatch: expected ${expectedApproach}, got ${scaledDurations.approach}`);
}
if (scaledDurations.hold !== expectedHold) {
  throw new Error(`Reduced motion hold mismatch: expected ${expectedHold}, got ${scaledDurations.hold}`);
}
if (scaledDurations.return !== expectedReturn) {
  throw new Error(`Reduced motion return mismatch: expected ${expectedReturn}, got ${scaledDurations.return}`);
}

// Disable reduced motion: returns to base
motionCam.setReducedMotion(false);
const restoredDurations = motionCam.getKinematicDurations();
if (restoredDurations.approach !== baseDurations.approach) {
  throw new Error('Restored approach duration mismatch');
}

console.log('4. Reduced motion kinematic scaling (1.8x soft multiplier): OK');

console.log('--- ALL UI HUD, CONTROLS & ACCESSIBILITY UNIT TESTS FINISHED: OK ---');
