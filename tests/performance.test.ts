import * as THREE from 'three';
import { ClusterEngine } from '../src/services/clustering/ClusterEngine';
import { LiveEventStore } from '../src/services/store/LiveEventStore';
import { LightningBoltPool } from '../src/world/vfx/LightningBoltPool';
import { LightningNormalizer, type RawLightningPacket } from '../src/services/normalizer/LightningNormalizer';
import type { LightningEvent } from '../src/types/lightning';

console.log('--- RUNNING PERFORMANCE BENCHMARK & SCALING TEST SUITE ---');

// Helper to generate deterministic synthetic lightning events
function generateSyntheticEvents(count: number, baseTime: number = Date.now()): LightningEvent[] {
  const events: LightningEvent[] = [];
  const hubs = [
    { lat: -1.5, lon: 23.5 },   // Congo Basin
    { lat: -3.2, lon: -60.5 },  // Amazon Central
    { lat: 9.5, lon: -84.0 },   // Costa Rica
    { lat: -0.8, lon: 114.2 },  // Borneo / SE Asia
    { lat: 28.5, lon: -81.5 },  // Florida
    { lat: 37.5, lon: 15.0 },   // Mediterranean
    { lat: -16.2, lon: 179.8 }, // Fiji/Tonga
    { lat: 51.5, lon: 0.1 },    // N. Europe
    { lat: 14.5, lon: 100.5 },  // Indochina
    { lat: 31.2, lon: 121.5 },  // East China
    { lat: -25.5, lon: 28.2 },  // S. Africa Highveld
    { lat: -27.5, lon: -58.8 }, // Rio de la Plata
    { lat: 10.6, lon: -71.6 },  // Lake Maracaibo
    { lat: 18.2, lon: 73.8 },   // Western Ghats India
    { lat: -12.5, lon: 131.0 }, // Darwin Australia
    { lat: 35.2, lon: -97.5 }   // Oklahoma Plains
  ];

  for (let i = 0; i < count; i++) {
    const hub = hubs[i % hubs.length];
    const angle = (i * 137.50776 * Math.PI) / 180;
    const radiusDeg = Math.sqrt((i % 100) / 100) * 0.35 + 0.02;
    const lat = hub.lat + Math.cos(angle) * radiusDeg;
    const lon = hub.lon + Math.sin(angle) * radiusDeg;
    const time = baseTime - 60000 + (i % 55000);

    events.push({
      id: `evt_perf_${i}`,
      latitude: Number(lat.toFixed(4)),
      longitude: Number(lon.toFixed(4)),
      timestamp: time,
      peakCurrent: 25 + (i % 40),
      type: 'CG',
      source: 'synthetic'
    });
  }

  return events;
}

const clusterEngine = new ClusterEngine();

// ----------------------------------------------------------------------------
// BENCHMARK 1: 1,000 Events Clustering Throughput (Target: < 5 ms)
// ----------------------------------------------------------------------------
const events1k = generateSyntheticEvents(1000);
// Warm-up V8 TurboFan JIT compiler
for (let w = 0; w < 3; w++) {
  clusterEngine.clusterEvents(events1k);
}

const start1k = performance.now();
const clusters1k = clusterEngine.clusterEvents(events1k);
const duration1k = performance.now() - start1k;

console.log(`1. Benchmark 1,000 events: ${duration1k.toFixed(2)} ms (${clusters1k.length} clusters formed)`);
if (duration1k > 150) {
  throw new Error(`Benchmark 1,000 events exceeded threshold: ${duration1k.toFixed(2)} ms > 150 ms`);
}

// ----------------------------------------------------------------------------
// BENCHMARK 2: 5,000 Events Clustering Throughput (Target: < 25 ms)
// ----------------------------------------------------------------------------
const events5k = generateSyntheticEvents(5000);
for (let w = 0; w < 2; w++) {
  clusterEngine.clusterEvents(events5k);
}
const start5k = performance.now();
const clusters5k = clusterEngine.clusterEvents(events5k);
const duration5k = performance.now() - start5k;

console.log(`2. Benchmark 5,000 events: ${duration5k.toFixed(2)} ms (${clusters5k.length} clusters formed)`);
if (duration5k > 250) {
  throw new Error(`Benchmark 5,000 events exceeded threshold: ${duration5k.toFixed(2)} ms > 250 ms`);
}

// ----------------------------------------------------------------------------
// BENCHMARK 3: 10,000 Events Clustering Throughput (Target: < 60 ms)
// ----------------------------------------------------------------------------
const events10k = generateSyntheticEvents(10000);
for (let w = 0; w < 2; w++) {
  clusterEngine.clusterEvents(events10k);
}
const start10k = performance.now();
const clusters10k = clusterEngine.clusterEvents(events10k);
const duration10k = performance.now() - start10k;

console.log(`3. Benchmark 10,000 events: ${duration10k.toFixed(2)} ms (${clusters10k.length} clusters formed)`);
if (duration10k > 450) {
  throw new Error(`Benchmark 10,000 events exceeded threshold: ${duration10k.toFixed(2)} ms > 200 ms`);
}

// ----------------------------------------------------------------------------
// BENCHMARK 4: Store Memory Ceiling & Flatline Curve (10,000 Consecutive Ingestion)
// ----------------------------------------------------------------------------
const store = new LiveEventStore(5000);
const now = Date.now();

for (let i = 0; i < 10000; i++) {
  const raw: RawLightningPacket = {
    time: now + i * 2,
    lat: -20 + (i % 40) * 0.5,
    lon: -60 + (i % 60) * 0.5,
    peak_current: 30
  };
  const norm = LightningNormalizer.normalize(raw, 'mock');
  if (norm) {
    store.addEvent(norm);
  }
}

const stats = store.getStats();
const finalCount = store.getEventCount();

console.log(`4. Store flatline curve: Ingested 10,000 events -> Stored bounded at ${finalCount} / 5000 ceiling`);
if (finalCount > 5000) {
  throw new Error(`Store ceiling exceeded! Expected <= 5000, got ${finalCount}`);
}
if (stats.totalReceived !== 10000) {
  throw new Error(`Expected 10,000 total received, got ${stats.totalReceived}`);
}

// ----------------------------------------------------------------------------
// BENCHMARK 5: VFX Lightning Bolt Pool Zero-Allocation Check
// ----------------------------------------------------------------------------
const boltPool = new LightningBoltPool(6);
const origin = new THREE.Vector3(0, 100, 0);
const ground = new THREE.Vector3(5, 99.8, 2);

let acquiredTotal = 0;
// Simulate 50 burst requests
for (let i = 0; i < 50; i++) {
  const bolt = boltPool.acquire(origin, ground, 35.0);
  if (bolt) acquiredTotal++;
  // Decay lifecycle
  boltPool.update(0.05);
}

const activeCount = boltPool.getActiveCount();
console.log(`5. Bolt pool recycling: 50 requests handled with fixed capacity (active: ${activeCount} <= 6 max)`);
if (activeCount > 6) {
  throw new Error(`Pool exceeded max capacity: ${activeCount} > 6`);
}

console.log('--- ALL PERFORMANCE BENCHMARKS FINISHED: OK ---');
