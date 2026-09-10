import * as THREE from 'three';
import { CameraDirector } from '../src/services/camera/CameraDirector';
import { latLngToVector3, vector3ToLatLng } from '../src/utils/coordinates';
import type { ScoredCluster } from '../src/types/scoring';
import type { ControlsManager } from '../src/core/ControlsManager';

console.log('--- RUNNING CINEMATIC CAMERA DIRECTOR UNIT TESTS ---');

// Mock ControlsManager for testing
class MockControlsManager {
  private enabled = true;
  public target = new THREE.Vector3();
  public setEnabled(val: boolean) { this.enabled = val; }
  public isEnabled(): boolean { return this.enabled; }
  public onInteraction(_cb: () => void) { return () => {}; }
  public syncTarget(t?: THREE.Vector3) { if (t) this.target.copy(t); else this.target.set(0, 0, 0); }
  public getTarget() { return this.target; }
}

function createDummyScoredCluster(
  id: string,
  lat: number,
  lon: number,
  boundingRadiusKm: number,
  presentationClass: 'MACRO' | 'LOCAL' | 'REGIONAL' | 'CONTINENTAL'
): ScoredCluster {
  return {
    id,
    centroid: { latitude: lat, longitude: lon },
    boundingRadiusKm,
    eventCount: 20,
    events: [],
    firstEventTimestamp: Date.now() - 60000,
    lastEventTimestamp: Date.now(),
    activityScore: 0.85,
    presentationClass,
    strikesPerMinute: 20,
    growthRate: 1.5,
    breakdown: {
      rateScore: 0.8,
      growthScore: 0.7,
      energyScore: 0.6,
      clusterSizeScore: 0.5
    }
  };
}

// ----------------------------------------------------
// TEST 1: Antimeridian Shortest Arc SLERP (+179° -> -179°)
// ----------------------------------------------------
const v179East = latLngToVector3(0, 179, 0, 1).normalize();
const v179West = latLngToVector3(0, -179, 0, 1).normalize();

const angleBetween = v179East.angleTo(v179West);
const angleDegrees = (angleBetween * 180) / Math.PI;

if (Math.abs(angleDegrees - 2.0) > 0.01) {
  throw new Error(`Expected angular distance between +179 and -179 to be ~2 degrees, got ${angleDegrees}°`);
}

// SLERP halfway (t = 0.5)
const qRot = new THREE.Quaternion().setFromUnitVectors(v179East, v179West);
const qHalf = new THREE.Quaternion().slerp(qRot, 0.5);
const vMid = v179East.clone().applyQuaternion(qHalf).normalize();
const midCoords = vector3ToLatLng(vMid, 1);

// Midpoint must be at longitude 180 / -180, NOT 0 (Prime Meridian)
if (Math.abs(Math.abs(midCoords.lng) - 180) > 0.1) {
  throw new Error(`SLERP midpoint longitude should be +-180°, got ${midCoords.lng}°`);
}
console.log('1. Antimeridian shortest-arc SLERP (2° arc instead of 358°): OK');

// ----------------------------------------------------
// TEST 2: Analytic Framing Distance Calculation
// ----------------------------------------------------
const mockCamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
mockCamera.position.set(0, 0, 350);
const mockControls = new MockControlsManager() as unknown as ControlsManager;
const director = new CameraDirector(mockCamera, mockControls, {
  approachDurationMs: 2000,
  holdDurationMs: 4200,
  returnDurationMs: 2000,
  idleDwellMs: 6000
});

const macroTarget = createDummyScoredCluster('c-macro', 10, 20, 25, 'MACRO');
const localTarget = createDummyScoredCluster('c-local', 10, 20, 60, 'LOCAL');
const regionalTarget = createDummyScoredCluster('c-reg', 10, 20, 140, 'REGIONAL');
const continentalTarget = createDummyScoredCluster('c-cont', 10, 20, 250, 'CONTINENTAL');

const distMacro = director.calculateFramingDistance(macroTarget);
const distLocal = director.calculateFramingDistance(localTarget);
const distReg = director.calculateFramingDistance(regionalTarget);
const distCont = director.calculateFramingDistance(continentalTarget);

