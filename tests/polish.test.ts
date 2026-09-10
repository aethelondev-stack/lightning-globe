import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AtmosphereGlow } from '../src/world/atmosphere/AtmosphereGlow';
import { calculateNightFactor } from '../src/utils/sun';
import { SoundDirector } from '../src/services/audio/SoundDirector';

function runPolishTests(): void {
  console.log('--- RUNNING PHASE 14 FINAL VISUAL POLISH & AUDIO UNIT TESTS ---');

  // ----------------------------------------------------
  // TEST 1: Fresnel Rayleigh Scattering Limb Formula
  // ----------------------------------------------------
  console.log('Test 1: Verifying Fresnel scattering intensity curve...');
  const centerIntensity = AtmosphereGlow.calculateFresnel(1.0, 3.5, 1.4);
  assert.equal(centerIntensity, 0.0, 'Center of globe (dot = 1.0) must have 0 Fresnel rim intensity');

  const limbIntensity = AtmosphereGlow.calculateFresnel(0.0, 3.5, 1.4);
  assert.equal(limbIntensity, 1.4, 'Limb horizon (dot = 0.0) must have peak 1.4 Fresnel intensity');

  // Verify monotonic growth from center (1.0) to horizon (0.0)
  let prevVal = centerIntensity;
  for (let dot = 0.9; dot >= 0.0; dot -= 0.1) {
    const val = AtmosphereGlow.calculateFresnel(dot, 3.5, 1.4);
    assert(
      val >= prevVal,
      `Fresnel curve must monotonically increase as dot decreases (dot: ${dot}, val: ${val}, prev: ${prevVal})`
    );
    prevVal = val;
  }
  console.log('  -> Fresnel limb curve verified: 0.0 at center, 1.4 at tangent horizon: OK');

  // ----------------------------------------------------
  // TEST 2: AtmosphereGlow Mesh & Shader Specifications
  // ----------------------------------------------------
  console.log('Test 2: Verifying AtmosphereGlow geometry & shader properties...');
  const glow = new AtmosphereGlow(101.8);
  assert(glow.mesh instanceof THREE.Mesh, 'AtmosphereGlow must provide a THREE.Mesh');
  assert.equal(glow.mesh.renderOrder, 3, 'Atmosphere mesh must render above globe surface');

  const mat = glow.mesh.material as THREE.ShaderMaterial;
  assert.equal(mat.side, THREE.BackSide, 'ShaderMaterial must use BackSide for halo shell');
  assert.equal(mat.blending, THREE.AdditiveBlending, 'ShaderMaterial must use AdditiveBlending');
  assert.equal(mat.transparent, true, 'ShaderMaterial must be transparent');
  assert.equal(mat.depthWrite, false, 'depthWrite must be false to avoid occluding lightning effects');

  glow.dispose();
  console.log('  -> AtmosphereGlow mesh and shader configuration verified: OK');

  // ----------------------------------------------------
  // TEST 3: Solar Terminator Night Lights Blending
  // ----------------------------------------------------
  console.log('Test 3: Verifying solar terminator night factor calculation...');
  const dayFactor = calculateNightFactor(1.0); // Facing Sun
  assert.equal(dayFactor, 0.0, 'Day side (sunDot = 1.0) must have nightFactor = 0.0');

  const nightFactor = calculateNightFactor(-1.0); // Opposing Sun
  assert.equal(nightFactor, 1.0, 'Night side (sunDot = -1.0) must have nightFactor = 1.0');

  // Twilight transition zone (-0.15 to 0.05)
  const twilight1 = calculateNightFactor(0.0);
  const twilight2 = calculateNightFactor(-0.05);
  const twilight3 = calculateNightFactor(-0.10);

  assert(twilight1 > 0.0 && twilight1 < 1.0, 'Twilight zone must produce partial blending');
  assert(twilight2 > twilight1, 'Darker twilight must produce higher night factor');
  assert(twilight3 > twilight2, 'Deeper twilight must continue smoothstep curve');
  console.log('  -> Terminator smoothstep curve verified: 0.0 (day) -> 1.0 (night): OK');

  // ----------------------------------------------------
  // TEST 4: SoundDirector Headless Safety & State Machine
  // ----------------------------------------------------
  console.log('Test 4: Verifying SoundDirector state machine and headless safety...');
  const soundDirector = new SoundDirector();

  assert.equal(soundDirector.isMuted(), true, 'SoundDirector must be muted by default (Autoplay compliance)');

  // Ensure calling audio methods while muted in Node.js does not throw or fail
  assert.doesNotThrow(() => {
    soundDirector.playStrikeSound(45.0);
    soundDirector.playStrikeSound(-60.0);
    soundDirector.playApproachSound();
  }, 'Audio calls while muted must be clean safe no-ops');

  // Test mute toggle
  const newMutedState = soundDirector.toggleMute();
  assert.equal(newMutedState, false, 'toggleMute should transition from muted to unmuted');
  assert.equal(soundDirector.isMuted(), false, 'isMuted must reflect active state');

  soundDirector.setMuted(true);
  assert.equal(soundDirector.isMuted(), true, 'setMuted(true) must restore muted state');

  soundDirector.dispose();
  console.log('  -> SoundDirector headless safety, default mute, and toggle verified: OK');

  console.log('\n--- ALL PHASE 14 POLISH TESTS FINISHED: OK ---');
}

runPolishTests();
