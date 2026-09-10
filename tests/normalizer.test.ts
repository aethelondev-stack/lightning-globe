import { LightningNormalizer } from '../src/services/normalizer/LightningNormalizer';

console.log('--- RUNNING LIGHTNING NORMALIZER UNIT TESTS ---');

LightningNormalizer.resetMetrics();

// 1. Valid Canonical Packet
const validPacket = {
  id: 'test-101',
  timestamp: 1700000000000,
  latitude: 41.0082,
  longitude: 28.9784,
  peakCurrent: -45.5,
  type: 'CG',
  source: 'blitzortung'
};
const norm1 = LightningNormalizer.normalize(validPacket);
if (!norm1 || norm1.id !== 'test-101' || norm1.latitude !== 41.0082 || norm1.type !== 'CG') {
  throw new Error('Valid packet normalization failed!');
}
console.log('1. Valid packet test: PASS');

// 2. Boundary Values (Poles & Antimeridian)
const northPole = LightningNormalizer.normalize({ lat: 90, lon: 0 });
const southPole = LightningNormalizer.normalize({ lat: -90, lon: 0 });
const dateLineEast = LightningNormalizer.normalize({ lat: 0, lon: 180 });
const dateLineWest = LightningNormalizer.normalize({ lat: 0, lon: -180 });

if (!northPole || northPole.latitude !== 90 || !southPole || southPole.latitude !== -90) {
  throw new Error('Polar boundary coordinate test failed!');
}
if (!dateLineEast || dateLineEast.longitude !== 180 || !dateLineWest || dateLineWest.longitude !== -180) {
  throw new Error('Antimeridian boundary coordinate test failed!');
}
console.log('2. Boundary values (Poles and Dateline): PASS');

// 3. Invalid Latitude Rejection (>90, <-90, NaN)
const overNorth = LightningNormalizer.normalize({ lat: 90.001, lon: 10 });
const underSouth = LightningNormalizer.normalize({ lat: -91.5, lon: 10 });
const nanLat = LightningNormalizer.normalize({ lat: 'NaN_BAD', lon: 10 });

if (overNorth !== null || underSouth !== null || nanLat !== null) {
  throw new Error('Invalid latitude was not rejected!');
}
console.log('3. Invalid latitude rejection: PASS');

// 4. Invalid Longitude Rejection (>180, <-180, Infinity)
const overEast = LightningNormalizer.normalize({ lat: 10, lon: 180.01 });
const underWest = LightningNormalizer.normalize({ lat: 10, lon: -180.1 });
const infLon = LightningNormalizer.normalize({ lat: 10, lon: Infinity });

if (overEast !== null || underWest !== null || infLon !== null) {
  throw new Error('Invalid longitude was not rejected!');
}
console.log('4. Invalid longitude rejection: PASS');

// 5. Malformed / Non-object Input
const nullInput = LightningNormalizer.normalize(null);
const undefinedInput = LightningNormalizer.normalize(undefined);
const stringInput = LightningNormalizer.normalize('not a packet');
const numberInput = LightningNormalizer.normalize(12345);

if (nullInput !== null || undefinedInput !== null || stringInput !== null || numberInput !== null) {
  throw new Error('Malformed non-object input was not rejected!');
}
console.log('5. Malformed non-object rejection: PASS');

// 6. Current & Type Normalization
const icPacket = LightningNormalizer.normalize({
  lat: 20,
  lon: 30,
  current: '72.4',
  type: 'INTRACLOUD'
});
if (!icPacket || icPacket.type !== 'IC' || icPacket.peakCurrent !== 72.4) {
  throw new Error('Current parsing or IC type normalization failed!');
}
console.log('6. Current string parsing and IC type: PASS');

// 7. Metrics Verification
const metrics = LightningNormalizer.getMetrics();
console.log('7. Normalizer metrics:', metrics);
if (metrics.validCount !== 6 || metrics.rejectedCount !== 10) {
  throw new Error(`Metrics count mismatch! Valid: ${metrics.validCount}, Rejected: ${metrics.rejectedCount}`);
}

console.log('Lightning normalizer unit tests completed.');