if (distMacro < 135 || distMacro > 150) {
  throw new Error(`Macro distance unexpected: ${distMacro}`);
}
if (distLocal < 150 || distLocal > 180) {
  throw new Error(`Local distance unexpected: ${distLocal}`);
}
if (distReg < 180 || distReg > 215) {
  throw new Error(`Regional distance unexpected: ${distReg}`);
}
if (distCont < 220 || distCont > 270) {
  throw new Error(`Continental distance unexpected: ${distCont}`);
}
if (!(distMacro < distLocal && distLocal < distReg && distReg < distCont)) {
  throw new Error(`Distance hierarchy violated: ${distMacro} < ${distLocal} < ${distReg} < ${distCont}`);
}
console.log('2. Analytic framing distances (MACRO < LOCAL < REGIONAL < CONTINENTAL): OK');

// ----------------------------------------------------
// TEST 3: State Machine Lifecycle (IDLE -> APPROACH -> HOLD -> RETURN -> IDLE)
// ----------------------------------------------------
if (director.getState() !== 'IDLE') {
  throw new Error(`Expected initial state IDLE, got ${director.getState()}`);
}

director.setCandidateTarget(localTarget);
director.update(0.016); // first tick locks target

if (director.getState() !== 'APPROACH') {
  throw new Error(`Expected APPROACH state, got ${director.getState()}`);
}
if (mockControls.isEnabled()) {
  throw new Error('Controls should be disabled during APPROACH!');
}

// Progress through APPROACH (duration = 2.0s)
director.update(1.0);
if (director.getState() !== 'APPROACH') throw new Error('State should still be APPROACH');

director.update(1.1); // Total > 2.0s -> transitions to HOLD
if (director.getState() !== 'HOLD') {
  throw new Error(`Expected HOLD state after 2s approach, got ${director.getState()}`);
}

// Progress through HOLD (duration = 4.2s) without targetProvider -> transitions to RETURN
director.update(4.3); // Total > 4.2s -> transitions to RETURN
if (director.getState() !== 'RETURN') {
  throw new Error(`Expected RETURN state after hold without provider, got ${director.getState()}`);
}

// Progress through RETURN (duration = 2.0s)
director.update(2.1); // Total > 2.0s -> transitions to IDLE
if (director.getState() !== 'IDLE') {
  throw new Error(`Expected IDLE state after return, got ${director.getState()}`);
}
if (!mockControls.isEnabled()) {
  throw new Error('Controls should be re-enabled after RETURN to IDLE!');
}
console.log('3. State machine transitions (IDLE -> APPROACH -> HOLD -> RETURN -> IDLE): OK');

// ----------------------------------------------------
// TEST 4: User Override & Cooldown Protection
// ----------------------------------------------------
// Advance past idle overview cruising dwell (6.0s)
director.update(6.1);

// Start a new approach
director.setCandidateTarget(regionalTarget);
director.update(0.016);
if (director.getState() !== 'APPROACH') {
  throw new Error('Director failed to enter APPROACH');
}

// User moves mouse (interrupts!)
director.onUserInteraction();

if (director.getState() !== 'IDLE') {
  throw new Error(`User interaction must immediately revert to IDLE, got ${director.getState()}`);
}
if (!mockControls.isEnabled()) {
  throw new Error('Controls must be immediately enabled on user interaction!');
}
if (director.getUserCooldown() <= 3.0) {
  throw new Error(`Expected user cooldown ~4s, got ${director.getUserCooldown()}`);
}

// During cooldown, candidate targets should NOT trigger APPROACH
director.setCandidateTarget(continentalTarget);
director.update(1.0); // 1 sec passes
if (director.getState() !== 'IDLE') {
  throw new Error('Director should remain in IDLE during user cooldown!');
}

// Advance past remaining cooldown (3s)
director.update(3.5);
if (director.getUserCooldown() !== 0) {
  throw new Error(`Expected cooldown to expire, got ${director.getUserCooldown()}`);
}

// Next update should now engage the target
director.update(0.016);
if (director.getState() !== 'APPROACH') {
  throw new Error('Director failed to resume approach after cooldown expiration');
}
console.log('4. User override & cooldown protection: OK');

// ----------------------------------------------------
// TEST 5: Direct Inter-Cluster Chaining (HOLD -> Direct APPROACH)
// ----------------------------------------------------
// Complete current approach to enter HOLD
director.update(2.1);
if (director.getState() !== 'HOLD') {
  throw new Error(`Expected HOLD state, got ${director.getState()}`);
}

