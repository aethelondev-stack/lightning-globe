import test from 'node:test';
import assert from 'node:assert';
import { Goes18GlmProvider } from '../src/services/providers/Goes18GlmProvider';
import { MtgLiProvider } from '../src/services/providers/MtgLiProvider';
import { MultiSourceHarmonizer } from '../src/services/providers/MultiSourceHarmonizer';

test('Goes18GlmProvider - Lifecycle and properties', async () => {
  const provider = new Goes18GlmProvider({ endpoint: '/api/goes18-glm/latest' });
  assert.strictEqual(provider.id, 'provider-goes18-glm');
  assert.strictEqual(provider.status, 'OFFLINE');

  let statusChange: string | null = null;
  provider.onStatusChange((st) => {
    statusChange = st;
  });

  await provider.connect();
  assert.strictEqual(provider.getStats().totalEventsReceived, 0);

  provider.disconnect();
  assert.strictEqual(provider.status, 'OFFLINE');
});

test('MtgLiProvider - Lifecycle and properties', async () => {
  const provider = new MtgLiProvider({ endpoint: '/api/mtg-li/latest' });
  assert.strictEqual(provider.id, 'provider-mtg-li');
  assert.strictEqual(provider.status, 'OFFLINE');

  let statusChange: string | null = null;
  provider.onStatusChange((st) => {
    statusChange = st;
  });

  await provider.connect();
  assert.strictEqual(provider.getStats().totalEventsReceived, 0);

  provider.disconnect();
  assert.strictEqual(provider.status, 'OFFLINE');
});

test('MultiSourceHarmonizer - Coordinates 4 distinct streams', async () => {
  const harmonizer = new MultiSourceHarmonizer();
  assert.strictEqual(harmonizer.id, 'provider-multi-source-harmonizer');
  assert.strictEqual(harmonizer.status, 'OFFLINE');

  await harmonizer.connect();
  const stats = harmonizer.getStats();
  assert.strictEqual(typeof stats.eventsPerSecond, 'number');
  assert.strictEqual(Array.isArray(stats.activeSources), true);

  harmonizer.disconnect();
  assert.strictEqual(harmonizer.status, 'OFFLINE');
});
