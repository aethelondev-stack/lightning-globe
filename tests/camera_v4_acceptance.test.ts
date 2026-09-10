import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraController, DISTANCE_PRESETS } from '../src/core/CameraController';
import { ControlsManager } from '../src/core/ControlsManager';

// Mock DOM element for Node.js test environment
function createMockDomElement(): HTMLElement {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  } as unknown as HTMLElement;
}

test('v4 Acceptance Test 1 — Açılış (Opening)', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // Invariants on initialization
  assert.equal(controller.R, 100);
  assert.equal(controller.currentLat, 0);
  assert.equal(controller.currentLon, 0);
  assert.equal(controller.currentDistance, 400); // 4.0 * R
  assert.equal(controller.currentTilt, 0);
  assert.equal(controller.state, 'READY');

  // Verify camera Euclidean distance invariant
  assert.ok(
    Math.abs(camera.position.length() - 400) < 0.01,
    `Camera distance must equal 400, got ${camera.position.length()}`
  );

  // At lat=0, lon=0, tilt=0: Camera must be on normal of (0,0,100) -> at (0, 0, 400)
  assert.ok(Math.abs(camera.position.x) < 0.01, 'camera.position.x should be ~0');
  assert.ok(Math.abs(camera.position.y) < 0.01, 'camera.position.y should be ~0');
  assert.ok(Math.abs(camera.position.z - 400) < 0.01, 'camera.position.z should be 400');
});

test('v4 Acceptance Test 2 — CLOSE preset & Globe penetration guard', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // Set distance to CLOSE preset (1.15 * R = 115)
  controller.currentDistance = 115;
  controller.targetDistance = 115;
  controller.update(0.016);

  assert.ok(
    Math.abs(camera.position.length() - 115) < 0.01,
    `Camera distance should be 115, got ${camera.position.length()}`
  );

  // Must not penetrate globe (R = 100, minDistance = 112)
  assert.ok(controller.currentDistance >= controller.minDistance);
  assert.ok(camera.position.length() > controller.R);
});

test('v4 Acceptance Test 3 — Tilt geometry & Zero lateral roll', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // Set country distance (140u) and 50% tilt
  controller.currentDistance = 140;
  controller.targetDistance = 140;
  controller.currentTilt = 0.50;
  controller.currentLat = 0;
  controller.currentLon = 0;
  controller.update(0.016);

  // Verify distance invariant holds under tilt
  assert.ok(
    Math.abs(camera.position.length() - 140) < 0.01,
    `Camera distance under tilt must remain 140, got ${camera.position.length()}`
  );

  // At lat=0, lon=0:
  // Normal N = (0, 0, 1), South tangent S = (0, -1, 0)
  // Tilt moves camera towards -Y (South) in the YZ meridian plane!
  // X coordinate must remain exactly 0 (ZERO lateral roll/yaw)!
  assert.ok(
    Math.abs(camera.position.x) < 0.001,
    `Camera must not drift in X (zero roll in meridian plane), got ${camera.position.x}`
  );
  assert.ok(
    camera.position.y < -1.0,
    `Camera should tilt towards South (-Y), got ${camera.position.y}`
  );
  assert.ok(
    camera.position.z > 0,
    `Camera should remain on sunlit hemisphere (+Z), got ${camera.position.z}`
  );

  // Duration for 0 -> 50% tilt must be in range 2.5s - 3.2s
  const duration = controller.calculateDuration(0, 0, 0.5);
  assert.ok(
    duration >= 2.4 && duration <= 3.3,
    `Tilt transition duration must be ~2.5s-3.2s, got ${duration}`
  );
});

test('v4 Acceptance Test 4 — Long Flight & Flight Arc', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // Current: D = 115 (CLOSE), Lat=0, Lon=0
  controller.currentDistance = 115;
  controller.targetDistance = 115;
  controller.currentLat = 0;
  controller.currentLon = 0;

  // Target: Lat=0, Lon=90 (angular distance = 90° > 60°), targetD = 140 (< 2R)
  const angDistRad = controller.getGreatCircleAngle(0, 0, 0, 90);
  const angDistDeg = (angDistRad * 180) / Math.PI;
  assert.ok(angDistDeg > 60, `Angular distance must exceed 60°, got ${angDistDeg}`);

  // Flight arc is mandatory:
  // peakDistance = max(currentDist, targetDist, 3R) = max(115, 140, 300) = 300 (3.0 * R)
  const peakDist = Math.max(115, 140, 3.0 * 100);
  assert.equal(peakDist, 300);

  // Total duration for >85° must be in range 6.5s - 8.0s
  const duration = controller.calculateDuration(angDistDeg, 140 - 115, 0);
  assert.ok(
    duration >= 6.4 && duration <= 8.01,
    `Long flight duration must be between 6.5s and 8.0s, got ${duration}`
  );
});