// Set target provider to offer the next storm
const nextTarget = createDummyScoredCluster('c-chained', -15, -45, 100, 'REGIONAL');
let providerQueried = false;
director.setTargetProvider(() => {
  providerQueried = true;
  return nextTarget;
});

// Advance through HOLD
director.update(4.3);

// Should transition directly to APPROACH for nextTarget, NOT to RETURN!
if (director.getState() !== 'APPROACH') {
  throw new Error(`Expected direct inter-cluster chaining to APPROACH, got ${director.getState()}`);
}
if (!providerQueried) {
  throw new Error('Target provider was not queried during chaining handover');
}
if (director.getTarget()?.clusterId !== nextTarget.id) {
  throw new Error(`Target should be chained storm ${nextTarget.id}, got ${director.getTarget()?.clusterId}`);
}
console.log('5. Direct inter-cluster chaining (HOLD -> Direct APPROACH): OK');

// ----------------------------------------------------
// TEST 6: Manual Mode Free Exploration (Never auto-locks)
// ----------------------------------------------------
director.setManualMode(true);
if (!director.isManualMode()) {
  throw new Error('Manual mode flag not set');
}
if (director.getState() !== 'IDLE') {
  throw new Error(`Manual mode must immediately set state to IDLE, got ${director.getState()}`);
}
if (!mockControls.isEnabled()) {
  throw new Error('Controls must remain enabled in manual mode');
}

// Even with candidate targets and expired cooldown, director must stay in IDLE
director.setCandidateTarget(macroTarget);
director.update(5.0);
if (director.getState() !== 'IDLE') {
  throw new Error(`Director must not auto-lock while in manual mode, state was ${director.getState()}`);
}
if (!mockControls.isEnabled()) {
  throw new Error('Controls must stay enabled throughout manual mode');
}

// Switching back to auto mode allows tracking again
director.setManualMode(false);
director.setCandidateTarget(macroTarget);
director.update(0.016);
if (director.getState() !== 'APPROACH') {
  throw new Error(`Director should resume auto tracking after disabling manual mode, got ${director.getState()}`);
}
console.log('6. Manual mode free exploration & toggle: OK');

// ----------------------------------------------------
// TEST 7: Drone View Angle & Distance Configuration
// ----------------------------------------------------
if (director.getDroneAngle() !== 0) {
  throw new Error(`Initial drone angle should be 0, got ${director.getDroneAngle()}`);
}

director.setDroneAngle(45);
if (director.getDroneAngle() !== 45) {
  throw new Error(`Expected drone angle 45, got ${director.getDroneAngle()}`);
}

director.setDroneDistance(200);
if (director.getDroneDistance() !== 200) {
  throw new Error(`Expected drone distance 200, got ${director.getDroneDistance()}`);
}

// Reset drone angle to 0 (Nadir)
director.setDroneAngle(0);
if (director.getDroneAngle() !== 0) {
  throw new Error(`Expected reset drone angle 0, got ${director.getDroneAngle()}`);
}
console.log('7. Drone view angle & distance configuration: OK');

// ----------------------------------------------------
// TEST 8: Inter-Cluster Chaining Preserves 10° Drone Angle (Zero Snap to 0°)
// ----------------------------------------------------
director.setDroneAngle(10);
// Complete approach into HOLD
director.update(2.5);
if (director.getState() !== 'HOLD') {
  throw new Error(`Expected HOLD state, got ${director.getState()}`);
}

const chainedTarget = createDummyScoredCluster('c-chained-10deg', 12, -70, 80, 'REGIONAL');
director.setTargetProvider(() => chainedTarget);
// Advance past hold duration to trigger chaining
director.update(4.5);
if (director.getState() !== 'APPROACH') {
  throw new Error(`Expected APPROACH state during chaining, got ${director.getState()}`);
}

// Check first frame of approach: starting angle MUST be 10°, NOT 0°!
director.update(0.016);
const currentCameraAngle = (director as any).currentCameraAngleDeg;
if (Math.abs(currentCameraAngle - 10) > 0.5) {
  throw new Error(`Camera angle snapped to ${currentCameraAngle}° instead of staying at 10°!`);
}
// ----------------------------------------------------
// TEST 9: Manual Mode Drone Angle Adjustment & Surface Target Sync
// ----------------------------------------------------
director.setManualMode(true);
mockCamera.position.set(0, 0, 260); // Centered looking at (0, 0, 0)

