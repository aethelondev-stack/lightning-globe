import type { LightningEvent } from '../../types/lightning';
import type { StormCell, StormCellWarningLevel, StormCellTier, MeteorologicalStormClass, MicroHotspot, StormPropagationVector, FusionState } from '../../types/cluster';
import { haversineDistanceKm, calculateSphericalCentroid } from '../../utils/coordinates';

export interface StormCellBatcherConfig {
  windowMs?: number;          // Sliding window duration (default 30,000 ms)
  minStrikes?: number;         // Threshold for active storm cell (default 5 strikes)
  spatialRadiusKm?: number;    // Clustering linking distance (default 48 km)
  minRadiusKm?: number;        // Minimum visual radius clamp (default 30 km)
  maxRadiusKm?: number;        // Maximum bound radius clamp (default 220 km)
}

const TIER_PRIORITY: Record<StormCellTier, number> = {
  EXTREME: 5,
  RED: 4,
  YELLOW: 3,
  BLUE: 2,
  WHITE: 1
};

/**
 * Exact storm class inactivity timeout duration lookup table from Excel configuration:
 * If no new strikes occur in a storm cell for this duration, it gracefully dissolves.
 */
export const STORM_CLASS_TIMEOUT_MS: Record<MeteorologicalStormClass, number> = {
  ISOLATED: 3 * 60 * 1000,          // 3 dakika (180s)
  SINGLE_CELL: 5 * 60 * 1000,       // 5 dakika (300s)
  MULTICELL: 8 * 60 * 1000,         // 8 dakika (480s)
  SUPERCELL: 15 * 60 * 1000,        // 15 dakika (900s)
  MCS: 20 * 60 * 1000,              // 20 dakika (1200s)
  SQUALL_LINE: 30 * 60 * 1000,      // 30 dakika (1800s)
  EXTREME_OUTBREAK: 45 * 60 * 1000  // 45 dakika (2700s)
};

export function getStormClassTimeoutMs(stormClass?: MeteorologicalStormClass): number {
  if (stormClass && STORM_CLASS_TIMEOUT_MS[stormClass]) {
    return STORM_CLASS_TIMEOUT_MS[stormClass];
  }
  return 5 * 60 * 1000;
}

/**
 * Disjoint Set Union (DSU) helper for linear spatial clustering.
 */
class CellDSU {
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
    let curr = i;
    while (curr !== root) {
      const nxt = this.parent[curr];
      this.parent[curr] = root;
      curr = nxt;
    }
    return root;
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
 * Computes density and intensity weighted centroid (center of mass).
 * Centers the honeycomb over the most active core of strikes.
 * Dead-Zone Guard: if mathematical center-of-mass falls into an empty void (>18km from any strike,
 * such as bimodal or concave clusters), snaps centroid to the medoid of the densest strike core.
 */
function calculateDensityWeightedCentroid(events: LightningEvent[]): { latitude: number; longitude: number } {
  if (events.length === 0) return { latitude: 0, longitude: 0 };
  if (events.length === 1) return { latitude: events[0].latitude, longitude: events[0].longitude };

  // Fast O(N) spatial density binning (~37 km resolution: factor 3 = 0.333 deg)
  const binGrid = new Map<string, { count: number; events: LightningEvent[] }>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const key = `${Math.floor(e.latitude * 3)}_${Math.floor(e.longitude * 3)}`;
    let entry = binGrid.get(key);
    if (!entry) {
      entry = { count: 0, events: [] };
      binGrid.set(key, entry);
    }
    entry.count++;
    entry.events.push(e);
  }

  // Identify the densest strike core bin
  let maxBinCount = 0;
  let densestBinEvents: LightningEvent[] = events;
  for (const entry of binGrid.values()) {
    if (entry.count > maxBinCount) {
      maxBinCount = entry.count;
      densestBinEvents = entry.events;
    }
  }

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let totalWeight = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const intensityWeight = 1.0 + Math.min(100, Math.abs(ev.peakCurrent ?? 35)) / 80;
    const key = `${Math.floor(ev.latitude * 3)}_${Math.floor(ev.longitude * 3)}`;
    const localDensity = binGrid.get(key)?.count ?? 1;
    // Emphasize local density so the centroid prioritizes dense convective clusters over dispersed outliers
    const weight = intensityWeight * (1.0 + Math.log2(localDensity)) * Math.sqrt(localDensity);

    const latRad = (ev.latitude * Math.PI) / 180;
    const lonRad = (ev.longitude * Math.PI) / 180;

    sumX += weight * Math.cos(latRad) * Math.cos(lonRad);
    sumY += weight * Math.cos(latRad) * Math.sin(lonRad);
    sumZ += weight * Math.sin(latRad);
    totalWeight += weight;
  }

  let lat = 0;
  let lon = 0;

  if (totalWeight === 0) {
    const spherical = calculateSphericalCentroid(events);
    lat = spherical.latitude;
    lon = spherical.longitude;
  } else {
    const avgX = sumX / totalWeight;
    const avgY = sumY / totalWeight;
    const avgZ = sumZ / totalWeight;

    const hyp = Math.hypot(avgX, avgY);
    lat = (Math.atan2(avgZ, hyp) * 180) / Math.PI;
    lon = (Math.atan2(avgY, avgX) * 180) / Math.PI;
  }

  // DEAD-ZONE GUARD:
  // Measure distance from the computed center-of-mass to the closest real strike in this cluster.
  let minStrikeDist = Infinity;
  for (let i = 0; i < events.length; i++) {
    const d = haversineDistanceKm(lat, lon, events[i].latitude, events[i].longitude);
    if (d < minStrikeDist) {
      minStrikeDist = d;
      if (minStrikeDist <= 10) break; // Already directly atop lightning activity
    }
  }

  // If the centroid drifted > 18 km away from all strikes (i.e. into a dead zone / empty gap),
  // snap the centroid directly onto the medoid of the densest strike core.
  if (minStrikeDist > 18) {
    let bestStrike = densestBinEvents[0];
    let minInnerDistSum = Infinity;

    for (let i = 0; i < densestBinEvents.length; i++) {
      let sumDist = 0;
      const si = densestBinEvents[i];
      for (let j = 0; j < densestBinEvents.length; j++) {
        if (i !== j) {
          sumDist += haversineDistanceKm(si.latitude, si.longitude, densestBinEvents[j].latitude, densestBinEvents[j].longitude);
        }
      }
      if (sumDist < minInnerDistSum) {
        minInnerDistSum = sumDist;
        bestStrike = si;
      }
    }

    lat = bestStrike.latitude;
    lon = bestStrike.longitude;
  }

  return { latitude: lat, longitude: lon };
}

