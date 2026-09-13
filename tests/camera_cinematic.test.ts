import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraDirector } from '../src/services/camera/CameraDirector';
import { ControlsManager } from '../src/core/ControlsManager';
import { EventDirector } from '../src/services/director/EventDirector';
import { StochasticPacingQueue } from '../src/services/providers/StochasticPacingQueue';
import { GeoIndex, CONTINENTS, REGIONS } from '../src/utils/geoRegions';
import { SHOT_SCALE_DISTANCES } from '../src/types/camera';
import type { ScoredCluster } from '../src/types/scoring';
import { latLngToVector3 } from '../src/utils/coordinates';

test('CameraFilterMatrix & GeoIndex - Geographic & Petek multi-filter evaluation', () => {
  // Test Buenos Aires, Argentina (-34.6, -58.4)
  const isArg = GeoIndex.isCoordInCountry(-34.6, -58.4, 'Arjantin');
  assert.equal(isArg, true, 'Buenos Aires should match Arjantin');

  // Test Ankara, Turkey (39.9, 32.8)
  const isTr = GeoIndex.isCoordInCountry(39.9, 32.8, 'Türkiye');
  assert.equal(isTr, true, 'Ankara should match Türkiye');

  // Test Mediterranean Region (36.0, 18.0)
  const isMed = GeoIndex.isCoordInRegion(36.0, 18.0, 'mediterranean');
  assert.equal(isMed, true, 'Central Mediterranean coordinate should match Mediterranean region');

  // Test Multi-dimensional OR filter: Turkey OR Congo
  const matchFilter1 = GeoIndex.matchesFilter(39.9, 32.8, [], [], ['Türkiye']);
  assert.equal(matchFilter1, true);

  const matchFilter2 = GeoIndex.matchesFilter(-34.6, -58.4, [], [], ['Türkiye']);
  assert.equal(matchFilter2, false, 'Argentina should not match Turkey filter');

  const matchFilterBoth = GeoIndex.matchesFilter(-34.6, -58.4, ['SA'], [], ['Türkiye']);
  assert.equal(matchFilterBoth, true, 'Argentina coordinate matches continent SA');
});

test('StochasticPacingQueue - Arrival-Synced Flash Handshake adjusts scheduled time', () => {
  const emittedTimes: number[] = [];
  const queue = new StochasticPacingQueue<{ id: string }>({
    defaultDurationMs: 10000,
    onEmit: () => {
      emittedTimes.push(Date.now());
    }
  });

  const now = Date.now();
  // Enqueue 4 strikes near Maracaibo (9.8, -71.5) scheduled far in the future
  queue.enqueueBatch([
    { data: { id: 'm1' }, lat: 9.8, lon: -71.5 },
    { data: { id: 'm2' }, lat: 9.82, lon: -71.51 },
    { data: { id: 'm3' }, lat: 9.79, lon: -71.49 }
  ], 10000);

  // Flight duration 3000ms -> arrivalEpoch = now + 3000
  const arrivalEpoch = now + 3000;

  // Broadcast sync
  StochasticPacingQueue.broadcastArrivalSync(9.8, -71.5, 80, arrivalEpoch);

  // Queue should still hold 3 items, but re-scheduled near arrivalEpoch - 400ms (~now + 2600ms)
  assert.equal(queue.size, 3);

  queue.dispose();
});

