import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { UnifiedLightningHub } from '../server/UnifiedLightningHub';
import { UnifiedStreamProvider } from '../src/services/providers/UnifiedStreamProvider';
import type { LightningEvent } from '../src/types/lightning';

const TEST_CACHE_FILE = path.resolve(process.cwd(), '.cache', 'test_unified_hub.json');
const TEST_CACHE_PACING = path.resolve(process.cwd(), '.cache', 'test_pacing.json');

test('UnifiedLightningHub: Instant RF Pass-Through (0 ms Latency)', () => {
  try { if (fs.existsSync(TEST_CACHE_FILE)) fs.unlinkSync(TEST_CACHE_FILE); } catch {}

  const hub = new UnifiedLightningHub({
    cacheFilePath: TEST_CACHE_FILE,
    enableAutoStart: false,
    enableNetwork: false,
    satellitePacingIntervalMs: 50,
    backfillOnStart: false
  });

  const receivedStrikes: LightningEvent[] = [];
  const unsub = hub.onStrike((s) => {
    receivedStrikes.push(s);
  });

  const testRfStrike: LightningEvent = {
    id: 'rf_test_101',
    latitude: 48.137,
    longitude: 11.576,
    timestamp: Date.now(),
    peakCurrent: 45,
    type: 'CG',
    source: 'blitzortung'
  };

  const beforeTime = performance.now();
  hub.ingestRfStrike(testRfStrike);
  const latencyMs = performance.now() - beforeTime;

  // 1. Instant latency: processed synchronously (< 5ms in test runner)
  assert.ok(latencyMs < 10, `RF strike must pass through with near-zero latency, got ${latencyMs.toFixed(2)}ms`);

  // 2. Received immediately
  assert.equal(receivedStrikes.length, 1);
  assert.equal(receivedStrikes[0].id, 'rf_test_101');
  assert.equal(receivedStrikes[0].source, 'blitzortung');

  // 3. Telemetry reflects instant RF count and empty pacing queue (never queued!)
  const stats = hub.getStats();
  assert.equal(stats.rfInstantCount, 1);
  assert.equal(stats.pacingQueueSize, 0, 'RF strike must NEVER be placed in satellite pacing queue');

  unsub();
  hub.stop();
  try { if (fs.existsSync(TEST_CACHE_FILE)) fs.unlinkSync(TEST_CACHE_FILE); } catch {}
});

test('UnifiedLightningHub: Satellite Paced Delivery (Kademeli Yayma & Zero Cropping)', async () => {
  try { if (fs.existsSync(TEST_CACHE_PACING)) fs.unlinkSync(TEST_CACHE_PACING); } catch {}

  const hub = new UnifiedLightningHub({
    cacheFilePath: TEST_CACHE_PACING,
    enableAutoStart: false,
    enableNetwork: false,
    satellitePacingIntervalMs: 25, // Fast test cadence (25ms per tick)
    backfillOnStart: false
  });

  const emittedStrikes: LightningEvent[] = [];
  const micropackets: LightningEvent[][] = [];

  hub.onStrike((s) => emittedStrikes.push(s));
  hub.onMicropacket((batch) => micropackets.push(batch));

  // Batch of 12 satellite flashes from GOES-16 GLM
  const now = Date.now();
  const rawFlashes: LightningEvent[] = [];
  for (let i = 0; i < 12; i++) {
    rawFlashes.push({
      id: `goes16_test_flash_${i}_${now}`,
      latitude: -3.46 + i * 0.1,
      longitude: -62.21 + i * 0.1,
      timestamp: now - (12 - i) * 1000,
      peakCurrent: 30,
      type: 'IC',
      source: 'goes16_glm',
      opticalEnergy: 1.2e-14,
      opticalArea: 45
    });
  }

  // Pace 12 flashes across 200ms duration (approx 8 ticks of 25ms)
  hub.ingestSatelliteBatch(rawFlashes, 200);

  // Immediately after ingestion: queue holds flashes, none dumped all at once
  assert.ok(hub.getStats().pacingQueueSize > 0, 'Satellite flashes must be queued for pacing');

  // Wait for pacing timer to dispatch all micropackets
  await new Promise((resolve) => setTimeout(resolve, 400));

  // 1. Zero Cropping Rule: 100% of the 12 flashes must be emitted
  assert.equal(emittedStrikes.length, 12, 'All 12 satellite flashes must be dispatched without cropping or loss');
  assert.equal(hub.getStats().satellitePacedCount, 12);
  assert.equal(hub.getStats().pacingQueueSize, 0, 'Queue must be cleanly drained');

  // 2. Paced Micro-packets: Flashes arrived in multiple separate micropackets, not dumped at once
  assert.ok(micropackets.length >= 2, `Expected at least 2 paced micropackets, got ${micropackets.length}`);

  hub.stop();
  try { if (fs.existsSync(TEST_CACHE_PACING)) fs.unlinkSync(TEST_CACHE_PACING); } catch {}
});