interface TrackedStormCellInternal {
  id: string;
  centroid: { latitude: number; longitude: number };
  boundingRadiusKm: number;
  strikeCount: number;
  events: LightningEvent[];
  firstSeen: number;
  lastSeen: number;
  meanIntensity: number;
  heartbeatRemainingMs: number; // 30,000 ms sliding countdown
  fadeProgress: number;          // 0.0 (active) -> 1.0 (fully dissolved)
  isFading: boolean;
  tier: StormCellTier;
  warningLevel?: StormCellWarningLevel;
  stormClass?: MeteorologicalStormClass;
  stormClassLabel?: string;
  hourlyCentroids: Array<{ lat: number; lon: number; timestamp: number }>;
  fusionProgress?: number;
  fusingWith?: string;
  fusionTargetId?: string;
  fusionMidLat?: number;
  fusionMidLon?: number;
  lastFusionCheckTime?: number;
}

/**
 * StormCellBatcher: Manages an intelligent 30-second sliding heartbeat storm cell engine (Phase 19, 23).
 *
 * Key Capabilities:
 * - 30s sliding heartbeat renewal: Each strike inside cell boundaries resets countdown to 30,000ms.
 * - Soft fade-out: If 30 seconds elapse without strikes, enters smooth 2.5s fade-out.
 * - Density-weighted centroid: Centered at true center-of-mass of lightning activity.
 * - Dynamic bounded resizing: Expands/contracts based on strike spread, strictly clamped <= 220 km.
 * - 3-Tier warning tone shift: NORMAL (Electric Cyan) -> ELEVATED (Radiant Amber) -> CRITICAL (Neon Crimson).
 */
export class StormCellBatcher {
  private readonly windowMs: number;
  private readonly minStrikes: number;
  private readonly spatialRadiusKm: number;
  private readonly minRadiusKm: number;
  private readonly maxRadiusKm: number;
  private readonly isCustomWindowMs: boolean;

  private buffer: LightningEvent[] = [];
  private cached24hCells: StormCell[] = [];
  private cachedSessionCells: StormCell[] = [];
  private lastComputeTime: number = 0;
  private mode: '24H' | 'SESSION' = '24H';
  private trackedCells: Map<string, TrackedStormCellInternal> = new Map();

  constructor(config?: StormCellBatcherConfig) {
    this.isCustomWindowMs = config?.windowMs !== undefined;
    this.windowMs = config?.windowMs ?? (4 * 3600 * 1000); // Default 4 hours persistence
    this.minStrikes = config?.minStrikes ?? 3;
    this.spatialRadiusKm = config?.spatialRadiusKm ?? 48;
    this.minRadiusKm = config?.minRadiusKm ?? 20;
    this.maxRadiusKm = config?.maxRadiusKm ?? 220;
    if (config?.windowMs !== undefined) {
      this.mode = 'SESSION';
    }
  }

  public getTimeoutForCell(stormClass?: MeteorologicalStormClass): number {
    if (this.isCustomWindowMs) {
      return this.windowMs;
    }
    return getStormClassTimeoutMs(stormClass);
  }

  public setMode(mode: '24H' | 'SESSION'): void {
    this.mode = mode;
  }

  public getMode(): '24H' | 'SESSION' {
    return this.mode;
  }

  public addHistoricalStrikes(strikes: LightningEvent[]): void {
    this.recompute24hCells(strikes, Date.now());
  }

  /**
   * Pre-clusters 24-hour historical strikes into distinct regional storm cells.
   * Executed once on hydration — guarantees 0ms overhead during animation loop.
   */
  public recompute24hCells(strikes: LightningEvent[], now: number = Date.now()): void {
    if (!strikes || strikes.length === 0) {
      this.cached24hCells = [];
      return;
    }

    const cutoff = now - 86400000;
    const validStrikes = strikes.filter((s) => s.timestamp >= cutoff);
    if (validStrikes.length === 0) {
      this.cached24hCells = [];
      return;
    }

    // High-fidelity 0.5 degree spatial binning (~55 km)
    const binSize = 0.5;
    const grid = new Map<string, LightningEvent[]>();

    for (let i = 0; i < validStrikes.length; i++) {
      const s = validStrikes[i];
      const latBin = Math.floor(s.latitude / binSize);
      const lonBin = Math.floor(s.longitude / binSize);
      const key = `${latBin}_${lonBin}`;
      const list = grid.get(key);
      if (list) {
        list.push(s);
      } else {
        grid.set(key, [s]);
      }
    }

    const groups: LightningEvent[][] = [];
    const visitedKeys = new Set<string>();

    for (const [key, events] of grid) {
      if (visitedKeys.has(key)) continue;
      visitedKeys.add(key);

      const [latB, lonB] = key.split('_').map(Number);
      const clusterEvents = [...events];

      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLon = -1; dLon <= 1; dLon++) {
          if (dLat === 0 && dLon === 0) continue;
          const nKey = `${latB + dLat}_${lonB + dLon}`;
          const nEvents = grid.get(nKey);
          if (nEvents && !visitedKeys.has(nKey)) {
            visitedKeys.add(nKey);
            clusterEvents.push(...nEvents);
          }
        }
      }

