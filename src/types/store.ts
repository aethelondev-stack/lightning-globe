import type { LightningEvent } from './lightning';

/**
 * Real-time operational statistics of the EventStore
 */
export interface StoreStats {
  totalReceived: number;
  totalStored: number;
  totalDuplicatesRejected: number;
  oldestEventTimestamp: number | null;
  newestEventTimestamp: number | null;
}

/**
 * Interface for the centralized, bounded event store.
 * Decouples data ingestion and deduplication from rendering and clustering.
 * Referencing ARCHITECTURE.md Section 4
 */
export interface IEventStore {
  /**
   * Adds an event to the store if it passes spatial/temporal deduplication.
   * @returns true if stored, false if rejected as duplicate
   */
  addEvent(event: LightningEvent, notifySubscribers?: boolean): boolean;

  /**
   * Returns all stored events within the specified time window back from now.
   * @param windowMs Time window in milliseconds (e.g. 5 * 60 * 1000 for last 5 minutes)
   */
  getRecentEvents(windowMs: number): LightningEvent[];

  /**
   * Retrieves events within a spherical radius and time window (used by Phase 5 clustering).
   * @param lat Center latitude in degrees
   * @param lon Center longitude in degrees
   * @param radiusKm Spherical radius in kilometers
   * @param windowMs Time window in milliseconds
   */
  getEventsInArea(lat: number, lon: number, radiusKm: number, windowMs: number): LightningEvent[];

  /**
   * Returns current store size and throughput metrics.
   */
  getStats(): StoreStats;

  /**
   * Clears all stored events and resets metrics.
   */
  clear(): void;

  /**
   * Subscribes a listener to newly stored (non-duplicate) events.
   * @returns An unsubscribe cleanup function
   */
  subscribe(listener: (event: LightningEvent) => void): () => void;
}
