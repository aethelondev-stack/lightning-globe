import type { LightningEvent } from '../../types/lightning';
import type { LightningCluster, ClusterConfig } from '../../types/cluster';
import { EngineConfig } from '../../core/Config';
import { haversineDistanceKm, calculateSphericalCentroid } from '../../utils/coordinates';

/**
 * Disjoint Set Union (DSU) / Union-Find with path compression and rank optimization.
 */
class DisjointSetUnion {
  private parent: Int32Array;
  private rank: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
      this.rank[i] = 0;
    }
  }

  public find(i: number): number {
    let root = i;
    while (root !== this.parent[root]) {
      root = this.parent[root];
    }
    // Path compression
    let curr = i;
    while (curr !== root) {
      const nxt = this.parent[curr];
      this.parent[curr] = root;
      curr = nxt;
    }
    return root;
  }

  public connected(rootI: number, j: number): boolean {
    if (this.parent[j] === rootI) return true;
    return rootI === this.find(j);
  }

  public union(i: number, j: number): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI === rootJ) return;

    if (this.rank[rootI] < this.rank[rootJ]) {
      this.parent[rootI] = rootJ;
    } else if (this.rank[rootI] > this.rank[rootJ]) {
      this.parent[rootJ] = rootI;
    } else {
      this.parent[rootJ] = rootI;
      this.rank[rootI]++;
    }
  }
}

/**
 * ClusterEngine: High-performance real-time lightning event clustering engine.
 *
 * Algorithm:
 * 1. Spatial Grid Bucketing ($1.5^\circ$ bins with polar meridian convergence compensation).
 * 2. Antimeridian wrap-around for seamless +-180 degree cluster continuity.
 * 3. Disjoint Set Union (DSU) connected components for linear O(N) execution.
 * 4. Noise rejection: filters out clusters with eventCount < minClusterEvents.
 * 5. Spherical centroid via 3D Cartesian vector summation.
 * 6. Minimum bounding radius clamping (min 25 km).
 *
 * Referencing PROJECT_SPEC.md Section 6 & RESEARCH_REPORT.md Section 13.
 */
export class ClusterEngine {
  private readonly spatialRadiusKm: number;
  private readonly temporalWindowMs: number;
  private readonly minClusterEvents: number;
  private readonly minBoundingRadiusKm: number;

  // Grid resolution in degrees (1.5 degrees ~ 166.8 km at equator)
  private readonly gridResolutionDeg: number = 1.5;
  private readonly numLonBins: number;
  private readonly maxLatDeltaDeg: number;
  private readonly spatialRadiusKmSq: number;

  constructor(config?: Partial<ClusterConfig>) {
    this.spatialRadiusKm = config?.spatialRadiusKm ?? EngineConfig.clustering.spatialRadiusKm;
    this.temporalWindowMs = config?.temporalWindowMs ?? EngineConfig.clustering.temporalWindowMs;
    this.minClusterEvents = config?.minClusterEvents ?? EngineConfig.clustering.minClusterEvents;
    this.minBoundingRadiusKm = config?.minBoundingRadiusKm ?? EngineConfig.clustering.minBoundingRadiusKm;

    this.numLonBins = Math.round(360 / this.gridResolutionDeg);
    this.maxLatDeltaDeg = this.spatialRadiusKm / 110.0;
    this.spatialRadiusKmSq = this.spatialRadiusKm * this.spatialRadiusKm;
  }

  /**
   * Generates a collision-free 32-bit positive integer spatial key with positive offset.
   * Offsetting latBin by +1000 and lonBin by +2000 prevents sign-bit collisions on negative coordinates.
   */
  private getSpatialKey(latBin: number, lonBin: number): number {
    return ((latBin + 1000) << 16) | (lonBin + 2000);
  }

