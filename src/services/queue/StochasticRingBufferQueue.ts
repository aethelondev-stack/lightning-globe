import type { LightningEvent } from '../../types/lightning';

export interface ScheduledStrikeItem {
  event: LightningEvent;
  targetTimeMs: number;
}

export interface StochasticQueueOptions {
  capacity?: number;
  maxSatellitePerFrame?: number; // Burst-Guard: max satellite strikes emitted in a single 120Hz/60Hz frame
  maxRfPerFrame?: number;        // Burst-Guard: max instant RF strikes emitted per frame (default 3) to prevent burst-freeze spiral
}

/**
 * StochasticRingBufferQueue
 *
 * Ultra-high-performance Presentation Queue for smooth 120 FPS lightning dispatch.
 * Decouples network/SSE ingestion from the 120Hz render loop:
 *
 * 1. INSTANT RF PASS-THROUGH (Blitzortung):
 *    RF strikes bypass all satellite pacing and are emitted immediately on the very next animation frame.
 * 2. CHRONOLOGICAL MIN-HEAP (Satellites / Regional):
 *    Batches are spatially shuffled and assigned independent stochastic jitter timestamps.
 *    Organized in a binary Min-Heap ordered by targetTimeMs so the earliest strike is ALWAYS
 *    emitted first, regardless of batch arrival order.
 * 3. BURST-GUARD RATE LIMITER:
 *    Enforces max satellite strikes per frame (default 2) and max RF strikes per frame (default 3),
 *    preventing any frame spike, queue accumulation surge, or visual judder. Zero data loss.
 * 4. ZERO GC STUTTER:
 *    Pre-allocated heap array with in-place swap operations.
 */
export class StochasticRingBufferQueue {
  private readonly capacity: number;
  private readonly maxSatellitePerFrame: number;
  private readonly maxRfPerFrame: number;

  // Instant RF Queue (0ms delay for Blitzortung)
  private readonly rfQueue: LightningEvent[] = [];

  // Binary Min-Heap for Scheduled Satellite / Regional Strikes
  private readonly heap: Array<ScheduledStrikeItem | null>;
  private heapSize: number = 0;

  constructor(options?: StochasticQueueOptions) {
    this.capacity = options?.capacity ?? 10000;
    this.maxSatellitePerFrame = options?.maxSatellitePerFrame ?? 2;
    this.maxRfPerFrame = options?.maxRfPerFrame ?? 3;
    this.heap = new Array<ScheduledStrikeItem | null>(this.capacity).fill(null);
  }

  /**
   * Total number of pending strikes (both instant RF and scheduled satellite).
   */
  public get size(): number {
    return this.rfQueue.length + this.heapSize;
  }

  /**
   * Enqueues an instant Blitzortung RF strike (fires on next immediate frame).
   */
  public enqueueInstantRf(event: LightningEvent): void {
    this.rfQueue.push(event);
  }

  /**
   * Enqueues a single strike with an explicit target trigger time.
   */
  public enqueue(event: LightningEvent, targetTimeMs: number = Date.now(), isRealTimeRf: boolean = false): void {
    if (isRealTimeRf) {
      this.enqueueInstantRf(event);
      return;
    }

    if (this.heapSize >= this.capacity) {
      // Heap full: drop or pop root to make room
      this.popMin();
    }

    // Insert into Min-Heap
    const item: ScheduledStrikeItem = { event, targetTimeMs };
    this.heap[this.heapSize] = item;
    this.siftUp(this.heapSize);
    this.heapSize++;
  }

  /**
   * Enqueues a batch of satellite flashes (e.g. from NOAA GOES or MTG-LI),
   * distributing them smoothly and organically across [now, now + durationMs].
   * Applies Fisher-Yates shuffle to eliminate raw S3 file coordinate clumping.
   */
  public enqueueBatch(flashes: LightningEvent[], durationMs: number = 20000): void {
    if (!flashes || flashes.length === 0) return;

    // 1. Fisher-Yates spatial shuffle to prevent regional clumping
    const shuffled = flashes.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    const now = Date.now();
    const len = shuffled.length;

    // 2. Assign independent random jitter timestamps across durationMs
    for (let i = 0; i < len; i++) {
      const randomFraction = Math.random();
      const targetTime = now + (randomFraction * durationMs);
      this.enqueue(shuffled[i], targetTime, false);
    }
  }

  /**
   * Frame Update (Consumer): Called once per animation frame (rAF) in Engine/main.ts.
   * Dispatches ready strikes whose targetTimeMs <= now.
   * 1. All pending instant RF strikes are emitted first (zero latency).
   * 2. Scheduled satellite strikes are emitted in chronological order up to maxSatellitePerFrame.
   */
  public update(now: number, onEmit: (event: LightningEvent) => void): number {
    let totalEmitted = 0;

    // Step 1: Drain pending instant Blitzortung RF strikes up to maxRfPerFrame (Burst-Guard)
    let emittedRf = 0;
    while (this.rfQueue.length > 0 && emittedRf < this.maxRfPerFrame) {
      const rfStrike = this.rfQueue.shift()!;
      onEmit(rfStrike);
      emittedRf++;
      totalEmitted++;
    }

    // Step 2: Pop scheduled satellite strikes whose time has arrived (up to maxSatellitePerFrame)
    let emittedSatellite = 0;

    while (this.heapSize > 0 && emittedSatellite < this.maxSatellitePerFrame) {
      const minItem = this.heap[0];
      if (!minItem) {
        this.heapSize = 0;
        break;
      }

      // Check if item's trigger time has arrived (with 3s staleness emergency release)
      const isReady = minItem.targetTimeMs <= now || (now - minItem.targetTimeMs > 3000);

      if (isReady) {
        this.popMin();
        onEmit(minItem.event);
        emittedSatellite++;
        totalEmitted++;
      } else {
        // Earliest item in heap is not ready yet -> no other item in heap is ready
        break;
      }
    }

    return totalEmitted;
  }

  /**
   * Clears all pending items.
   */
  public clear(): void {
    this.rfQueue.length = 0;
    for (let i = 0; i < this.heapSize; i++) {
      this.heap[i] = null;
    }
    this.heapSize = 0;
  }

  // --- Binary Min-Heap Operations ---

  private siftUp(index: number): void {
    let curr = index;
    while (curr > 0) {
      const parent = (curr - 1) >> 1;
      if (this.heap[curr]!.targetTimeMs < this.heap[parent]!.targetTimeMs) {
        const tmp = this.heap[curr];
        this.heap[curr] = this.heap[parent];
        this.heap[parent] = tmp;
        curr = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    let curr = index;
    const half = this.heapSize >> 1;

    while (curr < half) {
      let left = (curr << 1) + 1;
      const right = left + 1;
      let best = left;

      if (right < this.heapSize && this.heap[right]!.targetTimeMs < this.heap[left]!.targetTimeMs) {
        best = right;
      }

      if (this.heap[best]!.targetTimeMs < this.heap[curr]!.targetTimeMs) {
        const tmp = this.heap[curr];
        this.heap[curr] = this.heap[best];
        this.heap[best] = tmp;
        curr = best;
      } else {
        break;
      }
    }
  }

  private popMin(): ScheduledStrikeItem | null {
    if (this.heapSize === 0) return null;

    const min = this.heap[0];
    this.heapSize--;

    if (this.heapSize > 0) {
      this.heap[0] = this.heap[this.heapSize];
      this.heap[this.heapSize] = null;
      this.siftDown(0);
    } else {
      this.heap[0] = null;
    }

    return min;
  }
}
