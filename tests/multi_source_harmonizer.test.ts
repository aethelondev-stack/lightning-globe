import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiSourceHarmonizer } from '../src/services/providers/MultiSourceHarmonizer';
import { LiveStreamProvider } from '../src/services/providers/LiveStreamProvider';
import { GoesGlmProvider } from '../src/services/providers/GoesGlmProvider';
import type { LightningEvent } from '../src/types/lightning';

test('MultiSourceHarmonizer - Cross-source spatial-temporal fusion into hybrid strike', async () => {
  const rfProvider = new LiveStreamProvider({ enableSyntheticFallback: false });
  const satProvider = new GoesGlmProvider({ enableSimulationFallback: false });

  const harmonizer = new MultiSourceHarmonizer({
    rfProvider,
    satProvider,
    defaultMode: 'ALL_HYBRID',
    spatialThresholdKm: 35.0,
    temporalThresholdMs: 1200
  });

  const emittedEvents: LightningEvent[] = [];
  harmonizer.onEvent((evt) => emittedEvents.push(evt));

  await harmonizer.connect();

  const now = Date.now();

  // 1. Send ground RF strike from Blitzortung
  const rfStrike: LightningEvent = {
    id: 'rf_strike_101',
    latitude: 25.76,
    longitude: -80.19, // Miami, FL
    timestamp: now,
    peakCurrent: 45.5,
    type: 'CG',
    source: 'blitzortung'
  };

  // 2. Send optical satellite flash from GOES-16 GLM at practically the same place & time (15 km, 200 ms later)
  const satFlash: LightningEvent = {
    id: 'glm_flash_202',
    latitude: 25.85,
    longitude: -80.25,
    timestamp: now + 200,
    peakCurrent: 52.0,
    type: 'CG',
    source: 'goes16_glm',
    opticalEnergy: 6.2e-12,
    opticalArea: 420
  };

  // Dispatch RF first, then Satellite
  // Directly simulate provider callbacks through harmonizer's internal listeners
  // @ts-expect-error private method test invocation
  harmonizer.handleRfEvent(rfStrike);

  assert.equal(emittedEvents.length, 1);
  assert.equal(emittedEvents[0].source, 'blitzortung');

  // @ts-expect-error private method test invocation
  harmonizer.handleSatEvent(satFlash);

  // The satellite event should match the buffered RF event and emit a fused HYBRID strike!
  assert.equal(emittedEvents.length, 2);
  const fused = emittedEvents[1];
  assert.equal(fused.source, 'hybrid');
  assert.equal(fused.peakCurrent, 45.5, 'Should retain RF ground current');
  assert.equal(fused.opticalEnergy, 6.2e-12, 'Should enrich with satellite optical energy');
  assert.equal(fused.opticalArea, 420, 'Should enrich with satellite footprint area');

  const stats = harmonizer.getStats();
  assert.equal(stats.fusedEventsCount, 1, 'fused count should increment');

  harmonizer.disconnect();
});

test('MultiSourceHarmonizer - Mode filtering (BLITZORTUNG_ONLY and GOES16_ONLY)', () => {
  const rfProvider = new LiveStreamProvider({ enableSyntheticFallback: false });
  const satProvider = new GoesGlmProvider({ enableSimulationFallback: false });

  const harmonizer = new MultiSourceHarmonizer({
    rfProvider,
    satProvider,
    defaultMode: 'BLITZORTUNG_ONLY'
  });

  const emitted: LightningEvent[] = [];
  harmonizer.onEvent((evt) => emitted.push(evt));

  const rfStrike: LightningEvent = {
    id: 'rf_1',
    latitude: 48.85,
    longitude: 2.35,
    timestamp: Date.now(),
    peakCurrent: 30,
    type: 'CG',
    source: 'blitzortung'
  };

  const satFlash: LightningEvent = {
    id: 'sat_1',
    latitude: 10.0,
    longitude: -70.0,
    timestamp: Date.now(),
    peakCurrent: 28,
    type: 'CG',
    source: 'goes16_glm'
  };

  // In BLITZORTUNG_ONLY mode
  // @ts-expect-error private test invocation
  harmonizer.handleRfEvent(rfStrike);
  // @ts-expect-error private test invocation
  harmonizer.handleSatEvent(satFlash);

  assert.equal(emitted.length, 1, 'Only RF strike should be emitted');
  assert.equal(emitted[0].id, 'rf_1');

  // Switch to GOES16_ONLY mode
  harmonizer.setMode('GOES16_ONLY');
  // @ts-expect-error private test invocation
  harmonizer.handleRfEvent(rfStrike);
  // @ts-expect-error private test invocation
  harmonizer.handleSatEvent(satFlash);

  assert.equal(emitted.length, 2, 'Satellite flash should now be emitted');
  assert.equal(emitted[1].id, 'sat_1');

  harmonizer.disconnect();
});

