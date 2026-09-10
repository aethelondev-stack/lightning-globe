import assert from 'node:assert/strict';
import { getLunarPosition } from '../src/utils/moon';

function runMoonTests(): void {
  console.log('--- RUNNING LUNAR EPHEMERIS & ASTRONOMICAL MOON TESTS ---');

  // TEST 1: Physical coordinate bounds
  console.log('Test 1: Verifying sublunar coordinates within physical astronomical limits...');
  const pos = getLunarPosition(new Date(), 420);
  assert(
    pos.latitude >= -28.7 && pos.latitude <= 28.7,
    `Sublunar latitude ${pos.latitude} exceeds physical inclination limits [-28.7, 28.7]`
  );
  assert(
    pos.longitude >= -180 && pos.longitude <= 180,
    `Sublunar longitude ${pos.longitude} outside valid range [-180, 180]`
  );
  console.log(`  -> Sublunar Point: lat=${pos.latitude.toFixed(2)}°, lon=${pos.longitude.toFixed(2)}°: OK`);

  // TEST 2: 3D Vector distance & normalized direction
  console.log('Test 2: Verifying 3D position vector distance and unit direction...');
  const distance = 420;
  const posDist = getLunarPosition(new Date(), distance);
  assert(Math.abs(posDist.vector.length() - distance) < 0.1, `Vector length must equal ${distance}`);
  assert(Math.abs(posDist.direction.length() - 1.0) < 0.001, 'Direction vector must be normalized unit vector');
  console.log('  -> 3D Position vector length and normalization: OK');

  // TEST 3: Illuminated fraction and phase name
  console.log('Test 3: Verifying illuminated fraction range and Turkish phase nomenclature...');
  assert(pos.illuminatedFraction >= 0.0 && pos.illuminatedFraction <= 1.0, 'Fraction must be between 0.0 and 1.0');
  assert(typeof pos.phaseName === 'string' && pos.phaseName.length > 3, 'Phase name must be valid string');
  console.log(`  -> Current Live Phase: ${pos.phaseName} (${(pos.illuminatedFraction * 100).toFixed(1)}% illuminated): OK`);

  // TEST 4: Known Supermoon (August 19, 2024, 18:26 UTC)
  console.log('Test 4: Verifying known historical Full Moon (August 19, 2024)...');
  const fullMoonDate = new Date(Date.UTC(2024, 7, 19, 18, 26, 0));
  const fullPos = getLunarPosition(fullMoonDate, 400);
  assert(fullPos.illuminatedFraction > 0.95, `Expected Full Moon > 0.95, got ${fullPos.illuminatedFraction}`);
  assert.equal(fullPos.phaseName, 'Dolunay', `Expected phase name 'Dolunay', got ${fullPos.phaseName}`);
  console.log('  -> Historical Full Moon verified: OK');

  // TEST 5: Known Solar Eclipse / New Moon (April 8, 2024, 18:21 UTC)
  console.log('Test 5: Verifying known historical New Moon (April 8, 2024)...');
  const newMoonDate = new Date(Date.UTC(2024, 3, 8, 18, 21, 0));
  const newPos = getLunarPosition(newMoonDate, 400);
  assert(newPos.illuminatedFraction < 0.05, `Expected New Moon < 0.05, got ${newPos.illuminatedFraction}`);
  assert.equal(newPos.phaseName, 'Yeni Ay', `Expected phase name 'Yeni Ay', got ${newPos.phaseName}`);
  console.log('  -> Historical New Moon verified: OK');

  console.log('Lunar ephemeris tests completed.');
}

runMoonTests();
