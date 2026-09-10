import {
  latLngToVector3,
  vector3ToLatLng,
  haversineDistanceKm,
  haversineAngularDistance
} from '../src/utils/coordinates';

console.log('--- RUNNING COORDINATE MATH VERIFICATION ---');

// Test 1: North Pole
const northPole = latLngToVector3(90, 0, 0, 100);
console.log('1. North Pole (90, 0):', northPole);
if (Math.abs(northPole.y - 100) > 0.001 || Math.abs(northPole.x) > 0.001) {
  throw new Error('North Pole conversion failed!');
}

// Test 2: South Pole
const southPole = latLngToVector3(-90, 0, 0, 100);
console.log('2. South Pole (-90, 0):', southPole);
if (Math.abs(southPole.y - (-100)) > 0.001 || Math.abs(southPole.x) > 0.001) {
  throw new Error('South Pole conversion failed!');
}

// Test 3: Equator Prime Meridian (0, 0)
const equatorZero = latLngToVector3(0, 0, 0, 100);
console.log('3. Equator (0, 0):', equatorZero);
if (Math.abs(equatorZero.z - 100) > 0.001) {
  throw new Error('Equator (0,0) Z-axis alignment failed!');
}

// Test 4: Round-trip conversion (Istanbul: 41.0082, 28.9784)
const istVec = latLngToVector3(41.0082, 28.9784, 0, 100);
const istRoundTrip = vector3ToLatLng(istVec, 100);
console.log('4. Istanbul Roundtrip:', istRoundTrip);
if (
  Math.abs(istRoundTrip.lat - 41.0082) > 0.01 ||
  Math.abs(istRoundTrip.lng - 28.9784) > 0.01
) {
  throw new Error('Istanbul roundtrip precision loss!');
}

// Test 5: Haversine distance known reference (Istanbul to London ~ 2500 km)
const distIstLondon = haversineDistanceKm(41.0082, 28.9784, 51.5074, -0.1278);
console.log('5. Distance Istanbul -> London (km):', distIstLondon.toFixed(1));
if (distIstLondon < 2400 || distIstLondon > 2600) {
  throw new Error('Haversine distance calculation is out of expected physical range!');
}

console.log('Coordinate mathematics tests completed.');
