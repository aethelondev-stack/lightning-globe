import { haversineDistanceKm } from '../../utils/coordinates';

export interface PacingItem<T> {
  item: T;
  lat: number;
  lon: number;
  scheduledTime: number;
}

export interface StochasticPacingQueueOptions<T> {
  defaultDurationMs?: number;
  minBurstIntervalMs?: number; // Distance within cluster (30-80ms)
  maxBurstIntervalMs?: number;
  minClusterGapMs?: number;    // Distance between clusters (250-1000ms)
  maxClusterGapMs?: number;
  clusterRadiusKm?: number;    // Radius to consider same storm cluster (~45km)
  onEmit: (item: T) => void;
}

/**
 * StochasticPacingQueue: Dispatches batched lightning strikes organically over time.
 *
 * Rather than a robotic metronome (e.g. exactly one strike every 100ms),
 * it models true meteorological thunderstorm physics:
 * 1. Micro-bursts: Strikes within the same storm cell fire in rapid clusters (30-80ms apart).
 * 2. Inter-cluster pauses: Natural stochastic intervals (300-1200ms) between distinct storm cells.
 * 3. Adaptive time-pacing: Stretches or compacts remaining queue items so the stream
 *    bridges the gap until the next satellite/radar packet without running dry.
 */
export class StochasticPacingQueue<T> {
  public static readonly activeQueues: Set<StochasticPacingQueue<any>> = new Set();

  public static broadcastArrivalSync(targetLat: number, targetLon: number, radiusKm: number, arrivalEpoch: number): void {
    for (const q of StochasticPacingQueue.activeQueues) {
      try {
        q.syncClusterArrival(targetLat, targetLon, radiusKm, arrivalEpoch);
      } catch (err) {
        console.warn('Error syncing cluster arrival:', err);
      }
    }
  }

  private queue: PacingItem<T>[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastScheduledTime: number = 0;
  private readonly options: Required<StochasticPacingQueueOptions<T>>;

  constructor(options: StochasticPacingQueueOptions<T>) {
    this.options = {
      defaultDurationMs: options.defaultDurationMs ?? 20000,
      minBurstIntervalMs: options.minBurstIntervalMs ?? 35,
      maxBurstIntervalMs: options.maxBurstIntervalMs ?? 85,
      minClusterGapMs: options.minClusterGapMs ?? 280,
      maxClusterGapMs: options.maxClusterGapMs ?? 950,
      clusterRadiusKm: options.clusterRadiusKm ?? 45,
      onEmit: options.onEmit
    };
    StochasticPacingQueue.activeQueues.add(this);
  }

  public dispose(): void {
    this.clear();
    StochasticPacingQueue.activeQueues.delete(this);
  }

  /**
   * Enqueues a batch of items, grouping by spatial clusters and scheduling with stochastic Poisson intervals.
   */
  public enqueueBatch(
    items: Array<{ data: T; lat: number; lon: number }>,
    targetDurationMs?: number
  ): void {
    if (!items || items.length === 0) return;

    const duration = targetDurationMs ?? this.options.defaultDurationMs;
    const now = Date.now();

    // Start scheduling either now or append smoothly to previously scheduled items
    let cursor = Math.max(now, Math.min(this.lastScheduledTime, now + duration * 0.8));

    // 1. Spatially cluster items into micro-groups
    const clusters: Array<Array<{ data: T; lat: number; lon: number }>> = [];
    const assigned = new Set<number>();

    for (let i = 0; i < items.length; i++) {
      if (assigned.has(i)) continue;
      assigned.add(i);
      const cluster = [items[i]];

      for (let j = i + 1; j < items.length; j++) {
        if (assigned.has(j)) continue;
        const d = haversineDistanceKm(items[i].lat, items[i].lon, items[j].lat, items[j].lon);
        if (d <= this.options.clusterRadiusKm) {
          assigned.add(j);
          cluster.push(items[j]);
        }
      }
      clusters.push(cluster);
    }

    // 2. Randomize cluster dispatch order for organic global coverage
    for (let i = clusters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clusters[i], clusters[j]] = [clusters[j], clusters[i]];
    }

    // 3. Compute pacing scale factor to smoothly fit targetDuration
    const rawStepEst = duration / Math.max(1, items.length);
    const newPacingItems: PacingItem<T>[] = [];

    for (let c = 0; c < clusters.length; c++) {
      const cluster = clusters[c];

      // Natural pause before starting a new storm cluster
      if (c > 0) {
        const gapRatio = Math.random();
        const baseGap = this.options.minClusterGapMs + (this.options.maxClusterGapMs - this.options.minClusterGapMs) * gapRatio;
        const scaledGap = Math.max(40, Math.min(baseGap, rawStepEst * 1.8));
        cursor += scaledGap;
      }

      for (let k = 0; k < cluster.length; k++) {
        if (k > 0) {
          // Rapid intra-cluster burst discharge (30-85ms)
          const burstRatio = Math.random();
          const burstGap = this.options.minBurstIntervalMs + (this.options.maxBurstIntervalMs - this.options.minBurstIntervalMs) * burstRatio;
          cursor += Math.max(25, Math.min(burstGap, rawStepEst * 0.5));
        }

        newPacingItems.push({
          item: cluster[k].data,
          lat: cluster[k].lat,
          lon: cluster[k].lon,
          scheduledTime: cursor
        });
      }
    }

    // 4. If computed cursor overshoots duration by too much, scale down timestamps proportionally
    const totalSpan = cursor - now;
    if (totalSpan > duration * 1.25 && newPacingItems.length > 0) {
      const compression = (duration * 0.95) / Math.max(1, totalSpan);
      for (let i = 0; i < newPacingItems.length; i++) {
        const delta = newPacingItems[i].scheduledTime - now;
        newPacingItems[i].scheduledTime = now + (delta * compression);
      }
      cursor = now + (totalSpan * compression);
    }

    this.lastScheduledTime = cursor;
    this.queue.push(...newPacingItems);

    // Keep queue sorted by scheduledTime
    this.queue.sort((a, b) => a.scheduledTime - b.scheduledTime);

    this.startTimer();
  }

