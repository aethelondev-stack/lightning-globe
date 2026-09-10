import type { LightningEvent } from '../../types/lightning';
import type { IEventStore, StoreStats } from '../../types/store';
import { EventDeduplicator } from './EventDeduplicator';
import { haversineDistanceKm } from '../../utils/coordinates';
import { EngineConfig } from '../../core/Config';

/**
 * LiveEventStore: Centralized bounded in-memory lightning event repository.
 * Features:
 * - O(1) deduplication via EventDeduplicator
 * - Strict FIFO capacity ceiling (default 5,000 events)
 * - Periodic temporal pruning (default 15-minute retention)
 * - O(log N) binary search time-window queries
 * - Bounding box accelerated spatial proximity queries
 * - Pub/Sub reactive subscriber pattern
 * Referencing ARCHITECTURE.md Section 4
 */
export class LiveEventStore implements IEventStore {
  private readonly maxCapacity: number;
  private readonly retentionMs: number;
  private readonly deduplicator: EventDeduplicator;

  // Chronologically ordered array of events
  private events: LightningEvent[] = [];
  private listeners: Set<(event: LightningEvent) => void> = new Set();

  private totalReceived: number = 0;
  private exactIdDuplicatesRejected: number = 0;
  private lastPruneTime: number = 0;

  // Exact ID deduplication cache (LRU up to 20,000 IDs)
  private readonly seenIds: Set<string> = new Set();
  private readonly idFifo: string[] = [];
  private readonly maxIdRetention: number = 20000;

  constructor(
    maxCapacity: number = EngineConfig.store.maxCapacity,
    retentionMs: number = EngineConfig.store.retentionMs,
    dedupDistanceKm: number = EngineConfig.store.dedupDistanceKm,
    dedupTimeWindowMs: number = EngineConfig.store.dedupTimeWindowMs
  ) {
    this.maxCapacity = maxCapacity;
    this.retentionMs = retentionMs;
    this.deduplicator = new EventDeduplicator(dedupDistanceKm, dedupTimeWindowMs);
  }

  /**
   * Adds an event to the store.
   * Rejects duplicates via exact ID match or EventDeduplicator.
   * Enforces FIFO capacity limit.
   */
  public addEvent(event: LightningEvent, notifySubscribers: boolean = true): boolean {
    this.totalReceived++;

    // 0. Exact ID deduplication check
    if (this.seenIds.has(event.id)) {
      this.exactIdDuplicatesRejected++;
      return false;
    }

    // 1. Spatial/Temporal deduplication check
    if (this.deduplicator.isDuplicate(event)) {
      return false;
    }

    // Record ID in LRU cache
    this.seenIds.add(event.id);
    this.idFifo.push(event.id);
    if (this.idFifo.length > this.maxIdRetention) {
      const oldestId = this.idFifo.shift();
      if (oldestId) this.seenIds.delete(oldestId);
    }

    // 2. Periodic temporal pruning (every 2000ms)
    const now = event.timestamp || Date.now();
    if (now - this.lastPruneTime > 2000) {
      this.prune(now);
      this.lastPruneTime = now;
    }

    // 3. Chronological insertion (handle rare network jitter)
    if (
      this.events.length === 0 ||
      event.timestamp >= this.events[this.events.length - 1].timestamp
    ) {
      this.events.push(event);
    } else {
      const idx = this.binarySearchInsertIndex(event.timestamp);
      this.events.splice(idx, 0, event);
    }

    // 4. Strict FIFO capacity enforcement
    if (this.events.length > this.maxCapacity) {
      const excess = this.events.length - this.maxCapacity;
      this.events.splice(0, excess);
    }

    // 5. Notify reactive subscribers (skip if silent historical insertion)
    if (notifySubscribers) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error('EventStore subscriber error:', err);
        }
      }
    }

    return true;
  }

  /**
   * Retrieves events within the specified time window back from now.
   * Uses O(log N) binary search for instant slicing.
   */
  public getRecentEvents(windowMs: number): LightningEvent[] {
    if (this.events.length === 0) return [];

    const now = Date.now();
    const cutoff = now - windowMs;

    const startIdx = this.findEarliestIndexAtOrAfter(cutoff);
    if (startIdx >= this.events.length) return [];

    return this.events.slice(startIdx);
  }

  /**
   * Retrieves events within a given geographic radius and time window.
   * Utilizes bounding box pre-filtering before exact Haversine calculation.
   */
  public getEventsInArea(
    lat: number,
    lon: number,
    radiusKm: number,
    windowMs: number
  ): LightningEvent[] {
    const candidates = this.getRecentEvents(windowMs);
    if (candidates.length === 0) return [];

    // Fast Bounding Box pre-filter (1 deg lat ~ 111 km)
    const deltaLat = radiusKm / 110.0;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const deltaLon = radiusKm / (111.0 * Math.max(0.01, Math.abs(cosLat)));

    const minLat = lat - deltaLat;
    const maxLat = lat + deltaLat;

    // Normalizing longitude bounds
    let minLon = lon - deltaLon;
    let maxLon = lon + deltaLon;
    const crossesDateline = minLon < -180 || maxLon > 180;

    const matched: LightningEvent[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const ev = candidates[i];

      // 1. Latitude bounding check
      if (ev.latitude < minLat || ev.latitude > maxLat) continue;

      // 2. Longitude bounding check
      if (!crossesDateline) {
        if (ev.longitude < minLon || ev.longitude > maxLon) continue;
      }

      // 3. Exact spherical Haversine distance verification
      const dist = haversineDistanceKm(lat, lon, ev.latitude, ev.longitude);
      if (dist <= radiusKm) {
        matched.push(ev);
      }
    }

    return matched;
  }

  /**
   * Prunes all events older than retentionMs.
   */
  public prune(now: number = Date.now()): number {
    if (this.events.length === 0) return 0;

    const cutoff = now - this.retentionMs;
    const firstValidIdx = this.findEarliestIndexAtOrAfter(cutoff);

    if (firstValidIdx > 0) {
      this.events.splice(0, firstValidIdx);
      return firstValidIdx;
    }

    return 0;
  }

  /**
   * Subscribes a listener to newly added events.
   * Returns an unsubscribe function.
   */
  public subscribe(listener: (event: LightningEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getStats(): StoreStats {
    const oldest = this.events.length > 0 ? this.events[0].timestamp : null;
    const newest = this.events.length > 0 ? this.events[this.events.length - 1].timestamp : null;

    return {
      totalReceived: this.totalReceived,
      totalStored: this.events.length,
      totalDuplicatesRejected: this.deduplicator.getDuplicateCount() + this.exactIdDuplicatesRejected,
      oldestEventTimestamp: oldest,
      newestEventTimestamp: newest
    };
  }

  public clear(): void {
    this.events = [];
    this.totalReceived = 0;
    this.exactIdDuplicatesRejected = 0;
    this.seenIds.clear();
    this.idFifo.length = 0;
    this.deduplicator.clear();
    this.lastPruneTime = 0;
  }

  public getEventCount(): number {
    return this.events.length;
  }

  // --- Binary Search Helpers ---

  private findEarliestIndexAtOrAfter(targetTimestamp: number): number {
    let low = 0;
    let high = this.events.length - 1;
    let result = this.events.length;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.events[mid].timestamp >= targetTimestamp) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return result;
  }

  private binarySearchInsertIndex(timestamp: number): number {
    let low = 0;
    let high = this.events.length;

    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.events[mid].timestamp <= timestamp) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }
}