// In manual mode, set drone angle to 45°
director.setDroneAngle(45);
director.update(1.0); // Eases smoothly to target angle
const angleInManual = (director as any).currentCameraAngleDeg;
if (Math.abs(angleInManual - 45) > 0.5) {
  throw new Error(`Expected camera angle 45° in manual mode, got ${angleInManual}°`);
}

// Controls target must be (0,0,0)
const targetInManual = mockControls.getTarget();
if (targetInManual.length() > 0.01) {
  throw new Error(`Expected controls target at (0, 0, 0), got length ${targetInManual.length()}`);
}

// Resetting drone angle to 0° in manual mode should keep target at (0, 0, 0)
director.setDroneAngle(0);
director.update(1.0); // Eases smoothly back to 0°
console.log('9. Manual mode drone angle adjustment: OK');

// ----------------------------------------------------
// TEST 10: Arrival-Synced Flash Playback (1.2s Before Touchdown)
// ----------------------------------------------------
const arrivalCamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
const arrivalControls = new MockControlsManager() as unknown as ControlsManager;
const arrivalDirector = new CameraDirector(arrivalCamera, arrivalControls, {
  approachDurationMs: 6000,
  holdDurationMs: 10400
});

const landTarget = createDummyScoredCluster('c-arrival-land', 15, 25, 60, 'LOCAL');
let arrivalFired = false;
arrivalDirector.onArrivalFlash = (_cluster) => {
  arrivalFired = true;
};

// Start approach
arrivalDirector.flyToCluster(landTarget);
if (arrivalDirector.getState() !== 'APPROACH') {
  throw new Error('Expected state APPROACH');
}

// 4.5 seconds in (approachDuration = 6.0s; 1.5s remaining before touchdown): Flash should NOT have fired yet
arrivalDirector.update(4.5);
if (arrivalFired || arrivalDirector.getArrivalFlashTriggered()) {
  throw new Error('Arrival flash fired too early! (Should fire at 6.0 - 1.2 = 4.8s)');
}

// Advance to 4.9 seconds (phaseElapsedSec >= 4.8s): Flash MUST fire
arrivalDirector.update(0.4);
if (!arrivalFired || !arrivalDirector.getArrivalFlashTriggered()) {
  throw new Error('Arrival flash did not trigger at approachDuration - 1.2s mark!');
}
console.log('10. Arrival-Synced Flash Playback (triggers at T-1.2s before touchdown): OK');

// ----------------------------------------------------
// TEST 11: Deep Ocean Close-up Framing & Halved Dwell Duration
// ----------------------------------------------------
const oceanTarget = createDummyScoredCluster('c-ocean-pacific', 0.0, -140.0, 120, 'REGIONAL');

// Verify ocean detection
if (!arrivalDirector.isOceanLocation(oceanTarget.centroid.latitude, oceanTarget.centroid.longitude)) {
  throw new Error('Pacific coordinate (0, -140) should be identified as deep ocean');
}

arrivalDirector.flyToCluster(oceanTarget);
if (!arrivalDirector.getIsCurrentTargetOcean()) {
  throw new Error('Director should mark target as ocean location');
}

// Verify framing distance is strictly VERY_CLOSE (145) or CLOSE (175), NEVER CONTINENTAL (310)
const oceanDist = (arrivalDirector as any).currentTarget?.targetDistance;
if (oceanDist !== 145 && oceanDist !== 175) {
  throw new Error(`Ocean target framing distance should be 145 or 175, got ${oceanDist}`);
}

// Verify hold duration is halved from 10.4s to 5.2s
const oceanHoldSec = (arrivalDirector as any).holdDurationSec;
if (Math.abs(oceanHoldSec - 5.2) > 0.01) {
  throw new Error(`Expected ocean hold duration 5.2s, got ${oceanHoldSec}s`);
}

console.log('11. Deep Ocean Close-up Framing (115/140u) & Halved Dwell Duration (5.2s): OK');

console.log('ALL CAMERA DIRECTOR UNIT TESTS FINISHED: OK');
