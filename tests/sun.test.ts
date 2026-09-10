import { getSolarPosition } from '../src/utils/sun';

console.log('--- RUNNING ASTRONOMICAL SOLAR POSITION TESTS ---');

// Test 1: Midday at Greenwich (12:00:00 UTC) -> Sun subsolar longitude must be approximately 0°
const middayGreenwich = new Date(Date.UTC(2026, 5, 21, 12, 0, 0)); // June 21, 12:00 UTC
const sunMidday = getSolarPosition(middayGreenwich);
console.log('1. Midday Greenwich subsolar lon:', sunMidday.longitude);
if (Math.abs(sunMidday.longitude) > 0.1) {
  throw new Error(`Expected subsolar longitude ~0 at 12:00 UTC, got ${sunMidday.longitude}`);
}

// Test 2: Summer Solstice Declination (~June 21) -> Declination must be ~ +23.44°
console.log('2. Summer Solstice declination:', sunMidday.latitude);
if (Math.abs(sunMidday.latitude - 23.44) > 1.0) {
  throw new Error(`Expected declination near +23.44°, got ${sunMidday.latitude}`);
}

// Test 3: Midnight at Greenwich (00:00:00 UTC) -> Sun subsolar longitude must be ~180° / -180°
const midnightGreenwich = new Date(Date.UTC(2026, 8, 5, 0, 0, 0));
const sunMidnight = getSolarPosition(midnightGreenwich);
console.log('3. Midnight Greenwich subsolar lon:', sunMidnight.longitude);
if (Math.abs(Math.abs(sunMidnight.longitude) - 180) > 0.1) {
  throw new Error(`Expected subsolar longitude ~180 at 00:00 UTC, got ${sunMidnight.longitude}`);
}

// Test 4: Unit direction vector length must be exactly 1.0
console.log('4. Direction vector length:', sunMidday.direction.length());
if (Math.abs(sunMidday.direction.length() - 1.0) > 0.001) {
  throw new Error(`Direction vector must be normalized to length 1.0, got ${sunMidday.direction.length()}`);
}

console.log('Solar position calculations test finished.');
