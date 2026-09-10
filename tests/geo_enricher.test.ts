import { GeoEnricher } from '../src/services/geo/GeoEnricher';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function run(): Promise<void> {
  console.log('--- RUNNING PHASE 17 GEO-ENRICHER UNIT TESTS ---');

  const enricher = GeoEnricher.getInstance();
  await enricher.init();

  console.log('Test 1: Verifying known capital and city coordinates...');

  // Ankara, Turkey
  const resTR = enricher.lookup(39.9334, 32.8597);
  console.log('  -> Ankara lookup:', resTR);
  assert(resTR.iso === 'TR' || resTR.country.includes('Turkey'), 'Ankara must resolve to Turkey');
  assert(resTR.flag === '🇹🇷', 'Turkey must resolve to TR flag emoji');

  // Paris, France
  const resFR = enricher.lookup(48.8566, 2.3522);
  console.log('  -> Paris lookup:', resFR);
  assert(resFR.iso === 'FR' || resFR.country.includes('France'), 'Paris must resolve to France');
  assert(resFR.flag === '🇫🇷', 'France must resolve to FR flag emoji');

  // Brasilia, Brazil
  const resBR = enricher.lookup(-15.7975, -47.8919);
  console.log('  -> Brasilia lookup:', resBR);
  assert(resBR.iso === 'BR' || resBR.country.includes('Brazil'), 'Brasilia must resolve to Brazil');
  assert(resBR.flag === '🇧🇷', 'Brazil must resolve to BR flag emoji');

  // Tokyo, Japan
  const resJP = enricher.lookup(35.6762, 139.6503);
  console.log('  -> Tokyo lookup:', resJP);
  assert(resJP.iso === 'JP' || resJP.country.includes('Japan'), 'Tokyo must resolve to Japan');
  assert(resJP.flag === '🇯🇵', 'Japan must resolve to JP flag emoji');

  // Pacific Ocean (Maritime)
  const resOcean = enricher.lookup(0.0, -140.0);
  console.log('  -> Pacific Ocean lookup:', resOcean);
  assert(resOcean.country === 'International Waters', 'Pacific must resolve to International Waters');
  assert(resOcean.iso === 'XW', 'Ocean ISO must be XW');

  // Benchmark
  console.log('Test 2: Verifying query throughput (< 1ms per query)...');
  const t0 = Date.now();
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    enricher.lookup(39.9334 + (i % 5) * 0.1, 32.8597 + (i % 5) * 0.1);
  }
  const totalMs = Date.now() - t0;
  const avgMs = totalMs / iterations;
  console.log(`  -> ${iterations} queries took ${totalMs} ms (Avg: ${avgMs.toFixed(3)} ms/query)`);
  assert(avgMs < 1.0, 'Average lookup latency must be under 1ms');

  console.log('--- ALL PHASE 17 GEO-ENRICHER TESTS FINISHED: OK ---');
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
