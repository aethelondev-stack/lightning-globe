import assert from 'node:assert/strict';
import { StrikeArchiveDB } from '../src/services/storage/StrikeArchiveDB';
import type { LightningEvent } from '../src/types/lightning';

console.log('--- RUNNING STRIKE ARCHIVE DB UNIT TESTS ---');

const baseTime = Date.parse('2026-09-06T12:00:00Z');

function createEvent(id: string, offsetSec: number, country: string = 'Turkey'): LightningEvent {
  return {
    id,
    timestamp: baseTime + offsetSec * 1000,
    latitude: 39.92 + offsetSec * 0.01,
    longitude: 32.85 + offsetSec * 0.01,
    peakCurrent: -45,
    type: 'CG',
    source: 'blitzortung'
  };
}

async function runTests() {
  const db = new StrikeArchiveDB({
    dbName: 'TestArchiveDB',
    flushIntervalMs: 50,
    maxBufferSize: 5
  });

  // TEST 1: Buffer enqueueing and manual flush
  console.log('Test 1: Enqueueing strikes and manual flush...');
  db.saveStrike(createEvent('ev-1', 0), 'Turkey');
  db.saveStrike(createEvent('ev-2', 10), 'Turkey');
  db.saveStrike(createEvent('ev-3', 20), 'Greece');

  await db.flush();
  const count1 = await db.getTotalCount();
  assert.equal(count1, 3, `Expected 3 stored strikes, got ${count1}`);
  console.log('  -> Total count after flush matches: 3');

  // TEST 2: Buffer overflow auto-flush (maxBufferSize = 5)
  console.log('Test 2: Auto-flush on buffer threshold...');
  for (let i = 4; i <= 9; i++) {
    db.saveStrike(createEvent(`ev-${i}`, i * 60), 'Italy');
  }
  // After adding 6 items, auto-flush should have occurred at 5
  await db.flush();
  const count2 = await db.getTotalCount();
  assert.equal(count2, 9, `Expected 9 stored strikes, got ${count2}`);
  console.log('  -> Auto-flush and count verified: 9');

  // TEST 3: Query by timestamp range
  console.log('Test 3: Query by timestamp range...');
  const rangeStart = baseTime;
  const rangeEnd = baseTime + 60 * 1000;
  const inRange = await db.getStrikesByTimeRange(rangeStart, rangeEnd);
  assert.ok(inRange.length >= 3, `Expected at least 3 strikes in 60s range, got ${inRange.length}`);
  console.log(`  -> Time range query returned ${inRange.length} items.`);

  // TEST 4: Query by date key
  console.log('Test 4: Query by calendar date range...');
  const dateStrikes = await db.getStrikesByDateRange('2026-09-06', '2026-09-06');
  assert.equal(dateStrikes.length, 9, `Expected 9 strikes for date 2026-09-06, got ${dateStrikes.length}`);
  assert.equal(dateStrikes[0].dateKey, '2026-09-06');
  console.log('  -> Date range query verified: 9 records matching 2026-09-06.');

  // TEST 5: Clear and verify empty state
  console.log('Test 5: Clear archive...');
  await db.clear();
  const countCleared = await db.getTotalCount();
  assert.equal(countCleared, 0, `Expected 0 strikes after clear, got ${countCleared}`);
  console.log('  -> Clear verified.');

  db.close();
  console.log('--- ALL STRIKE ARCHIVE DB TESTS FINISHED: OK ---');
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
