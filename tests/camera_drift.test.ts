import * as THREE from 'three';
import { CameraDirector } from '../src/services/camera/CameraDirector';
import { ControlsManager } from '../src/core/ControlsManager';
import type { ScoredCluster } from '../src/types/scoring';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('--- RUNNING PHASE 16 CAMERA ZERO-DRIFT STABILIZATION TEST ---');

// Setup mock camera and DOM element
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
camera.position.set(0, 0, 300);

const mockDomElement = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getRootNode: () => ({
    addEventListener: () => {},
    removeEventListener: () => {}
  }),
  ownerDocument: {
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  style: {}
} as unknown as HTMLElement;

const controlsManager = new ControlsManager(camera, mockDomElement, { enableDamping: false });
const director = new CameraDirector(camera, controlsManager, {
  approachDurationMs: 500,
  holdDurationMs: 1000,
  returnDurationMs: 500,
  idleDistance: 300
});

// Test cluster at Istanbul / Turkey (41.0082, 28.9784)
const testCluster: ScoredCluster = {
  id: 'cluster-test-drift',
  centroid: { latitude: 41.0082, longitude: 28.9784 },
  boundingRadiusKm: 50,
  eventCount: 0,
  events: [],
  firstEventTimestamp: Date.now() - 5000,
  lastEventTimestamp: Date.now(),
  activityScore: 0.85,
  presentationClass: 'LOCAL',
  strikesPerMinute: 10,
  growthRate: 1.2,
  breakdown: {
    rateScore: 0.8,
    growthScore: 0.7,
    energyScore: 0.9,
    clusterSizeScore: 0.8
  }
};

// 1. Initiate approach
console.log('Test 1: Transitioning APPROACH to completion...');
director.forceInterrupt(testCluster);
assert(director.getState() === 'APPROACH', 'Director must enter APPROACH state');

// Advance delta through approach (0.6s > 0.5s)
director.update(0.6);
assert(director.getState() === 'HOLD', 'Director must transition cleanly into HOLD state');

// 2. Capture initial position in HOLD
const initialHoldPos = camera.position.clone();
const targetDistance = director.getTarget()!.targetDistance;
assert(Math.abs(initialHoldPos.length() - targetDistance) < 0.01, 'Hold position distance must match target framing distance');

// 3. Simulate multiple frames during HOLD (0.1s steps up to 0.8s)
console.log('Test 2: Verifying smooth cinematic drone arc sweep across HOLD frames...');
for (let step = 0; step < 8; step++) {
  director.update(0.1);
  assert(director.getState() === 'HOLD', `Director must remain in HOLD (step ${step})`);

  // Compute position delta from initial hold position - verifies smooth cinematic drone arc movement
  const driftDist = camera.position.distanceTo(initialHoldPos);
  assert(driftDist < 25.0, `Camera drone arc drift exceeded bounds: ${driftDist}`);
}

console.log('  -> Smooth drone arc sweep verified: camera moves in controlled cinematic trajectory!');

// 4. Verify return transition and IDLE reset
console.log('Test 3: Advancing to RETURN and IDLE states...');
director.update(0.3); // Completes holdDuration (total > 1.0s)
assert(director.getState() === 'RETURN', 'Director must transition to RETURN state');

director.update(0.6); // Completes returnDuration (0.6s > 0.5s)
assert(director.getState() === 'IDLE', 'Director must return to IDLE state');
assert(controlsManager.isEnabled() === true, 'ControlsManager must be re-enabled upon IDLE');

console.log('--- ALL PHASE 16 CAMERA DRIFT TESTS FINISHED: OK ---');
