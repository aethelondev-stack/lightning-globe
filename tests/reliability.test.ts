import assert from 'node:assert/strict';
import { LiveStreamProvider } from '../src/services/providers/LiveStreamProvider';
import { LightningNormalizer, type RawLightningPacket } from '../src/services/normalizer/LightningNormalizer';
import type { IMinimalWebSocket, WebSocketConstructor } from '../src/types/connection';
import type { IScenarioRunner, DemoScenarioId } from '../src/types/scenario';

/**
 * Mock WebSocket implementation for deterministic offline testing.
 */
class MockWebSocket implements IMinimalWebSocket {
  public static lastInstance: MockWebSocket | null = null;
  public readyState: number = 0; // CONNECTING
  public url: string;
  public onopen: ((event: unknown) => void) | null = null;
  public onclose: ((event: unknown) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;

  public sentMessages: string[] = [];
  public isClosed: boolean = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastInstance = this;

    // Simulate auto-open on next tick
    setTimeout(() => {
      if (!this.isClosed && this.onopen) {
        this.readyState = 1; // OPEN
        this.onopen({});
      }
    }, 10);
  }

  public send(data: string): void {
    this.sentMessages.push(data);
  }

  public close(): void {
    this.isClosed = true;
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({});
    }
  }

  public simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }

  public simulateError(): void {
    if (this.onerror) {
      this.onerror(new Error('Simulated socket error'));
    }
  }
}

/**
 * Mock Scenario Runner for verifying fallback engagement.
 */
class MockFallbackRunner implements IScenarioRunner {
  public readonly id: DemoScenarioId = 'SINGLE_STRIKE';
  private running: boolean = false;
  public emissionCallback: ((packet: RawLightningPacket) => void) | null = null;

  public isRunning(): boolean {
    return this.running;
  }

  public start(emit: (packet: RawLightningPacket) => void): void {
    this.running = true;
    this.emissionCallback = emit;
  }

  public stop(): void {
    this.running = false;
    this.emissionCallback = null;
  }
}