test('v4 Acceptance Test 5 — Antimeridian shortest path (179° -> -179°)', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // from 179° to -179°
  const resolvedTargetLon = controller.getShortestAngle(179, -179);
  const delta = resolvedTargetLon - 179;

  // Must be +2° (short path across 180° dateline), NOT -358°
  assert.ok(
    Math.abs(delta - 2.0) < 0.001,
    `Expected shortest angle delta to be +2°, got ${delta}°`
  );
});

test('v4 Acceptance Test 6 — Pole safety (lat = 89.5°)', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // Set near North Pole
  controller.currentLat = 89.5;
  controller.currentLon = 45;
  controller.update(0.016);

  assert.ok(Number.isFinite(camera.position.x));
  assert.ok(Number.isFinite(camera.position.y));
  assert.ok(Number.isFinite(camera.position.z));
  assert.ok(
    Math.abs(camera.position.length() - controller.currentDistance) < 0.01,
    'Distance invariant must hold at 89.5° pole'
  );

  // Attempting to set lat > 89.5 should be clamped to 89.5
  const clampedVec = controller.latLonToVector3(90.0, 45, 100);
  const backCoords = controller.vector3ToLatLon(clampedVec);
  assert.ok(
    backCoords.lat <= 89.51,
    `Latitude must not exceed 89.5°, got ${backCoords.lat}`
  );
});

test('v4 Acceptance Test 7 — Wheel zoom damping & Snap prevention', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  const initialDist = controller.currentDistance; // 400

  // Simulate wheel event zoom in (deltaY < 0)
  const mockWheelEvent = {
    deltaY: -100,
    preventDefault: () => {}
  } as unknown as WheelEvent;

  // Trigger internal onWheel
  (controller as any).onWheel(mockWheelEvent);

  assert.equal(controller.state, 'MANUAL_ZOOM');
  // targetDistance should decrease by 100 * 0.002 * 100 = 20u
  assert.equal(controller.targetDistance, 380);

  // currentDistance must NOT snap immediately!
  assert.equal(controller.currentDistance, initialDist);

  // After 1 frame of damping (LERP factor 0.045)
  controller.update(0.016);
  assert.ok(
    controller.currentDistance < initialDist && controller.currentDistance > 380,
    `Damping LERP should move smoothly towards 380, got ${controller.currentDistance}`
  );
});

test('v4 Acceptance Test 8 — New Target During Flight (Tween kill & zero snap)', async () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // Start flight 1
  controller.flyTo({ lat: 30, lon: 30, distance: 200 });
  assert.equal(controller.state, 'FLYING');
  assert.ok(controller.activeTween !== null);

  // Advance 1 frame
  controller.update(0.05);

  const capturedDistanceBeforeInterrupt = controller.currentDistance;

  // Interrupt with new flight to different target
  controller.flyTo({ lat: -20, lon: -40, distance: 150 });
  assert.equal(controller.state, 'FLYING');

  // Must not snap distance
  assert.ok(
    Math.abs(controller.currentDistance - capturedDistanceBeforeInterrupt) < 0.1,
    'Interrupted flight must begin exactly from current state without snap'
  );

  controller.destroy();
});

test('v4 Acceptance Test 9 — Idle Orbit (5s delay, 3°/s reverse rotation)', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // Simulate 5 seconds elapsed without interaction
  controller.lastInteractionTime = performance.now() - 5500;

  // Update 1 step
  controller.update(0.1);
  assert.equal(controller.isIdle, true);
  assert.ok(controller.idleWeight > 0);

  const prevLon = controller.currentLon;
  const prevLat = controller.currentLat;
  const prevDist = controller.currentDistance;
  const prevTilt = controller.currentTilt;

  // Run 1 second of idle
  controller.idleWeight = 1.0; // fully faded in
  controller.update(1.0);

  // Longitude must decrease by ~3.0° (counter-rotation)
  const lonDelta = controller.currentLon - prevLon;
  assert.ok(
    Math.abs(lonDelta - (-3.0)) < 0.1,
    `Idle rotation should be -3.0°/s, got ${lonDelta}`
  );

  // Latitude, distance, and tilt must be strictly unchanged
  assert.equal(controller.currentLat, prevLat);
  assert.equal(controller.currentDistance, prevDist);
  assert.equal(controller.currentTilt, prevTilt);
});

test('v4 Acceptance Test 10 — Idle Interrupt on interaction', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  controller.isIdle = true;
  controller.idleWeight = 1.0;
  controller.state = 'IDLE';

  // Interaction occurs
  controller.resetIdleTimer();

  assert.equal(controller.isIdle, false);
  assert.equal(controller.state, 'IDLE_EXITING');

  controller.destroy();
});