  /**
   * Partitions candidate lightning events into meteorological storm clusters.
   *
   * @param events Array of input events (e.g. from LiveEventStore over last 10 minutes)
   * @param referenceTimeMs Optional timestamp reference for temporal window filtering (defaults to Date.now())
   * @returns Array of active LightningCluster domain objects
   */
  public clusterEvents(events: LightningEvent[], referenceTimeMs: number = Date.now()): LightningCluster[] {
    if (events.length === 0) {
      return [];
    }

    // 1. Filter events within the active temporal window
    const cutoffTime = referenceTimeMs - this.temporalWindowMs;
    const activeEvents: LightningEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i].timestamp >= cutoffTime) {
        activeEvents.push(events[i]);
      }
    }

    const n = activeEvents.length;
    if (n < this.minClusterEvents) {
      return [];
    }

    // Sort active events by latitude once (O(N log N)).
    // This guarantees that all grid cells store event indices in strictly ascending latitude order,
    // allowing O(1) early-break pruning in spatial candidate neighbor queries.
    activeEvents.sort((a, b) => a.latitude - b.latitude);

    // 2. Spatial Grid Bucketing (Zero-allocation integer keying)
    // Map integer cellKey -> array of event indices
    const grid = new Map<number, number[]>();

    for (let i = 0; i < n; i++) {
      const ev = activeEvents[i];
      const latBin = Math.floor((ev.latitude + 90) / this.gridResolutionDeg);
      const lonBin = Math.floor(((((ev.longitude + 180) % 360) + 360) % 360) / this.gridResolutionDeg);
      const cellKey = this.getSpatialKey(latBin, lonBin);

      let cell = grid.get(cellKey);
      if (!cell) {
        cell = [];
        grid.set(cellKey, cell);
      }
      cell.push(i);
    }

    // 3. Connect neighboring events using Disjoint Set Union (DSU)
    // Group candidate lookups by grid cell to eliminate redundant map lookups and math
    const dsu = new DisjointSetUnion(n);

    for (const [cellKey, cellEvents] of grid.entries()) {
      // Decode latBin and lonBin from positive integer key:
      // cellKey = ((latBin + 1000) << 16) | (lonBin + 2000)
      const latBin = (cellKey >> 16) - 1000;
      const lonBin = (cellKey & 0xffff) - 2000;

      const cellLat = (latBin + 0.5) * this.gridResolutionDeg - 90;
      const cosLat = Math.max(0.05, Math.cos((Math.abs(cellLat) * Math.PI) / 180));
      const dLonBins = Math.min(
        Math.floor(this.numLonBins / 2),
        Math.ceil(1.0 / cosLat)
      );

      // Pre-collect non-empty neighbor candidate arrays once for this cell
      const neighborCandidateArrays: number[][] = [];
      for (let dLat = 0; dLat <= 1; dLat++) {
        const neighborLatBin = latBin + dLat;
        if (neighborLatBin < 0 || neighborLatBin * this.gridResolutionDeg > 180) {
          continue;
        }

        const minLon = dLat === 0 ? 0 : -dLonBins;
        for (let dLon = minLon; dLon <= dLonBins; dLon++) {
          const neighborLonBin = ((lonBin + dLon) % this.numLonBins + this.numLonBins) % this.numLonBins;
          const neighborKey = this.getSpatialKey(neighborLatBin, neighborLonBin);
          const cellCandidates = grid.get(neighborKey);
          if (cellCandidates && cellCandidates.length > 0) {
            neighborCandidateArrays.push(cellCandidates);
          }
        }
      }

      // Iterate events in this cell against the collected neighbor candidate arrays
      for (let e = 0; e < cellEvents.length; e++) {
        const i = cellEvents[e];
        const evA = activeEvents[i];
        let rootI = dsu.find(i);

        for (let a = 0; a < neighborCandidateArrays.length; a++) {
          const candidates = neighborCandidateArrays[a];
          for (let c = 0; c < candidates.length; c++) {
            const j = candidates[c];
            // Only inspect pairs once (j > i)
            if (j <= i) continue;

            const evB = activeEvents[j];
            // Sorted latitude pruning: Since cell candidates are sorted by latitude,
            // once evB.latitude - evA.latitude exceeds threshold, all remaining
            // elements in this cell are guaranteed to exceed it as well.
            if (evB.latitude - evA.latitude > this.maxLatDeltaDeg) {
              break;
            }

            // Early exit if already in the same connected component
            if (dsu.connected(rootI, j)) continue;

            // Fast bounding box rejection on longitude (accounting for meridian convergence and antimeridian)
            let dLonDeg = Math.abs(evA.longitude - evB.longitude);
            if (dLonDeg > 180) dLonDeg = 360 - dLonDeg;
            if (dLonDeg * cosLat > this.maxLatDeltaDeg) continue;

            // Planar squared distance approximation (< 0.01% error for r <= 50km, zero trigonometry)
            const dLatKm = (evB.latitude - evA.latitude) * 111.195;
            const dLonKm = dLonDeg * cosLat * 111.195;
            const distSq = dLatKm * dLatKm + dLonKm * dLonKm;

            if (distSq <= this.spatialRadiusKmSq) {
              dsu.union(i, j);
              rootI = dsu.find(i);
            }
          }
        }
      }
    }

    // 4. Group events by connected component root
    const clustersMap = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const root = dsu.find(i);
      let group = clustersMap.get(root);
      if (!group) {
        group = [];
        clustersMap.set(root, group);
      }
      group.push(i);
    }

    // 5. Build and validate cluster models (filter noise)
    const clusters: LightningCluster[] = [];

    for (const [_, indices] of clustersMap.entries()) {
      if (indices.length < this.minClusterEvents) {
        // Reject isolated noise strikes
        continue;
      }

      const clusterEvents: LightningEvent[] = [];
      let minTime = Infinity;
      let maxTime = -Infinity;
      let earliestEvent = activeEvents[indices[0]];

      for (let k = 0; k < indices.length; k++) {
        const ev = activeEvents[indices[k]];
        clusterEvents.push(ev);

        if (ev.timestamp < minTime) {
          minTime = ev.timestamp;
          earliestEvent = ev;
        }
        if (ev.timestamp > maxTime) {
          maxTime = ev.timestamp;
        }
      }

      // True 3D Cartesian spherical centroid (passed directly without intermediate array allocation)
      const centroid = calculateSphericalCentroid(clusterEvents);

      // Fast bounding radius calculation:
      // Identify outermost candidate event using monotonic equirectangular squared distance (zero trig in loop),
      // then compute exact Haversine distance once for that extremal event.
      const centroidCosLat = Math.cos((centroid.latitude * Math.PI) / 180);
      let maxDistSq = 0;
      let outermostEvent = clusterEvents[0];

      for (let k = 0; k < clusterEvents.length; k++) {
        const ev = clusterEvents[k];
        const dLat = ev.latitude - centroid.latitude;
        let dLon = Math.abs(ev.longitude - centroid.longitude);
        if (dLon > 180) dLon = 360 - dLon;
        const dLonScaled = dLon * centroidCosLat;
        const distSq = dLat * dLat + dLonScaled * dLonScaled;

        if (distSq > maxDistSq) {
          maxDistSq = distSq;
          outermostEvent = ev;
        }
      }

      const maxDistKm = haversineDistanceKm(
        centroid.latitude,
        centroid.longitude,
        outermostEvent.latitude,
        outermostEvent.longitude
      );

      // Clamp bounding radius to minimum specified radius
      const boundingRadiusKm = Math.max(maxDistKm, this.minBoundingRadiusKm);

      // Deterministic cluster ID derived from the earliest event ID
      const clusterId = `cluster_${earliestEvent.id}`;

      clusters.push({
        id: clusterId,
        centroid,
        boundingRadiusKm: Math.round(boundingRadiusKm * 10) / 10,
        eventCount: clusterEvents.length,
        events: clusterEvents,
        firstEventTimestamp: minTime,
        lastEventTimestamp: maxTime
      });
    }

    // Sort clusters by event count descending (most active storm cells first)
    clusters.sort((a, b) => b.eventCount - a.eventCount);

    return clusters;
  }
}
