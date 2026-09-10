import test from 'node:test';
import assert from 'node:assert/strict';
import { GoesGlmProvider } from '../src/services/providers/GoesGlmProvider';

test('GoesGlmProvider - Optical flash normalization and scientific energy proxy', () => {
  const provider = new GoesGlmProvider({ enableSimulationFallback: false });

  // Test optical flash ingestion
  const flash = {
    id: 'glm_flash_test_01',
    lat: -3.12,
    lon: -60.02,
    time: 1700000000000,
    energy_j: 4.5e-12, // Optical radiant energy in Joules
    area_km2: 350
  };

  const event = provider.processGlmFlash(flash);
  assert.ok(event, 'Event should be successfully created');
  assert.equal(event.id, 'glm_flash_test_01');
  assert.equal(event.latitude, -3.12);
  assert.equal(event.longitude, -60.02);
  assert.equal(event.source, 'goes19_glm');
  assert.equal(event.opticalEnergy, 4.5e-12);
  assert.equal(event.opticalArea, 350);

  // Peak current proxy should be calculated from optical energy
  assert.ok(event.peakCurrent >= 15 && event.peakCurrent <= 240, `Peak current proxy should be bounded: ${event.peakCurrent}`);
});

test('GoesGlmProvider - Extreme energy clamping to prevent unrealistic values', () => {
  const provider = new GoesGlmProvider({ enableSimulationFallback: false });

  // Very high optical energy
  const superFlash = {
    lat: 10.5,
    lon: -75.2,
    energy_j: 1.0, // Unusually huge energy
    area_km2: 2500
  };

  const event = provider.processGlmFlash(superFlash);
  assert.ok(event);
  assert.ok(event.peakCurrent <= 240, 'Should clamp to 240 kA max');
  assert.equal(event.source, 'goes19_glm');
});

test('GoesGlmProvider - Lifecycle and status transitions', async () => {
  const provider = new GoesGlmProvider({ enableSimulationFallback: true });
  assert.equal(provider.status, 'OFFLINE');

  const statuses: string[] = [];
  provider.onStatusChange((st) => statuses.push(st));

  await provider.connect();
  assert.ok((provider.status as string) === 'LIVE' || (provider.status as string) === 'CONNECTING');

  const stats = provider.getStats();
  assert.ok(stats.activeSources?.includes('goes19_glm'));

  provider.disconnect();
  assert.equal(provider.status, 'OFFLINE');
});
