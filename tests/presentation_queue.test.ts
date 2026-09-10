import test from 'node:test';
import assert from 'node:assert/strict';
import { StochasticRingBufferQueue } from '../src/services/queue/StochasticRingBufferQueue';
import { StormCellBatcher } from '../src/services/clustering/StormCellBatcher';
import type { LightningEvent } from '../src/types/lightning';

function createMockStrike(id: string, lat: number, lon: number, source: any = 'goes16_glm'): LightningEvent {
  return {
    id,
    latitude: lat,
    longitude: lon,
    timestamp: Date.now(),
    peakCurrent: 25,
    type: 'CG',
    source
  };
}

test('StochasticRingBufferQueue: Blitzortung RF strikes bypass satellite pacing with 0ms delay', () => {
  const queue = new StochasticRingBufferQueue({ maxSatellitePerFrame: 2 });
  const emitted: LightningEvent[] = [];

  const rfStrike1 = createMockStrike('rf-1', 41.0, 28.9, 'blitzortung');
  const rfStrike2 = createMockStrike('rf-2', 40.0, 32.0, 'blitzortung');

  // Enqueue instant RF strikes
  queue.enqueueInstantRf(rfStrike1);
  queue.enqueueInstantRf(rfStrike2);

  assert.equal(queue.size, 2);

  // Update immediately
  const count = queue.update(Date.now(), (e) => emitted.push(e));

  assert.equal(count, 2);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].id, 'rf-1');
  assert.equal(emitted[1].id, 'rf-2');
  assert.equal(queue.size, 0);
});

test('StochasticRingBufferQueue: Satellite batch spreads across duration window without single-frame dump', () => {
  const queue = new StochasticRingBufferQueue({ maxSatellitePerFrame: 2 });
  const flashes: LightningEvent[] = [];

  for (let i = 0; i < 50; i++) {
    flashes.push(createMockStrike(`sat-${i}`, -15.0 + i * 0.1, -50.0 + i * 0.1, 'goes16_glm'));
  }

  const durationMs = 20000;
  const startTime = Date.now();
  queue.enqueueBatch(flashes, durationMs);

  assert.equal(queue.size, 50);

  // Immediate frame update at startTime: should NOT emit all 50 strikes!
  const emittedAtStart: LightningEvent[] = [];
  queue.update(startTime, (e) => emittedAtStart.push(e));

  // Even if some random timestamps were scheduled <= startTime, Burst-Guard caps at max 2
  assert.ok(emittedAtStart.length <= 2, `Emitted too many strikes at start: ${emittedAtStart.length}`);
  assert.ok(queue.size >= 48, `Queue should retain remaining strikes, size: ${queue.size}`);
});

test('StochasticRingBufferQueue: Burst-Guard rate limiter strictly caps satellite strikes per frame', () => {
  const queue = new StochasticRingBufferQueue({ maxSatellitePerFrame: 2 });
  const now = Date.now();

  // Enqueue 10 satellite strikes all scheduled in the past (targetTime <= now)
  for (let i = 0; i < 10; i++) {
    queue.enqueue(createMockStrike(`forced-${i}`, 10, 10, 'goes18_glm'), now - 50, false);
  }

  assert.equal(queue.size, 10);

  const frame1: LightningEvent[] = [];
  const emitted1 = queue.update(now, (e) => frame1.push(e));

  // Must strictly emit exactly maxSatellitePerFrame (2)
  assert.equal(emitted1, 2);
  assert.equal(frame1.length, 2);
  assert.equal(queue.size, 8);

  // Next frame: emits next 2
  const frame2: LightningEvent[] = [];
  const emitted2 = queue.update(now, (e) => frame2.push(e));
  assert.equal(emitted2, 2);
  assert.equal(frame2.length, 2);
  assert.equal(queue.size, 6);
});

test('StochasticRingBufferQueue: Integrates with StormCellBatcher for smooth organic petek growth', () => {
  const queue = new StochasticRingBufferQueue({ maxSatellitePerFrame: 1 });
  const batcher = new StormCellBatcher({ windowMs: 30000, minStrikes: 5, spatialRadiusKm: 150 });

  const now = 100000;
  // Enqueue 7 strikes all in Istanbul area (within 10km of each other)
  for (let i = 0; i < 7; i++) {
    queue.enqueue(createMockStrike(`ist-${i}`, 41.0 + i * 0.01, 28.9 + i * 0.01, 'goes16_glm'), now - 100, false);
  }

  let currentTime = now;

  // Frame 1 to 4: 1 strike per frame -> petek not yet born (< 5 strikes)
  for (let frame = 1; frame <= 4; frame++) {
    currentTime += 1100;
    queue.update(currentTime, (e) => batcher.addStrike(e));
    const cells = batcher.getActiveStormCells(currentTime);
    assert.equal(cells.length, 0, `Petek should not exist at frame ${frame}`);
  }

  // Frame 5: 5th strike enters -> Petek is born!
  currentTime += 1100;
  queue.update(currentTime, (e) => batcher.addStrike(e));
  const cellsAtBirth = batcher.getActiveStormCells(currentTime);
  assert.equal(cellsAtBirth.length, 1, 'Petek must be born on the 5th strike');
  assert.ok(cellsAtBirth[0].boundingRadiusKm >= 20, 'Birth radius must be at least minRadiusKm (20km)');
  const birthRadius = cellsAtBirth[0].boundingRadiusKm;

  // Frame 6: 6th strike enters -> Petek grows smoothly!
  currentTime += 1100;
  queue.update(currentTime, (e) => batcher.addStrike(e));
  const cellsAfterGrowth = batcher.getActiveStormCells(currentTime);
  assert.equal(cellsAfterGrowth.length, 1);
  assert.ok(cellsAfterGrowth[0].boundingRadiusKm >= birthRadius, 'Petek radius must grow with incoming strikes');
});

test('StochasticRingBufferQueue: RF Burst-Guard caps RF strikes per frame to prevent frame-spike freezes', () => {
  const queue = new StochasticRingBufferQueue({ maxRfPerFrame: 3 });
  const emitted: LightningEvent[] = [];

  // Enqueue 7 instant RF strikes at once (simulating network backlog or lag burst)
  for (let i = 1; i <= 7; i++) {
    queue.enqueueInstantRf(createMockStrike(`rf-burst-${i}`, 41.0, 29.0, 'blitzortung'));
  }

  assert.equal(queue.size, 7);

  // Frame 1: must emit exactly 3 strikes (maxRfPerFrame)
  const countF1 = queue.update(Date.now(), (e) => emitted.push(e));
  assert.equal(countF1, 3);
  assert.equal(emitted.length, 3);
  assert.equal(queue.size, 4);

  // Frame 2: must emit next 3 strikes
  const countF2 = queue.update(Date.now() + 16, (e) => emitted.push(e));
  assert.equal(countF2, 3);
  assert.equal(emitted.length, 6);
  assert.equal(queue.size, 1);

  // Frame 3: must emit remaining 1 strike (Zero Data Loss)
  const countF3 = queue.update(Date.now() + 32, (e) => emitted.push(e));
  assert.equal(countF3, 1);
  assert.equal(emitted.length, 7);
  assert.equal(queue.size, 0);

  // Check strike order preserved
  assert.equal(emitted[0].id, 'rf-burst-1');
  assert.equal(emitted[6].id, 'rf-burst-7');
});