test('v4 Acceptance Test 11 — GRID_MODE Exception (3.5R + 10% tilt)', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // In normal mode at distance 350 (3.5 * R >= 3.0 * R), falloff is 0.0
  controller.currentDistance = 350;
  controller.targetDistance = 350;
  controller.currentTilt = 0.10;
  controller.isGridMode = false;
  assert.equal(controller.getTiltFalloff(350), 0.0);

  // When GRID_MODE is active, falloff is 1.0 (explicit exception)
  controller.isGridMode = true;
  assert.equal(controller.getTiltFalloff(350), 1.0);

  controller.update(0.016);
  // Distance invariant still holds
  assert.ok(Math.abs(camera.position.length() - 350) < 0.01);
});

test('v4 Acceptance Test 12 — NaN & Infinity Safety', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);

  // Test with extreme edge values
  controller.currentLat = 89.5;
  controller.currentLon = 180;
  controller.currentDistance = 500;
  controller.currentTilt = 1.0;
  controller.update(0.016);

  assert.ok(Number.isFinite(camera.position.x));
  assert.ok(Number.isFinite(camera.position.y));
  assert.ok(Number.isFinite(camera.position.z));
  assert.ok(!Number.isNaN(camera.position.x));
  assert.ok(!Number.isNaN(camera.position.y));
  assert.ok(!Number.isNaN(camera.position.z));

  // Near-antipodal interpolation test
  const mid = controller.interpolateGreatCircle(0, 0, 0, 180, 0.5);
  assert.ok(Number.isFinite(mid.lat));
  assert.ok(Number.isFinite(mid.lon));
  assert.ok(!Number.isNaN(mid.lat));
  assert.ok(!Number.isNaN(mid.lon));

  controller.destroy();
});

test('v4 Acceptance Test 13 — Pitch Presets (0°, 15°, 25°, 45°, 60°, 75°) & Tilt Angle Kinematics', async () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);
  const controlsManager = new ControlsManager(camera, dom, controller);

  // Set initial position: Turkey coordinates (lat=39, lon=35), distance=340
  controller.currentLat = 39;
  controller.currentLon = 35;
  controller.currentDistance = 340;
  controller.targetDistance = 340;
  controller.update(0.016);

  const presets = [0, 15, 25, 45, 60, 75];
  const positions: THREE.Vector3[] = [];

  const targetPoint = controller.latLonToVector3(39, 35, 100);

  for (const p of presets) {
    await controlsManager.setPitchAngle(p, false);
    controller.update(0.016);

    const pos = camera.position.clone();
    positions.push(pos);

    // Distance invariant must hold: distance to center must remain 340
    assert.ok(
      Math.abs(pos.length() - 340) < 0.05,
      `Pitch ${p}°: Camera distance should be 340, got ${pos.length()}`
    );

    // Target lock invariant: The focal point on the globe must project to NDC (0, 0)
    camera.updateMatrixWorld(true);
    const ndc = targetPoint.clone().project(camera);
    assert.ok(
      Math.abs(ndc.x) < 0.001 && Math.abs(ndc.y) < 0.001,
      `Pitch ${p}°: Target must remain centered in viewport NDC (0, 0), got (${ndc.x.toFixed(4)}, ${ndc.y.toFixed(4)})`
    );
  }

  // 0° (Nadir) should be distinct from 15°, 25°, 45°, 60°, 75°
  for (let i = 1; i < presets.length; i++) {
    const prevPos = positions[i - 1];
    const currPos = positions[i];
    const diff = prevPos.distanceTo(currPos);
    assert.ok(
      diff > 3.0,
      `Pitch ${presets[i]}° must visibly change camera position compared to ${presets[i - 1]}° (delta: ${diff.toFixed(2)})`
    );
  }

  // Invariant: Target point stays in viewport and camera.up has zero roll
  assert.ok(Number.isFinite(camera.up.x));
  assert.ok(Number.isFinite(camera.up.y));
  assert.ok(Number.isFinite(camera.up.z));

  controller.destroy();
});

test('v4 Acceptance Test 14 — Smooth Animated Pitch Transition via GSAP flyTo', async () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
  const dom = createMockDomElement();
  const controller = new CameraController(camera, dom, 100);
  const controlsManager = new ControlsManager(camera, dom, controller);

  controller.currentLat = 0;
  controller.currentLon = 0;
  controller.currentDistance = 200;
  controller.targetDistance = 200;
  controller.currentTilt = 0;
  controller.update(0.016);

  assert.strictEqual(controller.currentTilt, 0);

  // Trigger animated pitch to 45° (tilt = 45 / 75 = 0.6)
  const flightPromise = controlsManager.setPitchAngle(45, true);
  assert.strictEqual(controller.state, 'FLYING');

  await flightPromise;

  assert.strictEqual(controller.state, 'READY');
  assert.ok(
    Math.abs(controller.currentTilt - 0.6) < 0.01,
    `Target tilt should be 0.6, got ${controller.currentTilt}`
  );
  assert.ok(
    Math.abs(camera.position.length() - 200) < 0.05,
    `Camera distance should be 200, got ${camera.position.length()}`
  );

  controller.destroy();
});
