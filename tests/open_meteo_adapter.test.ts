import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenMeteoProvider } from '../src/services/providers/OpenMeteoProvider';

test('OpenMeteoProvider - Thermodynamic calculation and risk categorization', () => {
  const provider = new OpenMeteoProvider({ enableNetworkFetch: false });

  // Test tropical convective coordinates (Manaus, Amazon)
  const tropicalPoint = provider.calculateThermodynamicModel(-3.1, -60.0, Date.now());

  assert.equal(tropicalPoint.latitude, -3.1);
  assert.equal(tropicalPoint.longitude, -60.0);
  assert.ok(tropicalPoint.cape >= 0, 'CAPE should be non-negative');
  assert.ok(tropicalPoint.potentialScore >= 0 && tropicalPoint.potentialScore <= 1.0, 'Score in [0, 1]');
  assert.ok(
    ['LOW', 'MODERATE', 'HIGH', 'EXTREME'].includes(tropicalPoint.riskLevel),
    `Valid risk level: ${tropicalPoint.riskLevel}`
  );
});

test('OpenMeteoProvider - In-memory cache hit prevents redundant calculations', async () => {
  const provider = new OpenMeteoProvider({ enableNetworkFetch: false, cacheTtlMs: 60000 });

  const p1 = await provider.getPotential(28.5, -81.5);
  const p2 = await provider.getPotential(28.5, -81.5);

  assert.equal(p1.timestamp, p2.timestamp, 'Cached item should return exact same object reference/timestamp');
});

test('OpenMeteoProvider - Global convective hotspots enumeration', async () => {
  const provider = new OpenMeteoProvider({ enableNetworkFetch: false });

  const hotspots = await provider.getGlobalHotspotsPotential();
  assert.ok(hotspots.length >= 8, 'Should cover major global convective storm hotspots');

  for (const spot of hotspots) {
    assert.ok(Number.isFinite(spot.latitude));
    assert.ok(Number.isFinite(spot.longitude));
    assert.ok(spot.cape >= 0);
  }
});