      if (clusterEvents.length >= Math.min(this.minStrikes, 3)) {
        groups.push(clusterEvents);
      }
    }

    const result: StormCell[] = [];

    for (let g = 0; g < groups.length; g++) {
      const evs = groups[g];
      const centroid = calculateDensityWeightedCentroid(evs);

      let firstSeen = evs[0].timestamp;
      let lastSeen = evs[0].timestamp;
      let totalCurrent = 0;
      let maxDistKm = 0;

      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.timestamp < firstSeen) firstSeen = e.timestamp;
        if (e.timestamp > lastSeen) lastSeen = e.timestamp;
        totalCurrent += Math.abs(e.peakCurrent ?? 35);
        const d = haversineDistanceKm(centroid.latitude, centroid.longitude, e.latitude, e.longitude);
        if (d > maxDistKm) maxDistKm = d;
      }

      const clusterSpanMinutes = (lastSeen - firstSeen) / 60000;
      const dynamicRadius = Math.max(this.minRadiusKm, Math.min(this.maxRadiusKm, maxDistKm));
      const stormEval = classifyMeteorologicalStorm(dynamicRadius, clusterSpanMinutes, evs.length);
      const tier = stormEval.tier;

      // Calculate micro-hotspots using 7-rosette geometry
      const dummyInternal: TrackedStormCellInternal = {
        id: `24h-cell-${g}`,
        centroid,
        boundingRadiusKm: dynamicRadius,
        strikeCount: evs.length,
        events: evs,
        firstSeen,
        lastSeen,
        meanIntensity: totalCurrent / evs.length,
        heartbeatRemainingMs: 86400000,
        fadeProgress: 0,
        isFading: false,
        tier,
        stormClass: stormEval.stormClass,
        stormClassLabel: stormEval.label,
        hourlyCentroids: []
      };
      const hotspots = computeMicroHotspots(dummyInternal, now);

      const cell: StormCell = {
        id: `24h-cell-${Math.round(centroid.latitude * 10)}_${Math.round(centroid.longitude * 10)}`,
        centroid,
        boundingRadiusKm: dynamicRadius,
        strikeCount: evs.length,
        events: evs,
        firstSeen,
        lastSeen,
        ageSeconds: Math.round((now - firstSeen) / 1000),
        meanIntensity: totalCurrent / evs.length,
        warningLevel: tier === 'RED' ? 'CRITICAL' : (tier === 'YELLOW' ? 'ELEVATED' : 'NORMAL'),
        tier,
        stormClass: stormEval.stormClass,
        stormClassLabel: stormEval.label,
        subHotspots: hotspots,
        heartbeatRemainingMs: 86400000,
        fadeProgress: 0
      };

      result.push(cell);
    }

    result.sort((a, b) => (TIER_PRIORITY[b.tier ?? 'WHITE'] - TIER_PRIORITY[a.tier ?? 'WHITE']) || (b.strikeCount - a.strikeCount));

    // Spatial Agglomeration: merge candidate cells within 48 km (preserving separate regional systems like coastal lines while merging local sub-cells)
    const aggregatedCells: StormCell[] = [];
    const minSeparationKm = 48;

    for (let c = 0; c < result.length; c++) {
      const candidate = result[c];
      let merged = false;

      for (let a = 0; a < aggregatedCells.length; a++) {
        const primary = aggregatedCells[a];
        const dist = haversineDistanceKm(
          candidate.centroid.latitude,
          candidate.centroid.longitude,
          primary.centroid.latitude,
          primary.centroid.longitude
        );

        if (dist <= minSeparationKm) {
          // Merge candidate strikes into dominant primary cell
          primary.events.push(...candidate.events);
          primary.strikeCount += candidate.strikeCount;
          if (candidate.firstSeen < primary.firstSeen) primary.firstSeen = candidate.firstSeen;
          if (candidate.lastSeen > primary.lastSeen) primary.lastSeen = candidate.lastSeen;
          if (candidate.boundingRadiusKm > primary.boundingRadiusKm) primary.boundingRadiusKm = candidate.boundingRadiusKm;

          const totalSpan = Math.max(1, (primary.lastSeen - primary.firstSeen) / 60000);
          const stormEval = classifyMeteorologicalStorm(primary.boundingRadiusKm, totalSpan, primary.strikeCount);
          primary.tier = stormEval.tier;
          primary.stormClass = stormEval.stormClass;
          primary.stormClassLabel = stormEval.label;
          primary.warningLevel = primary.tier === 'RED' ? 'CRITICAL' : (primary.tier === 'YELLOW' ? 'ELEVATED' : 'NORMAL');

          // Recompute micro-hotspots for primary with combined strikes
          const dummyInternal: TrackedStormCellInternal = {
            id: primary.id,
            centroid: primary.centroid,
            boundingRadiusKm: primary.boundingRadiusKm,
            strikeCount: primary.strikeCount,
            events: primary.events,
            firstSeen: primary.firstSeen,
            lastSeen: primary.lastSeen,
            meanIntensity: primary.meanIntensity,
            heartbeatRemainingMs: 86400000,
            fadeProgress: 0,
            isFading: false,
            tier: primary.tier ?? 'WHITE',
            stormClass: primary.stormClass,
            stormClassLabel: primary.stormClassLabel,
            hourlyCentroids: []
          };
          primary.subHotspots = computeMicroHotspots(dummyInternal, now);
          merged = true;
          break;
        }
      }

      if (!merged) {
        aggregatedCells.push(candidate);
      }
    }

    // Ensure diverse representation of all 7 meteorological classes across the globe
    const classesOrder: MeteorologicalStormClass[] = ['EXTREME_OUTBREAK', 'SQUALL_LINE', 'MCS', 'SUPERCELL', 'MULTICELL', 'SINGLE_CELL', 'ISOLATED'];
    const selected: StormCell[] = [];
    const selectedIds = new Set<string>();

    // Pass 1: Ensure top representatives from each distinct storm class present
    for (const cls of classesOrder) {
      const candidatesOfClass = aggregatedCells
        .filter((c) => c.stormClass === cls && !selectedIds.has(c.id))
        .sort((a, b) => b.strikeCount - a.strikeCount);
      const toTake = candidatesOfClass.slice(0, 8);
      for (const c of toTake) {
        if (selected.length < 48) {
          selected.push(c);
          selectedIds.add(c.id);
        }
      }
    }

    // Pass 2: Fill any remaining slots with highest strike count cells
    const remaining = aggregatedCells
      .filter((c) => !selectedIds.has(c.id))
      .sort((a, b) => b.strikeCount - a.strikeCount);
    for (const c of remaining) {
      if (selected.length < 48) {
        selected.push(c);
        selectedIds.add(c.id);
      }
    }

    this.cached24hCells = selected.length > 0 ? selected : aggregatedCells.slice(0, 48);
  }

  /**
   * Ingests a single strike into the sliding buffer and updates matching tracked cell heartbeat.
   * Dynamically grows existing storm cells and spawns new cells in real time.
   */
  public addStrike(event: LightningEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > 2000) {
      this.buffer.shift();
    }

    let matched = false;
    // Live growth for 24H cells: expand radius and upgrade storm class
    for (const cell of this.cached24hCells) {
      const dist = haversineDistanceKm(event.latitude, event.longitude, cell.centroid.latitude, cell.centroid.longitude);
      if (dist <= Math.max(cell.boundingRadiusKm, 80)) {
        cell.lastSeen = event.timestamp;

        if (cell.id.startsWith('live-cell-')) {
          const activityCutoff = event.timestamp - (this.isCustomWindowMs ? this.windowMs : 5 * 60 * 1000);
          cell.events = cell.events.filter((e) => e.timestamp >= activityCutoff);
          cell.events.push(event);
          if (cell.events.length > 400) cell.events.shift();
          cell.strikeCount = cell.events.length;
          cell.boundingRadiusKm = Math.min(220, cell.boundingRadiusKm + 0.6);

          // Re-evaluate tier dynamically based on active convective intensity
          const evaluated = classifyMeteorologicalStorm(cell.boundingRadiusKm, 0, cell.strikeCount);
          if (TIER_PRIORITY[evaluated.tier] > TIER_PRIORITY[cell.tier ?? 'WHITE']) {
            cell.tier = evaluated.tier;
            cell.stormClass = evaluated.stormClass;
            cell.stormClassLabel = evaluated.label;
            cell.warningLevel = evaluated.tier === 'EXTREME' || evaluated.tier === 'RED' ? 'CRITICAL' : (evaluated.tier === 'YELLOW' ? 'ELEVATED' : 'NORMAL');
          }
        } else {
          cell.strikeCount++;
          cell.boundingRadiusKm = Math.min(650, cell.boundingRadiusKm + 0.6);
          cell.events.push(event);
          if (cell.events.length > 400) cell.events.shift();
        }
        matched = true;
        break;
      }
    }

    // Check if strike falls inside any existing tracked cell
    const redStepMs = this.isCustomWindowMs ? this.windowMs : 5 * 60 * 1000;
    const yellowStepMs = this.isCustomWindowMs ? this.windowMs : 4 * 60 * 1000;
    const blueStepMs = this.isCustomWindowMs ? this.windowMs : 3 * 60 * 1000;
    const whiteStepMs = this.isCustomWindowMs ? this.windowMs : 2 * 60 * 1000;

    for (const cell of this.trackedCells.values()) {
      const dist = haversineDistanceKm(event.latitude, event.longitude, cell.centroid.latitude, cell.centroid.longitude);
      if (dist <= Math.max(cell.boundingRadiusKm, this.spatialRadiusKm)) {
        cell.heartbeatRemainingMs = this.isCustomWindowMs ? this.windowMs : (
          cell.tier === 'RED' || cell.tier === 'EXTREME' ? redStepMs :
          cell.tier === 'YELLOW' ? yellowStepMs :
          cell.tier === 'BLUE' ? blueStepMs : whiteStepMs
        );
        cell.isFading = false;
        cell.fadeProgress = 0;
        cell.lastSeen = event.timestamp;

        // Rolling Activity Window (5 min or windowMs) to prevent single-strike resurrection
        const activityCutoff = event.timestamp - (this.isCustomWindowMs ? this.windowMs : 5 * 60 * 1000);
        cell.events = cell.events.filter((e) => e.timestamp >= activityCutoff);
        cell.events.push(event);
        if (cell.events.length > 400) cell.events.shift();
        cell.strikeCount = cell.events.length;

        // Re-evaluate tier dynamically based on active convective intensity
        const stormEval = classifyMeteorologicalStorm(cell.boundingRadiusKm, 0, cell.strikeCount);
        if (TIER_PRIORITY[stormEval.tier] > TIER_PRIORITY[cell.tier]) {
          cell.tier = stormEval.tier;
          cell.stormClass = stormEval.stormClass;
          cell.stormClassLabel = stormEval.label;
          cell.boundingRadiusKm = Math.max(cell.boundingRadiusKm, Math.min(220, 20 + cell.strikeCount * 0.8));
          cell.warningLevel = cell.tier === 'EXTREME' || cell.tier === 'RED' ? 'CRITICAL' : (cell.tier === 'YELLOW' ? 'ELEVATED' : 'NORMAL');
        }
      }
    }

    // Spawn new dynamic cell if this is a fresh cluster not covered by existing cells (O(1) search on recent slice)
    if (!matched) {
      const searchSlice = this.buffer.length > 80 ? this.buffer.slice(-80) : this.buffer;
      const recentNearby = searchSlice.filter(
        (e) => e !== event && haversineDistanceKm(event.latitude, event.longitude, e.latitude, e.longitude) <= 45
      );
      const count = recentNearby.length + 1;
      const evaluated = classifyMeteorologicalStorm(20, 0, count);
      const decayTime = count >= 220 ? 900000 : (count >= 90 ? 480000 : 180000); // 3m to 15m graceful decay

      const newCell: StormCell = {
        id: `live-cell-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        centroid: { latitude: event.latitude, longitude: event.longitude },
        boundingRadiusKm: Math.min(650, 15 + count * 0.8),
        events: [event, ...recentNearby],
        strikeCount: count,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        ageSeconds: 0,
        meanIntensity: Math.abs(event.peakCurrent ?? 25),
        stormClass: evaluated.stormClass,
        stormClassLabel: evaluated.label,
        tier: evaluated.tier,
        warningLevel: evaluated.tier === 'EXTREME' || evaluated.tier === 'RED' ? 'CRITICAL' : (evaluated.tier === 'YELLOW' ? 'ELEVATED' : 'NORMAL'),
        heartbeatRemainingMs: decayTime,
        fadeProgress: 0
      };

        if (this.cached24hCells.length < 56) {
          this.cached24hCells.push(newCell);
        } else {
          // Replace the coldest/least active 24h cell that has had NO strikes recently
          let coldestIdx = -1;
          let oldestTime = Infinity;
          for (let i = 0; i < this.cached24hCells.length; i++) {
            const c = this.cached24hCells[i];
            if (!c.id.startsWith('live-') && c.lastSeen < oldestTime) {
              oldestTime = c.lastSeen;
              coldestIdx = i;
            }
          }
          if (coldestIdx !== -1) {
            this.cached24hCells[coldestIdx] = newCell;
          } else {
            this.cached24hCells.push(newCell);
          }
        }
      }
    }

  /**
   * Ingests an array of strikes.
   */
  public addStrikes(events: LightningEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      this.addStrike(events[i]);
    }
  }

  /**
   * Evicts strikes older than the sliding window from candidate buffer.
   */
  public prune(now: number = Date.now()): void {
    const cutoff = now - this.windowMs;
    this.buffer = this.buffer.filter((e) => e.timestamp >= cutoff);
  }

  private demote24hLiveCells(now: number): void {
    const redStepMs = 5 * 60 * 1000;
    const yellowStepMs = 4 * 60 * 1000;
    const blueStepMs = 3 * 60 * 1000;
    const whiteStepMs = 2 * 60 * 1000;

    for (let i = this.cached24hCells.length - 1; i >= 0; i--) {
      const cell = this.cached24hCells[i];
      if (!cell.id.startsWith('live-cell-')) continue;

      const timeSinceLastStrike = now - cell.lastSeen;
      if (cell.tier === 'EXTREME' || cell.tier === 'RED') {
        if (timeSinceLastStrike >= redStepMs) {
          cell.tier = 'YELLOW';
          cell.stormClass = 'MULTICELL';
          cell.stormClassLabel = 'Çok Hücre (Multicell Cluster)';
          cell.boundingRadiusKm = Math.max(35, Math.min(cell.boundingRadiusKm * 0.75, 120));
          cell.lastSeen = now;
          cell.strikeCount = Math.min(cell.strikeCount, 95);
          cell.events = cell.events.slice(-95);
          cell.warningLevel = 'ELEVATED';
        }
      } else if (cell.tier === 'YELLOW') {
        if (timeSinceLastStrike >= yellowStepMs) {
          cell.tier = 'BLUE';
          cell.stormClass = 'SINGLE_CELL';
          cell.stormClassLabel = 'Tek Hücre (Single-Cell)';
          cell.boundingRadiusKm = Math.max(25, Math.min(cell.boundingRadiusKm * 0.7, 60));
          cell.lastSeen = now;
          cell.strikeCount = Math.min(cell.strikeCount, 35);
          cell.events = cell.events.slice(-35);
          cell.warningLevel = 'NORMAL';
        }
      } else if (cell.tier === 'BLUE') {
        if (timeSinceLastStrike >= blueStepMs) {
          cell.tier = 'WHITE';
          cell.stormClass = 'ISOLATED';
          cell.stormClassLabel = 'İzole Çakma (Isolated)';
          cell.boundingRadiusKm = Math.max(15, Math.min(cell.boundingRadiusKm * 0.6, 25));
          cell.lastSeen = now;
          cell.strikeCount = Math.min(cell.strikeCount, 8);
          cell.events = cell.events.slice(-8);
          cell.warningLevel = 'NORMAL';
        }
      } else {
        if (timeSinceLastStrike >= whiteStepMs + 3500) {
          this.cached24hCells.splice(i, 1);
        }
      }
    }
  }

  /**
   * Evaluates the current sliding window, updates heartbeat counters,
   * performs density-weighted centroiding, and returns active/fading storm cells.
   * In 24H mode, returns the pre-clustered historical cells in O(1) without any frame drop.
   */
  public getActiveStormCells(now: number = Date.now()): StormCell[] {
    if (this.mode === '24H' && this.cached24hCells.length > 0) {
      this.prune(now);
      this.demote24hLiveCells(now);
      return this.cached24hCells;
    }

    if (this.mode !== '24H') {
      if (now - this.lastComputeTime < 1000 && this.cachedSessionCells.length > 0) {
        return this.cachedSessionCells;
      }
      this.lastComputeTime = now;
    }

    this.prune(now);

    const activeEvents = this.buffer;
    const n = activeEvents.length;
    const candidateGroups: LightningEvent[][] = [];

    if (n >= this.minStrikes) {
      const dsu = new CellDSU(n);
      const binSize = 1.5;
      const grid = new Map<number, number[]>();

      for (let i = 0; i < n; i++) {
        const e = activeEvents[i];
        const latBin = Math.floor(e.latitude / binSize);
        const lonBin = Math.floor(e.longitude / binSize);
        const key = ((latBin + 1000) << 16) | (lonBin + 2000);

        const existing = grid.get(key);
        if (existing) {
          existing.push(i);
        } else {
          grid.set(key, [i]);
        }
      }

      for (let i = 0; i < n; i++) {
        const e1 = activeEvents[i];
        const latBin = Math.floor(e1.latitude / binSize);
        const lonBin = Math.floor(e1.longitude / binSize);

        for (let dLat = -1; dLat <= 1; dLat++) {
          for (let dLon = -1; dLon <= 1; dLon++) {
            const neighborKey = ((latBin + dLat + 1000) << 16) | (lonBin + dLon + 2000);
            const neighbors = grid.get(neighborKey);
            if (!neighbors) continue;

            for (let k = 0; k < neighbors.length; k++) {
              const j = neighbors[k];
              if (j <= i) continue;

              const e2 = activeEvents[j];
              const dist = haversineDistanceKm(e1.latitude, e1.longitude, e2.latitude, e2.longitude);
              if (dist <= this.spatialRadiusKm) {
                dsu.union(i, j);
              }
            }
          }
        }
      }

      const groups = new Map<number, LightningEvent[]>();
      for (let i = 0; i < n; i++) {
        const root = dsu.find(i);
        const list = groups.get(root);
        if (list) {
          list.push(activeEvents[i]);
        } else {
          groups.set(root, [activeEvents[i]]);
        }
      }

      for (const [, events] of groups) {
        if (events.length >= this.minStrikes) {
          candidateGroups.push(events);
        }
      }
    }

    // Match or create tracked cells from candidate groups
    const activeCellKeys = new Set<string>();

    for (const events of candidateGroups) {
      const centroid = calculateDensityWeightedCentroid(events);

      let maxDistKm = 0;
      let totalCurrent = 0;
      let firstSeen = events[0].timestamp;
      let lastSeen = events[0].timestamp;
      const distances: number[] = [];

      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const dist = haversineDistanceKm(centroid.latitude, centroid.longitude, ev.latitude, ev.longitude);
        distances.push(dist);
        if (dist > maxDistKm) maxDistKm = dist;

        totalCurrent += Math.abs(ev.peakCurrent ?? 35);
        if (ev.timestamp < firstSeen) firstSeen = ev.timestamp;
        if (ev.timestamp > lastSeen) lastSeen = ev.timestamp;
      }

      distances.sort((a, b) => a - b);
      const p85Idx = Math.floor(0.85 * (distances.length - 1));
      const p85Dist = distances[p85Idx] ?? maxDistKm;
      const dynamicRadius = Math.max(this.minRadiusKm, Math.min(this.maxRadiusKm, Math.max(p85Dist * 1.25, maxDistKm)));

      const meanIntensity = totalCurrent / events.length;
      const cellKey = `stormcell-${Math.round(centroid.latitude * 10)}_${Math.round(centroid.longitude * 10)}`;
      activeCellKeys.add(cellKey);

      let existing = this.trackedCells.get(cellKey);
      if (!existing) {
        // Check if there is an existing cell within linking distance
        for (const [key, cell] of this.trackedCells) {
          if (haversineDistanceKm(centroid.latitude, centroid.longitude, cell.centroid.latitude, cell.centroid.longitude) <= this.spatialRadiusKm) {
            existing = cell;
            activeCellKeys.add(key);
            break;
          }
        }
      }

      const clusterSpanMinutes = (lastSeen - firstSeen) / 60000;
      const ageMinutes = Math.max(
        existing ? (now - existing.firstSeen) / 60000 : 0,
        clusterSpanMinutes
      );

      if (existing) {
        existing.centroid = centroid;
        existing.boundingRadiusKm = dynamicRadius;
        for (let k = 0; k < events.length; k++) {
          if (!existing.events.some((ev) => ev.id === events[k].id)) {
            existing.events.push(events[k]);
          }
        }
        existing.strikeCount = existing.events.length;
        existing.firstSeen = Math.min(existing.firstSeen, firstSeen);
        existing.lastSeen = Math.max(existing.lastSeen, lastSeen);
        existing.meanIntensity = meanIntensity;
        existing.isFading = false;
        existing.fadeProgress = 0;
        const stormEval = classifyMeteorologicalStorm(dynamicRadius, ageMinutes, existing.strikeCount);
        existing.tier = stormEval.tier;
        existing.stormClass = stormEval.stormClass;
        existing.stormClassLabel = stormEval.label;
        const cellTimeout = this.getTimeoutForCell(existing.stormClass);
        existing.heartbeatRemainingMs = Math.max(0, cellTimeout - (now - existing.lastSeen));

        const lastCentroid = existing.hourlyCentroids[existing.hourlyCentroids.length - 1];
        if (!lastCentroid || (now - lastCentroid.timestamp) > 900000 || haversineDistanceKm(centroid.latitude, centroid.longitude, lastCentroid.lat, lastCentroid.lon) > 10) {
          existing.hourlyCentroids.push({ lat: centroid.latitude, lon: centroid.longitude, timestamp: now });
          if (existing.hourlyCentroids.length > 5) {
            existing.hourlyCentroids.shift();
          }
        }
      } else {
        const stormEval = classifyMeteorologicalStorm(dynamicRadius, ageMinutes, events.length);
        const cellTimeout = this.getTimeoutForCell(stormEval.stormClass);
        this.trackedCells.set(cellKey, {
          id: cellKey,
          centroid,
          boundingRadiusKm: dynamicRadius,
          strikeCount: events.length,
          events,
          firstSeen,
          lastSeen,
          meanIntensity,
          heartbeatRemainingMs: Math.max(0, cellTimeout - (now - lastSeen)),
          fadeProgress: 0,
          isFading: false,
          tier: stormEval.tier,
          stormClass: stormEval.stormClass,
          stormClassLabel: stormEval.label,
          hourlyCentroids: [{ lat: centroid.latitude, lon: centroid.longitude, timestamp: now }]
        });
      }
    }

    // Process countdown, tiered demotion & dynamic shrinking for tracked cells
    const expiredKeys: string[] = [];
    const redStepMs = this.isCustomWindowMs ? this.windowMs : 5 * 60 * 1000;
    const yellowStepMs = this.isCustomWindowMs ? this.windowMs : 4 * 60 * 1000;
    const blueStepMs = this.isCustomWindowMs ? this.windowMs : 3 * 60 * 1000;
    const whiteStepMs = this.isCustomWindowMs ? this.windowMs : 2 * 60 * 1000;

    for (const [key, cell] of this.trackedCells) {
      if (!activeCellKeys.has(key)) {
        const timeSinceLastStrike = now - cell.lastSeen;

        if (cell.tier === 'EXTREME' || cell.tier === 'RED') {
          if (timeSinceLastStrike >= redStepMs) {
            // Demote from RED to YELLOW
            cell.tier = 'YELLOW';
            cell.stormClass = 'MULTICELL';
            cell.stormClassLabel = 'Çok Hücre (Multicell Cluster)';
            cell.boundingRadiusKm = Math.max(35, Math.min(cell.boundingRadiusKm * 0.75, 120));
            cell.lastSeen = now;
            cell.heartbeatRemainingMs = yellowStepMs;
            cell.warningLevel = 'ELEVATED';
          } else {
            cell.heartbeatRemainingMs = redStepMs - timeSinceLastStrike;
            cell.isFading = false;
            cell.fadeProgress = 0;
          }
        } else if (cell.tier === 'YELLOW') {
          if (timeSinceLastStrike >= yellowStepMs) {
            // Demote from YELLOW to BLUE
            cell.tier = 'BLUE';
            cell.stormClass = 'SINGLE_CELL';
            cell.stormClassLabel = 'Tek Hücre (Single-Cell)';
            cell.boundingRadiusKm = Math.max(25, Math.min(cell.boundingRadiusKm * 0.7, 60));
            cell.lastSeen = now;
            cell.heartbeatRemainingMs = blueStepMs;
            cell.warningLevel = 'NORMAL';
          } else {
            cell.heartbeatRemainingMs = yellowStepMs - timeSinceLastStrike;
            cell.isFading = false;
            cell.fadeProgress = 0;
          }
        } else if (cell.tier === 'BLUE') {
          if (timeSinceLastStrike >= blueStepMs) {
            // Demote from BLUE to WHITE
            cell.tier = 'WHITE';
            cell.stormClass = 'ISOLATED';
            cell.stormClassLabel = 'İzole Çakma (Isolated)';
            cell.boundingRadiusKm = Math.max(15, Math.min(cell.boundingRadiusKm * 0.6, 25));
            cell.lastSeen = now;
            cell.heartbeatRemainingMs = whiteStepMs;
            cell.warningLevel = 'NORMAL';
          } else {
            cell.heartbeatRemainingMs = blueStepMs - timeSinceLastStrike;
            cell.isFading = false;
            cell.fadeProgress = 0;
          }
        } else {
          // WHITE (ISOLATED): final step before dissolving
          if (timeSinceLastStrike >= whiteStepMs) {
            cell.heartbeatRemainingMs = 0;
            cell.isFading = true;
            const fadeElapsed = timeSinceLastStrike - whiteStepMs;
            cell.fadeProgress = Math.min(1.0, fadeElapsed / 3500); // 3.5s smooth fade
          } else {
            cell.heartbeatRemainingMs = whiteStepMs - timeSinceLastStrike;
            cell.isFading = false;
            cell.fadeProgress = 0;
          }

          if (cell.fadeProgress >= 1.0) {
            expiredKeys.push(key);
          }
        }
      }
    }

    for (let i = 0; i < expiredKeys.length; i++) {
      this.trackedCells.delete(expiredKeys[i]);
    }

    // Process Agar.io style cell fusion (2 White -> Blue, 2 Blue -> Yellow, 2 Yellow -> Red; Red assimilates smaller cells)
    const trackedList = Array.from(this.trackedCells.values()).filter((c) => !c.isFading);
    const fusedAwayIds = new Set<string>();

    for (let i = 0; i < trackedList.length; i++) {
      const cellA = trackedList[i];
      if (fusedAwayIds.has(cellA.id)) continue;

      for (let j = i + 1; j < trackedList.length; j++) {
        const cellB = trackedList[j];
        if (fusedAwayIds.has(cellB.id)) continue;

        const distKm = haversineDistanceKm(
          cellA.centroid.latitude,
          cellA.centroid.longitude,
          cellB.centroid.latitude,
          cellB.centroid.longitude
        );

        if (distKm <= 42) {
          const aPriority = (TIER_PRIORITY[cellA.tier ?? 'WHITE'] * 1000) + cellA.strikeCount;
          const bPriority = (TIER_PRIORITY[cellB.tier ?? 'WHITE'] * 1000) + cellB.strikeCount;
          const dominant = aPriority >= bPriority ? cellA : cellB;
          const subordinate = aPriority >= bPriority ? cellB : cellA;

          // Dominant Core Anchor: never place fused cell into empty gap between storms
          const targetLat = dominant.centroid.latitude;
          const targetLon = dominant.centroid.longitude;

          // Case 1: Higher tier assimilates/absorbs smaller tier (e.g. RED vs other, YELLOW vs BLUE/WHITE, BLUE vs WHITE)
          if (dominant.tier !== subordinate.tier) {
            subordinate.fusingWith = dominant.id;
            subordinate.fusionTargetId = dominant.id;
            subordinate.fusionMidLat = targetLat;
            subordinate.fusionMidLon = targetLon;
            subordinate.fusionProgress = (subordinate.fusionProgress ?? 0) + 0.08;

            if (subordinate.fusionProgress >= 1.0) {
              dominant.strikeCount += subordinate.strikeCount;
              dominant.heartbeatRemainingMs = this.windowMs;
              dominant.events.push(...subordinate.events);
              dominant.boundingRadiusKm = Math.min(this.maxRadiusKm, Math.max(dominant.boundingRadiusKm, subordinate.boundingRadiusKm * 1.1));
              fusedAwayIds.add(subordinate.id);
            }
            break;
          }
          // Case 2: Matching tiers fuse into higher tier (2 White -> Blue, 2 Blue -> Yellow, 2 Yellow -> Red)
          else if (cellA.tier === cellB.tier && cellA.tier !== 'RED') {
            const progress = (cellA.fusionProgress ?? 0) + 0.08;

            cellA.fusionProgress = progress;
            cellA.fusingWith = cellB.id;
            cellA.fusionTargetId = dominant.id;
            cellA.fusionMidLat = targetLat;
            cellA.fusionMidLon = targetLon;

            cellB.fusionProgress = progress;
            cellB.fusingWith = cellA.id;
            cellB.fusionTargetId = dominant.id;
            cellB.fusionMidLat = targetLat;
            cellB.fusionMidLon = targetLon;

            if (progress >= 1.0) {
              let nextTier: StormCellTier = 'BLUE';
              if (dominant.tier === 'BLUE') nextTier = 'YELLOW';
              else if (dominant.tier === 'YELLOW') nextTier = 'RED';

              dominant.tier = nextTier;
              dominant.centroid = { latitude: targetLat, longitude: targetLon };
              dominant.strikeCount += subordinate.strikeCount;
              dominant.events.push(...subordinate.events);
              dominant.heartbeatRemainingMs = this.windowMs;
              dominant.boundingRadiusKm = Math.min(this.maxRadiusKm, dominant.boundingRadiusKm * 1.2);
              dominant.fusionProgress = 0;
              dominant.fusingWith = undefined;
              fusedAwayIds.add(subordinate.id);
            }
            break;
          }
        }
      }
    }

    for (const id of fusedAwayIds) {
      this.trackedCells.delete(id);
    }

    // Convert surviving tracked cells to output StormCell[]
    const results: StormCell[] = [];

    for (const cell of this.trackedCells.values()) {
      let warningLevel: StormCellWarningLevel = 'NORMAL';
      if (cell.tier === 'RED' || cell.boundingRadiusKm >= 170 || cell.strikeCount >= 18) {
        warningLevel = 'CRITICAL';
      } else if (cell.tier === 'YELLOW' || cell.boundingRadiusKm >= 110 || cell.strikeCount >= 10) {
        warningLevel = 'ELEVATED';
      }

      let fusionState: FusionState | undefined;
      if (cell.fusingWith && cell.fusionMidLat !== undefined && cell.fusionMidLon !== undefined) {
        fusionState = {
          targetCellId: cell.fusionTargetId ?? cell.id,
          partnerCellId: cell.fusingWith,
          midLat: cell.fusionMidLat,
          midLon: cell.fusionMidLon,
          progress: Math.min(1.0, cell.fusionProgress ?? 0),
          active: true
        };
      }

      const subHotspots = computeMicroHotspots(cell, now);
      const propagationVector = computePropagationVector(cell, now);

      results.push({
        id: cell.id,
        centroid: cell.centroid,
        boundingRadiusKm: cell.boundingRadiusKm,
        strikeCount: cell.strikeCount,
        events: cell.events,
        firstSeen: cell.firstSeen,
        lastSeen: cell.lastSeen,
        ageSeconds: Math.max(0, (now - cell.firstSeen) / 1000),
        meanIntensity: cell.meanIntensity,
        heartbeatRemainingMs: Math.max(0, cell.heartbeatRemainingMs),
        fadeProgress: cell.fadeProgress,
        warningLevel,
        tier: cell.tier,
        stormClass: cell.stormClass,
        stormClassLabel: cell.stormClassLabel,
        subHotspots,
        propagationVector,
        fusionState
      });
    }

    const sorted = results.sort((a, b) => b.strikeCount - a.strikeCount);
    if (this.mode !== '24H') {
      this.cachedSessionCells = sorted;
    }
    return sorted;
  }

  public getEventCount(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = [];
    this.trackedCells.clear();
    this.cachedSessionCells = [];
    this.cached24hCells = [];
    this.lastComputeTime = 0;
  }
}

/**
 * 6 Meteorological Storm Classes (Foto 2 Specification Table):
 * 1. İzole Çakma: < 5 km, 1 - 2 / dk, 5 dk
 * 2. Tek Hücre (Single-Cell): 15 km, 3 - 10 / dk, 10 dk, kopma 10 km
 * 3. Çok Hücre (Multicell Cluster): 40 km, 11 - 30 / dk, 15 dk, kopma 15 km
 * 4. Süper Hücre (Supercell): 60 km, 31 - 60 / dk, 15 dk, kopma 20 km
 * 5. Büyük Fırtına Kümesi: 120 km, 61 - 100 / dk, 15 dk, kopma 20 km
 * 6. Fırtına Hattı (MCS / Squall Line): 250 km, 100+ / dk, 20 dk, kopma 25 km
 */
export function classifyMeteorologicalStorm(
  _radiusKm: number,
  _ageMinutes: number,
  strikeCount: number
): { stormClass: MeteorologicalStormClass; label: string; tier: StormCellTier } {
  // 7. EXTREME_OUTBREAK (Süper Fırtına Patlaması: 650 km, 2000+ vuruş) - AŞIRI NADİR!
  if (strikeCount >= 2000) {
    return { stormClass: 'EXTREME_OUTBREAK', label: 'Süper Fırtına Patlaması', tier: 'EXTREME' };
  }
  // 6. Fırtına Hattı (Squall Line): 450 km, 1000+ vuruş
  if (strikeCount >= 1000) {
    return { stormClass: 'SQUALL_LINE', label: 'Fırtına Hattı (Squall Line)', tier: 'RED' };
  }
  // 5. Büyük Fırtına Kümesi (MCS): 280 km, 500+ vuruş
  if (strikeCount >= 500) {
    return { stormClass: 'MCS', label: 'Büyük Fırtına Kümesi', tier: 'RED' };
  }
  // 4. Süper Hücre (Supercell): 150 km, 220+ vuruş
  if (strikeCount >= 220) {
    return { stormClass: 'SUPERCELL', label: 'Süper Hücre (Supercell)', tier: 'RED' };
  }
  // 3. Çok Hücre (Multicell Cluster): 90 km, 90+ vuruş
  if (strikeCount >= 90) {
    return { stormClass: 'MULTICELL', label: 'Çok Hücre (Multicell Cluster)', tier: 'YELLOW' };
  }
  // 2. Tek Hücre (Single-Cell): 40 km, 30+ vuruş
  if (strikeCount >= 30) {
    return { stormClass: 'SINGLE_CELL', label: 'Tek Hücre (Single-Cell)', tier: 'BLUE' };
  }
  // 1. İzole Çakma: < 15 km, 8+ vuruş (veya canlı başlangıç)
  return { stormClass: 'ISOLATED', label: 'İzole Çakma (Isolated)', tier: 'WHITE' };
}

export function calculateTier(ageMinutes: number, strikeCount: number, radiusKm: number = 30): StormCellTier {
  return classifyMeteorologicalStorm(radiusKm, ageMinutes, strikeCount).tier;
}

/**
 * Computes micro-hotspot mini white hexagons inside RED and YELLOW storm cells.
 * Uses 7-Rosette geometry (1 central sub-hex + 6 surrounding petal sub-hexes).
 * Only sectors receiving strikes in the last 5 minutes are displayed.
 */
function computeMicroHotspots(
  cell: TrackedStormCellInternal,
  now: number
): MicroHotspot[] {
  if (cell.tier !== 'RED' && cell.tier !== 'YELLOW') {
    return [];
  }

  const fiveMinCutoff = now - 300000;
  let recentEvents = cell.events.filter((e) => e.timestamp >= fiveMinCutoff);
  if (recentEvents.length < 2) {
    recentEvents = cell.events.slice(-25);
  }
  if (recentEvents.length < 2) return [];

  // 7 sectors: 0 = center, 1..6 = 6 surrounding petals
  const sectorStrikes: Array<{ count: number; lastTime: number }> = Array.from({ length: 7 }, () => ({
    count: 0,
    lastTime: 0
  }));

  const latRad = (cell.centroid.latitude * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const centerThresholdKm = cell.boundingRadiusKm * 0.35;

  for (let i = 0; i < recentEvents.length; i++) {
    const ev = recentEvents[i];
    const dLat = ev.latitude - cell.centroid.latitude;
    const dLon = (ev.longitude - cell.centroid.longitude) * cosLat;
    const distKm = Math.hypot(dLat * 111, dLon * 111);

    let sectorIdx = 0;
    if (distKm <= centerThresholdKm) {
      sectorIdx = 0; // Center rosette
    } else {
      const angle = (Math.atan2(dLat, dLon) + 2 * Math.PI) % (2 * Math.PI);
      sectorIdx = 1 + (Math.floor(angle / (Math.PI / 3)) % 6);
    }

    sectorStrikes[sectorIdx].count++;
    if (ev.timestamp > sectorStrikes[sectorIdx].lastTime) {
      sectorStrikes[sectorIdx].lastTime = ev.timestamp;
    }
  }

  const hotspots: MicroHotspot[] = [];
  const petalDistKm = cell.boundingRadiusKm * 0.655;

  for (let s = 0; s < 7; s++) {
    const data = sectorStrikes[s];
    if (data.count >= 2) {
      let subLat = cell.centroid.latitude;
      let subLon = cell.centroid.longitude;

      if (s > 0) {
        const petalAngle = (s - 1) * (Math.PI / 3) + Math.PI / 6;
        subLat += (petalDistKm / 111) * Math.sin(petalAngle);
        subLon += (petalDistKm / (111 * Math.max(0.1, cosLat))) * Math.cos(petalAngle);
      }

      // Pulse alpha: bright on fresh strikes (decay over 30s) and solid 0.90 for 24H multi-hour historical cells
      const quietSec = Math.max(0, (now - data.lastTime) / 1000);
      const isHistorical = cell.id.startsWith('24h-') || cell.heartbeatRemainingMs > 3600000;
      const pulseAlpha = isHistorical ? 0.90 : Math.max(0.35, Math.min(1.0, Math.exp(-quietSec / 30.0)));

      hotspots.push({
        id: `${cell.id}-rosette-${s}`,
        sectorIndex: s,
        latitude: subLat,
        longitude: subLon,
        strikeCount: data.count,
        lastStrikeTime: data.lastTime,
        alpha: pulseAlpha
      });
    }
  }

  return hotspots;
}

/**
 * Computes storm propagation vector, heading arrow, drift speed, and ghost trail history.
 */
function computePropagationVector(
  cell: TrackedStormCellInternal,
  _now?: number
): StormPropagationVector {
  const history = cell.hourlyCentroids;
  let speedKmH = 0;
  let headingDeg = 45;
  let headingArrow = '↗';

  if (history.length >= 2) {
    const oldest = history[0];
    const newest = history[history.length - 1];
    const dtHours = Math.max(0.01, (newest.timestamp - oldest.timestamp) / 3600000);
    const dLat = newest.lat - oldest.lat;
    const dLon = (newest.lon - oldest.lon) * Math.cos((newest.lat * Math.PI) / 180);
    const distKm = Math.hypot(dLat * 111, dLon * 111);
    speedKmH = Math.min(180, Math.round(distKm / dtHours));

    if (distKm > 1.0) {
      headingDeg = Math.round((Math.atan2(dLat, dLon) * (180 / Math.PI) + 360) % 360);
      if (headingDeg >= 337.5 || headingDeg < 22.5) headingArrow = '→';
      else if (headingDeg >= 22.5 && headingDeg < 67.5) headingArrow = '↗';
      else if (headingDeg >= 67.5 && headingDeg < 112.5) headingArrow = '↑';
      else if (headingDeg >= 112.5 && headingDeg < 157.5) headingArrow = '↖';
      else if (headingDeg >= 157.5 && headingDeg < 202.5) headingArrow = '←';
      else if (headingDeg >= 202.5 && headingDeg < 247.5) headingArrow = '↙';
      else if (headingDeg >= 247.5 && headingDeg < 292.5) headingArrow = '↓';
      else headingArrow = '↘';
    }
  }

  const ghostCentroids = history.slice(-4).map((h) => ({
    latitude: h.lat,
    longitude: h.lon,
    timestamp: h.timestamp
  }));

  return {
    headingDeg,
    headingArrow,
    speedKmH,
    ghostCentroids
  };
}