  public get size(): number {
    return this.queue.length;
  }

  public getSize(): number {
    return this.queue.length;
  }

  /**
   * Synchronizes upcoming strikes for a target cluster with camera arrival time.
   * Adjusts the scheduledTime of strikes near targetLat/targetLon to fire
   * right before the camera finishes its cinematic descent (arrivalEpoch - 400ms).
   */
  public syncClusterArrival(
    targetLat: number,
    targetLon: number,
    radiusKm: number,
    arrivalEpoch: number
  ): void {
    const matchedIndices: number[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      const dist = haversineDistanceKm(item.lat, item.lon, targetLat, targetLon);
      if (dist <= radiusKm) {
        matchedIndices.push(i);
      }
    }

    if (matchedIndices.length === 0) return;

    // Schedule arrival burst centered 400ms before camera touchdown
    let cursor = arrivalEpoch - 400 + (Math.random() * 80 - 40);
    for (const idx of matchedIndices) {
      this.queue[idx].scheduledTime = cursor;
      cursor += 35 + Math.random() * 45; // Rapid intra-cluster burst (35-80ms)
    }

    // Keep queue sorted by scheduledTime
    this.queue.sort((a, b) => a.scheduledTime - b.scheduledTime);
    this.startTimer();
  }

  public clear(): void {
    this.queue = [];
    this.lastScheduledTime = 0;
    this.stopTimer();
  }

  private startTimer(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      this.tick();
    }, 35);
  }

  private stopTimer(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tick(): void {
    if (this.queue.length === 0) {
      if (Date.now() > this.lastScheduledTime + 3000) {
        this.stopTimer();
      }
      return;
    }

    const now = Date.now();
    let emitted = 0;
    const maxPerTick = 6; // Cap emission per 35ms tick to prevent UI stutter

    while (this.queue.length > 0 && emitted < maxPerTick) {
      const head = this.queue[0];
      if (head.scheduledTime <= now || (now - head.scheduledTime > 2500)) {
        const item = this.queue.shift()!;
        this.options.onEmit(item.item);
        emitted++;
      } else {
        break;
      }
    }
  }
}
