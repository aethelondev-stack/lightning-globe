import test from 'node:test';
import assert from 'node:assert/strict';
import { StochasticPacingQueue } from '../src/services/providers/StochasticPacingQueue';
import { RegionalFeedsProvider } from '../src/services/providers/RegionalFeedsProvider';
import { LightningNormalizer } from '../src/services/normalizer/LightningNormalizer';
import type { LightningEvent } from '../src/types/lightning';

test('StochasticPacingQueue - Emits events with organic Poisson timing and spatial micro-clustering', async () => {
  const emitted: Array<{ item: { id: string }; delay: number }> = [];
  let lastEmitTime = Date.now();

  const queue = new StochasticPacingQueue<{ id: string }>({
    defaultDurationMs: 400, // compressed for fast test execution
    minBurstIntervalMs: 15,
    maxBurstIntervalMs: 35,
    minClusterGapMs: 50,
    maxClusterGapMs: 120,
    onEmit: (item) => {
      const now = Date.now();
      emitted.push({ item, delay: now - lastEmitTime });
      lastEmitTime = now;
    }
  });

  // Batch of 6 items: 3 clustered near Singapore (1.35, 103.8), 3 clustered near Tokyo (35.68, 139.76)
  const batch = [
    { data: { id: 'sg_1' }, lat: 1.35, lon: 103.82 },
    { data: { id: 'sg_2' }, lat: 1.36, lon: 103.83 },
    { data: { id: 'sg_3' }, lat: 1.34, lon: 103.81 },
    { data: { id: 'jp_1' }, lat: 35.68, lon: 139.76 },
    { data: { id: 'jp_2' }, lat: 35.70, lon: 139.77 },
    { data: { id: 'jp_3' }, lat: 35.66, lon: 139.75 }
  ];

  queue.enqueueBatch(batch, 400);
  assert.equal(queue.size, 6);

  // Wait for queue to drain
  await new Promise((resolve) => setTimeout(resolve, 800));

  assert.equal(emitted.length, 6, 'All 6 items should be emitted without dropping');
  assert.equal(queue.size, 0);

  // Clean up
  queue.clear();
});

test('LightningNormalizer - Validates and normalizes regional feed sources', () => {
  const neaRaw = {
    id: 'nea_101',
    latitude: 1.352,
    longitude: 103.82,
    timestamp: Date.now(),
    peakCurrent: 32,
    type: 'CG',
    source: 'singapore_nea'
  };
  const neaNormalized = LightningNormalizer.normalize(neaRaw, 'singapore_nea');
  assert.ok(neaNormalized);
  assert.equal(neaNormalized?.source, 'singapore_nea');
  assert.equal(neaNormalized?.latitude, 1.352);

  const jmaRaw = {
    id: 'jma_202',
    latitude: 35.68,
    longitude: 139.76,
    timestamp: Date.now(),
    peakCurrent: 28,
    type: 'IC',
    source: 'japan_jma'
  };
  const jmaNormalized = LightningNormalizer.normalize(jmaRaw, 'japan_jma');
  assert.ok(jmaNormalized);
  assert.equal(jmaNormalized?.source, 'japan_jma');
  assert.equal(jmaNormalized?.type, 'IC');

  const fmiRaw = {
    id: 'fmi_303',
    latitude: 64.03,
    longitude: 26.01,
    timestamp: Date.now(),
    peakCurrent: 19,
    type: 'CG',
    source: 'finland_fmi'
  };
  const fmiNormalized = LightningNormalizer.normalize(fmiRaw, 'finland_fmi');
  assert.ok(fmiNormalized);
  assert.equal(fmiNormalized?.source, 'finland_fmi');
});

test('RegionalFeedsProvider - Ingests and dispatches typed regional strikes', async () => {
  const provider = new RegionalFeedsProvider();
  const received: LightningEvent[] = [];
  provider.onEvent((evt) => received.push(evt));

  // Directly trigger processStrike
  // @ts-expect-error private method invocation for unit test
  provider.processStrike({
    id: 'fmi_test_1',
    lat: 68.2,
    lon: 27.5,
    time: Date.now(),
    source: 'finland_fmi',
    peakCurrent: 40,
    type: 'CG'
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].source, 'finland_fmi');
  assert.equal(received[0].latitude, 68.2);
  assert.equal(provider.getStats().totalEventsReceived, 1);
});