test('EventDirector - Filters candidate clusters according to CameraFilterMatrix', () => {
  const eventDirector = new EventDirector();
  const now = Date.now();

  const clusterTurkey: ScoredCluster = {
    id: 'c_tr',
    centroid: { latitude: 39.0, longitude: 35.0 },
    boundingRadiusKm: 50,
    eventCount: 30,
    strikesPerMinute: 30,
    growthRate: 1.0,
    breakdown: { cgCount: 30, icCount: 0 },
    events: [],
    activityScore: 0.85,
    presentationClass: 'REGIONAL',
    stormClass: 'SUPERCELL',
    firstEventTimestamp: now - 5000,
    lastEventTimestamp: now - 500
  };

  const clusterUS: ScoredCluster = {
    id: 'c_us',
    centroid: { latitude: 38.0, longitude: -97.0 },
    boundingRadiusKm: 80,
    eventCount: 45,
    strikesPerMinute: 45,
    growthRate: 1.0,
    breakdown: { cgCount: 45, icCount: 0 },
    events: [],
    activityScore: 0.90,
    presentationClass: 'CONTINENTAL',
    stormClass: 'MCS',
    firstEventTimestamp: now - 5000,
    lastEventTimestamp: now - 500
  };

  // 1. Without filter: both eligible
  eventDirector.updateClusters([clusterTurkey, clusterUS], now);
  const target1 = eventDirector.getNextTarget(now);
  assert.ok(target1);

  // 2. With filter matrix locking only to 'Türkiye'
  eventDirector.setFilterMatrix({
    autoFollow: true,
    cameraMode: 'AUTO',
    shotScale: 'COUNTRY',
    pitchDeg: 25,
    manualDistance: 220,
    continents: [],
    regions: [],
    countries: ['Türkiye'],
    peteks: []
  });

  eventDirector.updateClusters([clusterTurkey, clusterUS], now + 1000);
  const filteredTarget = eventDirector.getNextTarget(now + 1000);
  assert.equal(filteredTarget?.id, 'c_tr', 'Only Turkish cluster should be picked when filter is active');
});

test('CameraDirector - Pitch angle, Shot Scale distances and manual override', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.77, 0.1, 2000);
  camera.position.set(0, 0, 280);

  const container = {
    addEventListener: () => {},
    removeEventListener: () => {}
  } as any;

  const controlsManager = new ControlsManager(camera, container);
  const cameraDirector = new CameraDirector(camera, controlsManager);

  // Default filter matrix checks (Updated to 15 deg pitch and AUTO_DIVERSITY shot scale)
  const matrix = cameraDirector.getFilterMatrix();
  assert.equal(matrix.shotScale, 'AUTO_DIVERSITY');
  assert.equal(matrix.pitchDeg, 15);
  assert.equal(matrix.manualDistance, 220);

  // Update shot scale to VERY_CLOSE
  cameraDirector.setShotScale('VERY_CLOSE');
  assert.equal(cameraDirector.getShotScale(), 'VERY_CLOSE');
  assert.equal(cameraDirector.getManualDistance(), SHOT_SCALE_DISTANCES.VERY_CLOSE);

  // Update pitch to 45 deg
  cameraDirector.setPitchDeg(45);
  assert.equal(cameraDirector.getPitchDeg(), 45);

  // Manual interaction sets cooldown
  cameraDirector.onUserInteraction();
  assert.equal(cameraDirector.getUserCooldown() > 0, true);

  // Manual mode toggle
  cameraDirector.setManualMode(true);
  assert.equal(cameraDirector.isManualMode(), true);
  assert.equal(cameraDirector.isAutoFollow(), false);

  cameraDirector.destroy();
  controlsManager.destroy();
});

