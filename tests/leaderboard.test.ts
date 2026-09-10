import test from 'node:test';
import assert from 'node:assert/strict';
import { CountryLeaderboard, type StorageAdapter } from '../src/services/analytics/CountryLeaderboard';

class MemoryStorage implements StorageAdapter {
  private data: Map<string, string> = new Map();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

test('CountryLeaderboard: records strikes and generates ordered rankings with percentages', () => {
  const storage = new MemoryStorage();
  const board = new CountryLeaderboard(storage);
  const now = Date.parse('2026-09-06T12:00:00Z');

  // Record 5 strikes in USA
  for (let i = 0; i < 5; i++) {
    board.recordStrike(35, -90, now, { country: 'United States', iso: 'US', flag: '🇺🇸' });
  }

  // Record 12 strikes in Congo
  for (let i = 0; i < 12; i++) {
    board.recordStrike(0, 25, now, { country: 'Dem. Rep. Congo', iso: 'CD', flag: '🇨🇩' });
  }

  // Record 3 strikes in Brazil
  for (let i = 0; i < 3; i++) {
    board.recordStrike(-15, -50, now, { country: 'Brazil', iso: 'BR', flag: '🇧🇷' });
  }

  assert.equal(board.getTotal('day'), 20);

  const rankings = board.getRankings('day');
  assert.equal(rankings.length, 3);

  // #1 CD with 12 strikes (60%)
  assert.equal(rankings[0].rank, 1);
  assert.equal(rankings[0].iso, 'CD');
  assert.equal(rankings[0].count, 12);
  assert.equal(rankings[0].percentage, 60);

  // #2 US with 5 strikes (25%)
  assert.equal(rankings[1].rank, 2);
  assert.equal(rankings[1].iso, 'US');
  assert.equal(rankings[1].count, 5);
  assert.equal(rankings[1].percentage, 25);

  // #3 BR with 3 strikes (15%)
  assert.equal(rankings[2].rank, 3);
  assert.equal(rankings[2].iso, 'BR');
  assert.equal(rankings[2].count, 3);
  assert.equal(rankings[2].percentage, 15);
});

test('CountryLeaderboard: UTC midnight rollover resets day counters but retains week/month/year', () => {
  const storage = new MemoryStorage();
  const board = new CountryLeaderboard(storage);

  const day1 = Date.parse('2026-09-06T23:59:00Z');
  const day2 = Date.parse('2026-09-07T00:01:00Z'); // 2 minutes later, next day

  // Record 8 strikes on Day 1
  for (let i = 0; i < 8; i++) {
    board.recordStrike(39, 35, day1, { country: 'Turkey', iso: 'TR', flag: '🇹🇷' });
  }

  assert.equal(board.getTotal('day'), 8);
  assert.equal(board.getTotal('month'), 8);

  // Record 2 strikes on Day 2
  for (let i = 0; i < 2; i++) {
    board.recordStrike(39, 35, day2, { country: 'Turkey', iso: 'TR', flag: '🇹🇷' });
  }

  // Day total should only be 2
  assert.equal(board.getTotal('day'), 2, 'Day counter rolled over at UTC midnight');

  // Month total should be 10 (8 from yesterday + 2 from today)
  assert.equal(board.getTotal('month'), 10, 'Month counter accumulated across days');
  assert.equal(board.getTotal('year'), 10, 'Year counter accumulated across days');
});

test('CountryLeaderboard: persists to storage and reloads accurately', () => {
  const storage = new MemoryStorage();
  const board1 = new CountryLeaderboard(storage);
  const now = Date.now();

  board1.recordStrike(10, 10, now, { country: 'Nigeria', iso: 'NG', flag: '🇳🇬' });
  board1.recordStrike(12, 12, now, { country: 'Nigeria', iso: 'NG', flag: '🇳🇬' });
  board1.save();

  // Create board2 with same storage
  const board2 = new CountryLeaderboard(storage);
  assert.equal(board2.getTrackedCountryCount(), 1);
  const ngRecord = board2.getRecord('NG');
  assert.ok(ngRecord);
  assert.equal(ngRecord.day, 2);
  assert.equal(ngRecord.allTime, 2);
  // Running centroid test: (10 + 12)/2 = 11
  assert.equal(ngRecord.lat, 11);
  assert.equal(ngRecord.lon, 11);
});

test('CountryLeaderboard: reset method resets specified period or all periods', () => {
  const storage = new MemoryStorage();
  const board = new CountryLeaderboard(storage);
  const now = Date.parse('2026-09-06T15:00:00Z');

  board.recordStrike(0, 0, now, { country: 'Testland', iso: 'TL', flag: '🏳' });
  assert.equal(board.getTotal('day'), 1);

  board.reset('day');
  assert.equal(board.getTotal('day'), 0);
  assert.equal(board.getTotal('year'), 1); // year preserved

  board.reset('all');
  assert.equal(board.getTotal('year'), 0);
  assert.equal(board.getTrackedCountryCount(), 0);
});