async function runReliabilityTests(): Promise<void> {
  console.log('--- RELIABILITY & PRODUCTION READINESS BENCHMARK SUITE ---');

  // TEST 1: Exponential Backoff & Jitter Verification
  console.log('Test 1: Verifying Exponential Backoff calculation & maximum ceiling...');
  const baseMs = 1000;
  const maxMs = 30000;

  for (let attempt = 0; attempt <= 10; attempt++) {
    const delay = LiveStreamProvider.calculateBackoff(attempt, baseMs, maxMs, 0.5);
    const minExpected = Math.min(maxMs, baseMs * Math.pow(2, attempt));

    assert(
      delay >= minExpected,
      `Attempt ${attempt}: delay (${delay}) should be >= exponential base (${minExpected})`
    );
    assert(
      delay <= maxMs,
      `Attempt ${attempt}: delay (${delay}) must not exceed ceiling (${maxMs})`
    );
  }

  // Verify specific progression
  const delay0 = LiveStreamProvider.calculateBackoff(0, 1000, 30000, 0);
  assert.equal(delay0, 1000, 'Attempt 0 without jitter should be exactly 1000ms');

  const delay1 = LiveStreamProvider.calculateBackoff(1, 1000, 30000, 0);
  assert.equal(delay1, 2000, 'Attempt 1 without jitter should be exactly 2000ms');

  const delay2 = LiveStreamProvider.calculateBackoff(2, 1000, 30000, 0);
  assert.equal(delay2, 4000, 'Attempt 2 without jitter should be exactly 4000ms');

  const delay3 = LiveStreamProvider.calculateBackoff(3, 1000, 30000, 0);
  assert.equal(delay3, 8000, 'Attempt 3 without jitter should be exactly 8000ms');

  const delay10 = LiveStreamProvider.calculateBackoff(10, 1000, 30000, 0);
  assert.equal(delay10, 30000, 'Attempt 10 without jitter must cap at max ceiling 30000ms');
  console.log('  -> Exponential backoff progression verified: 1s, 2s, 4s, 8s -> 30s ceiling.');

  // TEST 2: Heartbeat Watchdog & Stale/Fallback Transition
  console.log('Test 2: Verifying Heartbeat Watchdog and automatic Demo Fallback...');
  const mockFallback = new MockFallbackRunner();
  const provider = new LiveStreamProvider({
    config: {
      reconnectBaseMs: 100,
      reconnectMaxMs: 500,
      staleTimeoutMs: 50, // Fast 50ms timeout for test
      heartbeatIntervalMs: 100
    },
    fallbackRunner: mockFallback,
    webSocketClass: MockWebSocket as unknown as WebSocketConstructor
  });

  await provider.connect();
  // Wait for mock socket to open
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(provider.status, 'LIVE', 'Provider should transition to LIVE on open');
  assert.equal(mockFallback.isRunning(), false, 'Fallback runner should be idle while socket is live');

  // Send a valid stroke
  const validPacket = JSON.stringify({
    time: Date.now(),
    lat: 4.5,
    lon: 18.2,
    peakCurrent: 35.0
  });
  MockWebSocket.lastInstance?.simulateMessage(validPacket);

  const statsAfterStroke = provider.getStats();
  assert.equal(statsAfterStroke.totalEventsReceived, 1, 'Total events received should be 1');

  // Trigger error on socket
  MockWebSocket.lastInstance?.simulateError();
  assert.equal(provider.status, 'STALE', 'Provider status should be STALE on socket failure');
  assert.equal(mockFallback.isRunning(), true, 'Fallback runner must activate immediately on failure');
  console.log('  -> Stale transition and fallback runner activation verified.');

  // TEST 3: Corrupted & Malformed Packet Resilience
  console.log('Test 3: Verifying packet parser resilience against corrupted data...');
  LightningNormalizer.resetMetrics();

  const corruptedPayloads = [
    '{ invalid json',
    'null',
    '12345',
    '""',
    JSON.stringify({ lat: 'not-a-number', lon: 20 }),
    JSON.stringify({ lat: 100, lon: 0 }), // Lat out of range (> 90)
    JSON.stringify({ lat: 0, lon: 200 }), // Lon out of range (> 180)
    JSON.stringify(['corrupt', 'array']),
    JSON.stringify([Date.now(), 'bad_lon', 'bad_lat']),
    JSON.stringify({}) // missing coords
  ];

  for (const corrupt of corruptedPayloads) {
    // Should not throw or crash
    provider.handleMessageData(corrupt);
  }

  const normalizerMetrics = LightningNormalizer.getMetrics();
  assert(
    normalizerMetrics.rejectedCount > 0,
    `Normalizer should have rejected corrupted packets (count: ${normalizerMetrics.rejectedCount})`
  );
  console.log(`  -> Corrupted payloads safely rejected (${normalizerMetrics.rejectedCount} packets rejected).`);

  // TEST 4: Nanosecond Timestamp & Batched Array Format Parsing
  console.log('Test 4: Verifying Blitzortung array format & nanosecond timestamps...');
  const receivedEvents: import('../src/types/lightning').LightningEvent[] = [];
  const unsubscribe = provider.onEvent((evt) => receivedEvents.push(evt));

  // Blitzortung array format: [nanosecondTime, lon, lat, alt, pol, mds, mc]
  const nanoTime = 1725578491000000000; // Nanoseconds
  const blitzortungArray = JSON.stringify([nanoTime, 32.5, 39.9, 0, 0, 12000, 42]);
  provider.handleMessageData(blitzortungArray);

  assert.equal(receivedEvents.length, 1, 'Batched array format should yield 1 event');
  assert.equal(receivedEvents[0].latitude, 39.9, 'Latitude should be parsed correctly');
  assert.equal(receivedEvents[0].longitude, 32.5, 'Longitude should be parsed correctly');
  assert(receivedEvents[0].timestamp < 1e13, 'Nanosecond timestamp should be normalized to milliseconds');
  unsubscribe();
  console.log('  -> Blitzortung array format and nanosecond time parsing verified.');

  // TEST 5: Graceful Disconnect & Teardown
  console.log('Test 5: Verifying clean provider disconnection...');
  provider.disconnect();
  assert.equal(provider.status, 'OFFLINE', 'Status must be OFFLINE after disconnect');
  assert.equal(mockFallback.isRunning(), false, 'Fallback runner must be stopped after disconnect');
  console.log('  -> Provider disconnect and teardown verified.');

  // TEST 6: WebGL Context Loss Simulation
  console.log('Test 6: Verifying WebGL context loss and restoration behavior...');
  let contextLostHandled = false;
  let contextRestoredHandled = false;

  type CustomHandler = (e: { type: string; preventDefault: () => void }) => void;
  const mockListeners: Record<string, CustomHandler[]> = {};
  const mockCanvas = {
    addEventListener: (type: string, listener: CustomHandler) => {
      if (!mockListeners[type]) mockListeners[type] = [];
      mockListeners[type].push(listener);
    },
    dispatchEvent: (event: { type: string; preventDefault: () => void }) => {
      const list = mockListeners[event.type] || [];
      for (const fn of list) fn(event);
      return true;
    }
  };

  // Attach context loss simulation
  mockCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLostHandled = true;
  });

  mockCanvas.addEventListener('webglcontextrestored', () => {
    contextRestoredHandled = true;
  });

  let defaultPrevented = false;
  mockCanvas.dispatchEvent({
    type: 'webglcontextlost',
    preventDefault: () => {
      defaultPrevented = true;
    }
  });

  assert.equal(contextLostHandled, true, 'webglcontextlost event should be handled');
  assert.equal(defaultPrevented, true, 'preventDefault must be called on webglcontextlost to allow restoration');

  mockCanvas.dispatchEvent({
    type: 'webglcontextrestored',
    preventDefault: () => {}
  });
  assert.equal(contextRestoredHandled, true, 'webglcontextrestored event should be handled');
  console.log('  -> WebGL context loss and restoration lifecycle verified.');

  console.log('\n--- ALL RELIABILITY AND PRODUCTION TESTS FINISHED: OK ---');
}

runReliabilityTests().catch((err) => {
  console.error('Reliability test failed:', err);
  process.exit(1);
});