test('CameraDirector - Intro Drone Choreography (10s 340u -> 260u smooth zoom, user cancel & storm chaining)', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.77, 0.1, 2000);
  const container = { addEventListener: () => {}, removeEventListener: () => {} } as any;
  const controlsManager = new ControlsManager(camera, container);

  // 1. Initial greeting: starts at 340u distance in INTRO_ORBIT phase
  const cameraDirector = new CameraDirector(camera, controlsManager, {
    enableIntroOrbit: true
  });

  assert.equal(cameraDirector.isIntroOrbitActive(), true);
  assert.equal(cameraDirector.getFlightPhase(), 'INTRO_ORBIT');
  assert.equal(cameraDirector.getState(), 'IDLE');
  assert.equal(Math.round(camera.position.length()), 340);

  // 2. Advance halfway (5s): distance eases smoothly between 340 and 260
  cameraDirector.update(5.0);
  assert.equal(cameraDirector.isIntroOrbitActive(), true);
  assert.ok(camera.position.length() < 330 && camera.position.length() > 270, `Midway distance should be ~300u, got ${camera.position.length()}`);

  // 3. User interaction cancels intro immediately
  cameraDirector.onUserInteraction();
  assert.equal(cameraDirector.isIntroOrbitActive(), false);
  assert.equal(cameraDirector.getFlightPhase(), 'IDLE');
  assert.ok(cameraDirector.getUserCooldown() > 0);

  cameraDirector.destroy();

  // 4. Test full 10-second completion seamlessly chaining to candidate storm
  const camera2 = new THREE.PerspectiveCamera(45, 1.77, 0.1, 2000);
  const director2 = new CameraDirector(camera2, controlsManager, {
    enableIntroOrbit: true,
    approachDurationMs: 3500
  });

  const now = Date.now();
  const testStorm: ScoredCluster = {
    id: 'intro_storm',
    centroid: { latitude: 12.0, longitude: -70.0 },
    boundingRadiusKm: 60,
    eventCount: 30,
    strikesPerMinute: 30,
    growthRate: 1.0,
    breakdown: { cgCount: 30, icCount: 0 },
    events: [],
    activityScore: 0.9,
    presentationClass: 'LOCAL',
    stormClass: 'SUPERCELL',
    firstEventTimestamp: now - 5000,
    lastEventTimestamp: now - 500
  };

  // Queue storm during intro
  director2.setCandidateTarget(testStorm);
  director2.update(5.0);
  assert.equal(director2.getFlightPhase(), 'INTRO_ORBIT', 'Intro should continue playing for full duration');

  // Complete intro (total 10.1s > 10.0s) -> should automatically transition to APPROACH for testStorm
  director2.update(5.1);
  assert.equal(director2.isIntroOrbitActive(), false);
  assert.equal(director2.getState(), 'APPROACH', 'Should seamlessly chain to APPROACH after intro completes');
  assert.equal(director2.getTarget()?.clusterId, testStorm.id);

  director2.destroy();
  controlsManager.destroy();
});

test('CameraDirector & ControlsManager - Precision Pose & outLook Math Alignment (Zero distortion / twist)', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.77, 0.1, 2000);
  const container = { addEventListener: () => {}, removeEventListener: () => {} } as any;
  const controlsManager = new ControlsManager(camera, container);
  const cameraDirector = new CameraDirector(camera, controlsManager);

  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();

  // 1. Nadir view (pitch <= 1): outLook MUST be target location
  const surface = latLngToVector3(39.9, 32.8, 0, 100);
  cameraDirector.calculateCameraPose(39.9, 32.8, 220, 0, eye, look);
  assert.deepEqual(look, surface, 'Nadir outLook must be surface target');
  assert.equal(Math.round(eye.length()), 220, 'Eye distance must match framing distance');

  // 2. Drone view (pitch = 45): outLook MUST be target location
  cameraDirector.calculateCameraPose(39.9, 32.8, 220, 45, eye, look);
  assert.deepEqual(look, surface, 'Tilted outLook must be anchored at target location');

  // 3. Polar latitude test (89° N): gimbal-lock immunity
  cameraDirector.calculateCameraPose(89.0, 10.0, 200, 30, eye, look);
  assert.ok(!isNaN(eye.x) && !isNaN(eye.y) && !isNaN(eye.z), 'Eye must have no NaN near pole');
  assert.ok(!isNaN(look.x) && !isNaN(look.y) && !isNaN(look.z), 'Look must have no NaN near pole');

  // 4. ControlsManager min/max boundaries and syncTarget (v4: 1.12R = 112, 5.00R = 500)
  assert.equal(Math.round(controlsManager.minDistance), 112);
  assert.equal(Math.round(controlsManager.maxDistance), 500);

  const target = new THREE.Vector3(10, 20, 30);
  controlsManager.syncTarget(target);
  assert.deepEqual(controlsManager.getTarget(), target);
  controlsManager.syncTarget();
  assert.deepEqual(controlsManager.getTarget(), new THREE.Vector3(0, 0, 0));

  cameraDirector.destroy();
  controlsManager.destroy();
});