test('UnifiedLightningHub: 24-Hour Historical Window & Disk Persistence', async () => {
  try { if (fs.existsSync(TEST_CACHE_FILE)) fs.unlinkSync(TEST_CACHE_FILE); } catch {}

  const hub1 = new UnifiedLightningHub({
    cacheFilePath: TEST_CACHE_FILE,
    enableAutoStart: false,
    enableNetwork: false,
    backfillOnStart: false
  });

  const now = Date.now();
  const strike1hAgo: LightningEvent = {
    id: 'hist_1h',
    latitude: 10.0,
    longitude: 20.0,
    timestamp: now - 1 * 3600 * 1000,
    peakCurrent: 25,
    type: 'CG',
    source: 'blitzortung'
  };

  const strike12hAgo: LightningEvent = {
    id: 'hist_12h',
    latitude: -15.0,
    longitude: -45.0,
    timestamp: now - 12 * 3600 * 1000,
    peakCurrent: 40,
    type: 'IC',
    source: 'goes19_glm'
  };

  const strike26hAgo: LightningEvent = {
    id: 'hist_26h_stale',
    latitude: 65.0,
    longitude: 25.0,
    timestamp: now - 26 * 3600 * 1000, // Older than 24h
    peakCurrent: 15,
    type: 'CG',
    source: 'finland_fmi'
  };

  hub1.ingestRfStrike(strike1hAgo);
  hub1.ingestRegionalStrike(strike26hAgo);
  hub1.ingestSatelliteBatch([strike12hAgo]);

  // Query 24h history
  const history24h = hub1.get24hHistory();
  const historyIds = history24h.map((s) => s.id);

  assert.ok(historyIds.includes('hist_1h'), 'Strike from 1h ago must be present');
  assert.ok(historyIds.includes('hist_12h'), 'Strike from 12h ago must be present');
  assert.ok(!historyIds.includes('hist_26h_stale'), 'Strike from 26h ago must be pruned by 24h window');

  // Save to disk asynchronously
  await hub1.saveToDiskCache();
  assert.ok(fs.existsSync(TEST_CACHE_FILE), 'Disk cache file must exist');

  hub1.stop();

  // Load in fresh hub instance
  const hub2 = new UnifiedLightningHub({
    cacheFilePath: TEST_CACHE_FILE,
    enableAutoStart: false,
    enableNetwork: false,
    backfillOnStart: false
  });

  const loadedHistory = hub2.get24hHistory();
  const loadedIds = loadedHistory.map((s) => s.id);

  assert.ok(loadedIds.includes('hist_1h'));
  assert.ok(loadedIds.includes('hist_12h'));
  assert.ok(!loadedIds.includes('hist_26h_stale'));

  hub2.stop();

  // Clean up test cache
  try { if (fs.existsSync(TEST_CACHE_FILE)) fs.unlinkSync(TEST_CACHE_FILE); } catch {}
});

test('UnifiedStreamProvider: Client Ingestion of Instant and Paced SSE Packets', async () => {
  const provider = new UnifiedStreamProvider();
  const received: LightningEvent[] = [];

  provider.onEvent((evt) => received.push(evt));

  // 1. Simulate instant RF SSE message
  const rfMessage = JSON.stringify({
    type: 'strike',
    event: {
      id: 'sse_rf_1',
      latitude: 1.35,
      longitude: 103.82,
      timestamp: Date.now(),
      peakCurrent: 30,
      type: 'CG',
      source: 'blitzortung'
    }
  });

  provider.handleRawMessage(rfMessage);
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'sse_rf_1');

  // 2. Simulate paced satellite micro-packet
  const batchMessage = JSON.stringify({
    type: 'batch',
    events: [
      {
        id: 'sse_sat_1',
        latitude: -10.5,
        longitude: -55.2,
        timestamp: Date.now(),
        peakCurrent: 20,
        type: 'IC',
        source: 'goes16_glm'
      },
      {
        id: 'sse_sat_2',
        latitude: -10.6,
        longitude: -55.3,
        timestamp: Date.now(),
        peakCurrent: 25,
        type: 'IC',
        source: 'goes16_glm'
      }
    ]
  });

  provider.handleRawMessage(batchMessage);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(received.length, 3);
  assert.equal(received[1].id, 'sse_sat_1');
  assert.equal(received[2].id, 'sse_sat_2');
  assert.equal(provider.getStats().totalEventsReceived, 3);

  // 3. Simulate satellite micropacket type (hub dispatch format)
  const microMessage = JSON.stringify({
    type: 'micropacket',
    count: 1,
    events: [
      {
        id: 'sse_micro_1',
        latitude: -12.1,
        longitude: -45.6,
        timestamp: Date.now(),
        peakCurrent: 28,
        type: 'IC',
        source: 'goes16_glm'
      }
    ]
  });

  provider.handleRawMessage(microMessage);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(received.length, 4);
  assert.equal(received[3].id, 'sse_micro_1');
  assert.equal(provider.getStats().totalEventsReceived, 4);
});

test('UnifiedStreamProvider: fetch24hHistory retrieves and normalizes 24h archive', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url: any) => {
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          count: 2,
          strikes: [
            { id: 'fmi_1', latitude: 60.1, longitude: 24.9, timestamp: Date.now() - 10000, peakCurrent: 30, type: 'CG', source: 'finland_fmi' },
            { id: 'goes_1', latitude: -5.2, longitude: -50.1, timestamp: Date.now() - 5000, peakCurrent: 20, type: 'IC', source: 'goes16_glm' }
          ]
        })
      } as any;
    }) as any;

    const provider = new UnifiedStreamProvider();
    const history = await provider.fetch24hHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].id, 'fmi_1');
    assert.equal(history[1].id, 'goes_1');
  } finally {
    globalThis.fetch = origFetch;
  }
});
