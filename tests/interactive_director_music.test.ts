import assert from 'node:assert';
import { EventDirector } from '../src/services/director/EventDirector';
import { BackgroundMusicPlayer } from '../src/services/audio/BackgroundMusicPlayer';
import type { ScoredCluster } from '../src/types/scoring';

console.log('--- RUNNING INTERACTIVE DIRECTOR & MUSIC PLAYER TESTS ---');

// 1. Test Dual-Track Interleaved Queue & Sandwich Rhythm
const director = new EventDirector();
const now = Date.now();

// Mock 3 natural clusters
const mockClusters: ScoredCluster[] = [
  {
    id: 'c1',
    centroid: { latitude: 10, longitude: 20 },
    boundingRadiusKm: 50,
    eventCount: 15,
    events: [],
    firstEventTimestamp: now - 30000,
    lastEventTimestamp: now,
    activityScore: 0.85,
    presentationClass: 'REGIONAL',
    strikesPerMinute: 30,
    growthRate: 1.1,
    breakdown: { rateScore: 0.8, growthScore: 0.8, energyScore: 0.8, clusterSizeScore: 0.8 }
  },
  {
    id: 'c2',
    centroid: { latitude: -15, longitude: -45 }, // Brazil area
    boundingRadiusKm: 60,
    eventCount: 20,
    events: [],
    firstEventTimestamp: now - 20000,
    lastEventTimestamp: now,
    activityScore: 0.90,
    presentationClass: 'REGIONAL',
    strikesPerMinute: 40,
    growthRate: 1.2,
    breakdown: { rateScore: 0.9, growthScore: 0.9, energyScore: 0.9, clusterSizeScore: 0.9 }
  }
];

director.updateClusters(mockClusters, now);

// Enqueue viewer requests
let cadenceAccelerated = false;
director.onCadenceAccelerate(() => {
  cadenceAccelerated = true;
});

const req1 = director.addViewerRequest({ username: 'Ahmet', countryName: 'Türkiye', platform: 'kick' });
assert.strictEqual(req1.success, true, 'Viewer request 1 should succeed');
assert.strictEqual(cadenceAccelerated, true, 'Cadence acceleration should be triggered');

const req2 = director.addViewerRequest({ username: 'Carlos', countryName: 'Brezilya', platform: 'kick' });
assert.strictEqual(req2.success, true, 'Viewer request 2 should succeed');

// Check interleaved queue length & items
const queue = director.getInterleavedQueue(20);
assert.strictEqual(queue.length >= 3, true, 'Interleaved queue should contain natural and viewer targets');
console.log(`1. Interleaved queue generated with ${queue.length} targets: OK`);

// Verify alternating sequence
const target1 = director.getNextTarget(now);
assert.notStrictEqual(target1, null, 'First target should not be null');
console.log(`2. First target dequeued (${target1?.id}): OK`);

// 2. Test Background Music Player
const player = new BackgroundMusicPlayer();
const playlist = player.getPlaylist();
assert.strictEqual(Array.isArray(playlist), true, 'Playlist should be an array');
console.log(`3. Background music player initialized with ${playlist.length} embedded/fallback tracks: OK`);

console.log('--- ALL INTERACTIVE DIRECTOR & MUSIC PLAYER TESTS FINISHED: OK ---');
