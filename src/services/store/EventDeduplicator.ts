import type { LightningEvent } from '../../types/lightning';
import { haversineDistanceKm } from '../../utils/coordinates';
import { EngineConfig } from '../../core/Config';

interface CachedStrike {
  id: string;
  lat: number;
  lon: number;
  timestamp: number;
}

/**
 * High-performance spatial-temporal deduplication engine.
 * Utilizes a 0.15° hash grid with antimeridian wrap-around and neighbor checking
 * to detect and eliminate duplicate strikes in O(1) amortized time.
 * Referencing ARCHITECTURE.md Section 1 & 2
 */
export class EventDeduplicator {
  private readonly gridResolutionDeg: number = 0.15; // ~16.6 km at equator
  private readonly dedupDistanceKm: number;
  private readonly dedupTimeWindowMs: number;
  private readonly cacheRetentionMs: number = 1200; // 1.2s eviction window

  // Spatial grid map: gridKey -> list of recent strikes in this cell
  private grid: Map<string, CachedStrike[]> = new Map();
  private totalChecked: number = 0;
  private totalDuplicates: number = 0;
  private lastEvictionTime: number = 0;

  constructor(
    dedupDistanceKm: number = EngineConfig.store.dedupDistanceKm,
    dedupTimeWindowMs: number = EngineConfig.store.dedupTimeWindowMs
  ) {
    this.dedupDistanceKm = dedupDistanceKm;
    this.dedupTimeWindowMs = dedupTimeWindowMs;
  }

  /**
   * Evaluates whether an incoming event is a duplicate of a recently recorded strike.
   * If not duplicate, records the strike into the spatial cache.
   *
   * @param event The candidate LightningEvent
   * @returns true if duplicate (should be rejected), false if unique (should be accepted)
   */
  public isDuplicate(event: LightningEvent): boolean {
    this.totalChecked++;
    const now = event.timestamp || Date.now();

    // Periodic cache eviction (every 1000ms)
    if (now - this.lastEvictionTime > 1000) {
      this.evictStaleEntries(now);
      this.lastEvictionTime = now;
    }

    const latBin = Math.floor(event.latitude / this.gridResolutionDeg);
    const lonBin = Math.floor(event.longitude / this.gridResolutionDeg);

    // Total longitude bins on the globe [-180, 180] with 0.15° step = 2400 bins
    const maxLonBins = Math.round(360 / this.gridResolutionDeg);
    const halfLonBins = maxLonBins / 2;

    // Check target cell + 8 neighbor cells to ensure boundary proximity is caught
    for (let dLat = -1; dLat <= 1; dLat++) {
      const neighborLatBin = latBin + dLat;

      for (let dLon = -1; dLon <= 1; dLon++) {
        let neighborLonBin = lonBin + dLon;

        // Antimeridian Wrap-Around (+180° / -180° crossing)
        if (neighborLonBin >= halfLonBins) {
          neighborLonBin -= maxLonBins;
        } else if (neighborLonBin < -halfLonBins) {
          neighborLonBin += maxLonBins;
        }

        const cellKey = `${neighborLatBin}:${neighborLonBin}`;
        const cellStrikes = this.grid.get(cellKey);

        if (cellStrikes && cellStrikes.length > 0) {
          for (let i = 0; i < cellStrikes.length; i++) {
            const cached = cellStrikes[i];

            // 1. Check temporal window (|t1 - t2| <= dedupTimeWindowMs)
            const timeDiff = Math.abs(now - cached.timestamp);
            if (timeDiff <= this.dedupTimeWindowMs) {
              // 2. Check spherical Haversine distance
              const distKm = haversineDistanceKm(
                event.latitude,
                event.longitude,
                cached.lat,
                cached.lon
              );

              if (distKm <= this.dedupDistanceKm) {
                this.totalDuplicates++;
                return true; // Duplicate detected!
              }
            }
          }
        }
      }
    }

    // Not a duplicate: record into the target cell
    const targetKey = `${latBin}:${lonBin}`;
    let targetCell = this.grid.get(targetKey);
    if (!targetCell) {
      targetCell = [];
      this.grid.set(targetKey, targetCell);
    }

    targetCell.push({
      id: event.id,
      lat: event.latitude,
      lon: event.longitude,
      timestamp: now
    });

    return false;
  }

  /**
   * Purges cache entries older than cacheRetentionMs to guarantee constant O(1) memory
   */
  private evictStaleEntries(now: number): void {
    const cutoff = now - this.cacheRetentionMs;

    for (const [key, strikes] of this.grid.entries()) {
      const fresh = strikes.filter((s) => s.timestamp >= cutoff);
      if (fresh.length === 0) {
        this.grid.delete(key);
      } else if (fresh.length !== strikes.length) {
        this.grid.set(key, fresh);
      }
    }
  }

  public getDuplicateCount(): number {
    return this.totalDuplicates;
  }

  public getTotalChecked(): number {
    return this.totalChecked;
  }

  public clear(): void {
    this.grid.clear();
    this.totalChecked = 0;
    this.totalDuplicates = 0;
    this.lastEvictionTime = 0;
  }
}
