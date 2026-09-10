import type { ScoredCluster } from '../../types/scoring';
import type { QueueItem, PresentationHistoryEntry, DirectorConfig } from '../../types/director';
import type { ClassFilter } from '../../types/ui';
import type { MeteorologicalStormClass } from '../../types/cluster';
import type { CameraFilterMatrix } from '../../types/camera';
import { classifyMeteorologicalStorm } from '../clustering/StormCellBatcher';
import { EngineConfig } from '../../core/Config';
import { haversineDistanceKm } from '../../utils/coordinates';
import { GeoIndex } from '../../utils/geoRegions';

export type ContinentCode = 'NA' | 'SA' | 'EU' | 'AF' | 'AS' | 'OC' | 'OTHER';

export function getContinent(lat: number, lon: number): ContinentCode {
  if (lat >= 15 && lat <= 85 && lon >= -170 && lon <= -50) return 'NA';
  if (lat >= -60 && lat < 15 && lon >= -90 && lon <= -30) return 'SA';
  if (lat >= 35 && lat <= 75 && lon >= -25 && lon <= 45) return 'EU';
  if (lat >= -35 && lat < 37 && lon >= -20 && lon <= 52) return 'AF';
  if (lat >= -10 && lat <= 80 && lon >= 45 && lon <= 180) return 'AS';
  if (lat >= -50 && lat < 0 && lon >= 100 && lon <= 180) return 'OC';
  return 'OTHER';
}

export const RARE_CONTINENTS: ContinentCode[] = ['EU', 'AS', 'OC', 'AF'];

/**
 * EventDirector: Broadcast orchestrator for autonomous planetary storm monitoring.
 *
 * Responsibilities:
 * - Priority Queue (`PresentationQueue`) management for multiple concurrent storm candidates.
 * - Temporal and spatial cooldown enforcement ($45\text{ s}$, $150\text{ km}$) to prevent camera fixation.
 * - Continental Diversity Bonus (+0.55) & Saturation Guard (prevents America/regional fixation).
 * - Emergency Interrupt Threshold checking ($S_{top} \ge 0.70$ and $S_{top} \ge 1.5 \times S_{current}$).
 * - Stale storm filtering to discard decaying clusters before camera focus.
 * - Interactive class filtering (ALL, LOCAL+, REGIONAL+, CONTINENTAL) for user experience control.
 *
 * Referencing PROJECT_SPEC.md Section 1, EVENT_DIRECTOR.md, and ARCHITECTURE.md.
 */
export class EventDirector {
  private queue: QueueItem[] = [];
  private history: Map<string, PresentationHistoryEntry> = new Map();
  private currentPresentation: ScoredCluster | null = null;
  private classFilter: ClassFilter = 'ALL';
  private categoryFilter: MeteorologicalStormClass | 'ALL' = 'ALL';
  private filterMatrix: CameraFilterMatrix | null = null;
  private readonly config: DirectorConfig;
  private lastVisitedContinent: ContinentCode | null = null;
  private lastContinentVisitTime: Record<string, number> = {};
  private recentVisitedContinents: ContinentCode[] = [];
  private recentTargetIds: string[] = [];
  private lastKnownClusters: ScoredCluster[] = [];
  private presentationCount: number = 0;

  constructor(config?: Partial<DirectorConfig>) {
    this.config = {
      clusterCooldownMs: config?.clusterCooldownMs ?? EngineConfig.eventDirector.clusterCooldownMs,
      spatialCooldownRadiusKm:
        config?.spatialCooldownRadiusKm ?? EngineConfig.eventDirector.spatialCooldownRadiusKm,
      interruptScoreRatio: config?.interruptScoreRatio ?? EngineConfig.eventDirector.interruptScoreRatio,
      interruptMinScore: config?.interruptMinScore ?? EngineConfig.eventDirector.interruptMinScore,
      maxQueueSize: config?.maxQueueSize ?? EngineConfig.eventDirector.maxQueueSize,
      queueStaleTimeoutMs: config?.queueStaleTimeoutMs ?? EngineConfig.eventDirector.queueStaleTimeoutMs
    };
  }

  /**
   * Sets meteorological category lock (ISOLATED, SINGLE_CELL, MULTICELL, SUPERCELL, MCS, SQUALL_LINE, EXTREME_OUTBREAK, or ALL)
   */
  public setCategoryFilter(category: MeteorologicalStormClass | 'ALL'): void {
    this.categoryFilter = category;
  }

  public getCategoryFilter(): MeteorologicalStormClass | 'ALL' {
    return this.categoryFilter;
  }

  /**
   * Sets minimum presentation class filter for the presentation queue.
   */
  public setClassFilter(filter: ClassFilter): void {
    this.classFilter = filter;
  }

  public getClassFilter(): ClassFilter {
    return this.classFilter;
  }

  public setFilterMatrix(matrix: CameraFilterMatrix | null): void {
    this.filterMatrix = matrix;
    this.queue = [];
    if (this.lastKnownClusters.length > 0) {
      this.updateClusters(this.lastKnownClusters, Date.now());
    }
  }

  public getFilterMatrix(): CameraFilterMatrix | null {
    return this.filterMatrix;
  }

  private matchesClassFilter(presentationClass: string): boolean {
    if (this.classFilter === 'ALL') return true;
    if (this.classFilter === 'LOCAL') return presentationClass !== 'MACRO';
    if (this.classFilter === 'REGIONAL') {
      return presentationClass === 'REGIONAL' || presentationClass === 'CONTINENTAL';
    }
    if (this.classFilter === 'CONTINENTAL') {
      return presentationClass === 'CONTINENTAL';
    }
    return true;
  }

  /**
   * Evaluates active scored clusters, prunes expired cooldowns, and updates the priority queue.
   *
   * @param clusters Scored clusters from ActivityScorer
   * @param currentTime Epoch timestamp (milliseconds)
   */
  public updateClusters(clusters: ScoredCluster[], currentTime: number): void {
    this.lastKnownClusters = clusters;
    // 1. Prune expired cooldowns from history
    for (const [id, entry] of this.history.entries()) {
      if (currentTime >= entry.cooldownUntil) {
        this.history.delete(id);
      }
    }

    // 2. Filter eligible candidates
    const eligible: ScoredCluster[] = [];

    for (const cluster of clusters) {
      // Camera Filter Matrix check (Continents, Regions, Countries, Petek classes)
      if (this.filterMatrix) {
        const lat = cluster.centroid.latitude;
        const lon = cluster.centroid.longitude;
        if (!GeoIndex.matchesFilter(lat, lon, this.filterMatrix.continents, this.filterMatrix.regions, this.filterMatrix.countries)) {
          continue;
        }
        if (this.filterMatrix.peteks && this.filterMatrix.peteks.length > 0) {
          const stormClass = cluster.stormClass ?? classifyMeteorologicalStorm(cluster.boundingRadiusKm, 15, cluster.eventCount).stormClass;
          if (!this.filterMatrix.peteks.includes(stormClass)) {
            continue;
          }
        }
      }

      // Meteorological category lock check
      if (this.categoryFilter !== 'ALL') {
        const stormClass = cluster.stormClass ?? classifyMeteorologicalStorm(cluster.boundingRadiusKm, 15, cluster.eventCount).stormClass;
        if (stormClass !== this.categoryFilter) {
          continue;
        }
      }

      // Class filter check
      if (!this.matchesClassFilter(cluster.presentationClass)) {
        continue;
      }

      // Ignore if currently being presented
      if (this.currentPresentation && this.currentPresentation.id === cluster.id) {
        continue;
      }

      // Stale event check: drop clusters whose latest strike is older than queueStaleTimeoutMs
      if (currentTime - cluster.lastEventTimestamp > this.config.queueStaleTimeoutMs) {
        continue;
      }

      // Check ID cooldown
      if (this.history.has(cluster.id)) {
        continue;
      }

      // Check spatial proximity cooldown against all active presented locations
      let inSpatialCooldown = false;
      for (const entry of this.history.values()) {
        const distKm = haversineDistanceKm(
          cluster.centroid.latitude,
          cluster.centroid.longitude,
          entry.centroid.latitude,
          entry.centroid.longitude
        );

        if (distKm <= this.config.spatialCooldownRadiusKm) {
          inSpatialCooldown = true;
          break;
        }
      }

      if (inSpatialCooldown) {
        continue;
      }

      eligible.push(cluster);
    }

    // Fallback: If no candidate passed strict cooldowns, prevent queue starvation
    // by recycling the oldest visited candidate (at least 15s elapsed since presentation)
    if (eligible.length === 0 && clusters.length > 0) {
      const candidates = clusters.filter((c) => {
        if (this.currentPresentation && this.currentPresentation.id === c.id) return false;
        if (currentTime - c.lastEventTimestamp > this.config.queueStaleTimeoutMs) return false;
        if (this.categoryFilter !== 'ALL') {
          const sc = c.stormClass ?? classifyMeteorologicalStorm(c.boundingRadiusKm, 15, c.eventCount).stormClass;
          if (sc !== this.categoryFilter) return false;
        }
        if (!this.matchesClassFilter(c.presentationClass)) return false;
        return true;
      });

      if (candidates.length > 0) {
        const recycled = candidates.filter((c) => {
          const h = this.history.get(c.id);
          return !h || (currentTime - h.presentedAt >= 15000);
        });
        if (recycled.length > 0) {
          recycled.sort((a, b) => {
            const hA = this.history.get(a.id)?.presentedAt ?? 0;
            const hB = this.history.get(b.id)?.presentedAt ?? 0;
            return hA - hB;
          });
          eligible.push(recycled[0]);
        }
      }
    }

    // Check if current presentation slot is a Rare Region Discovery Slot (every 3rd presentation)
    const isDiscoverySlot = this.presentationCount > 0 && (this.presentationCount % 3 === 0);

    // 3. Compute priority with Continental Diversity Bonus & LRU History to prevent ping-ponging
    const scoredCandidates = eligible.map((cluster) => {
      let priority = cluster.activityScore;
      const cont = getContinent(cluster.centroid.latitude, cluster.centroid.longitude);

      // Rare Region Discovery Bonus: Prioritize underrepresented continents (EU, AS, OC, AF) every 3rd presentation
      if (isDiscoverySlot && RARE_CONTINENTS.includes(cont)) {
        priority += 2.50;
      }

      // LRU Continent Recency Penalty: if continent was recently visited, penalize it so camera tours other continents
      const continentRecency = this.recentVisitedContinents.indexOf(cont);
      if (continentRecency !== -1) {
        // Most recent (0) gets -0.85, 2nd most recent (1) gets -0.60, etc.
        const penalty = Math.max(0.15, 0.85 - continentRecency * 0.25);
        priority -= penalty;
      } else {
        // Fresh/unvisited continent gets diversity priority boost (+0.80)
        priority += 0.80;
      }

      // Exact storm ID recency penalty
      const targetRecency = this.recentTargetIds.indexOf(cluster.id);
      if (targetRecency !== -1) {
        priority -= Math.max(0.20, 0.75 - targetRecency * 0.15);
      }

      // 5-second brief observation cadence: penalize immediate same-continent re-visit
      const lastVisit = this.lastContinentVisitTime[cont] ?? 0;
      const elapsed = currentTime - lastVisit;
      if (elapsed < 5000) {
        priority -= 0.30;
      }

      return { cluster, priority };
    });

    scoredCandidates.sort((a, b) => b.priority - a.priority);

    // 4. Update internal queue with bounded capacity
    this.queue = scoredCandidates.slice(0, this.config.maxQueueSize).map((item) => ({
      cluster: item.cluster,
      enqueuedAt: currentTime,
      priority: item.priority
    }));
  }


  /**
   * Retrieves the next eligible storm target when the camera is ready (IDLE).
   * Automatically marks the storm in presentation history with a cooldown
   * and registers continental presence to guarantee planetary diversity.
   *
   * @param currentTime Current epoch timestamp in milliseconds
   */
  public getNextTarget(currentTime: number): ScoredCluster | null {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      // Guard: discard if cluster went stale while sitting in queue
      if (currentTime - item.cluster.lastEventTimestamp > this.config.queueStaleTimeoutMs) {
        continue;
      }

      const selected = item.cluster;
      this.currentPresentation = selected;

      // Track continent visit in LRU queue (max 5)
      const cont = getContinent(selected.centroid.latitude, selected.centroid.longitude);
      this.lastVisitedContinent = cont;
      this.lastContinentVisitTime[cont] = currentTime;

      const cIdx = this.recentVisitedContinents.indexOf(cont);
      if (cIdx !== -1) this.recentVisitedContinents.splice(cIdx, 1);
      this.recentVisitedContinents.unshift(cont);
      if (this.recentVisitedContinents.length > 5) {
        this.recentVisitedContinents.pop();
      }

      const tIdx = this.recentTargetIds.indexOf(selected.id);
      if (tIdx !== -1) this.recentTargetIds.splice(tIdx, 1);
      this.recentTargetIds.unshift(selected.id);
      if (this.recentTargetIds.length > 8) {
        this.recentTargetIds.pop();
      }

      // Register presentation history with cooldown
      const existing = this.history.get(selected.id);
      this.history.set(selected.id, {
        clusterId: selected.id,
        centroid: { ...selected.centroid },
        presentedAt: currentTime,
        cooldownUntil: currentTime + this.config.clusterCooldownMs,
        presentationCount: (existing?.presentationCount ?? 0) + 1
      });

      this.presentationCount++;
      return selected;
    }

    return null;
  }

  /**
   * Peeks at the next eligible storm target in queue without dequeuing or altering cooldown.
   */
  public peekNextTarget(currentTime: number): ScoredCluster | null {
    for (const item of this.queue) {
      if (currentTime - item.cluster.lastEventTimestamp <= this.config.queueStaleTimeoutMs) {
        return item.cluster;
      }
    }
    return null;
  }

  /**
   * Registers an imminent Agar.io style storm cell fusion event to frame the merge midpoint 2-3s prior.
   */
  public registerImminentFusion(midLat: number, midLon: number, cellId: string, currentTime: number): void {
    const fusionId = `fusion-${cellId}`;
    if (this.history.has(fusionId)) return;

    const fusionCluster: ScoredCluster = {
      id: fusionId,
      centroid: { latitude: midLat, longitude: midLon },
      boundingRadiusKm: 120,
      eventCount: 30,
      events: [],
      firstEventTimestamp: currentTime - 60000,
      lastEventTimestamp: currentTime,
      activityScore: 1.85,
      presentationClass: 'REGIONAL',
      strikesPerMinute: 25,
      growthRate: 1.2,
      breakdown: {
        rateScore: 0.8,
        growthScore: 0.7,
        energyScore: 0.85,
        clusterSizeScore: 0.8
      }
    };

    // Check if already in queue
    if (!this.queue.some((item) => item.cluster.id === fusionId)) {
      this.queue.unshift({
        cluster: fusionCluster,
        enqueuedAt: currentTime,
        priority: 2.2
      });
      // Register presentation history with 15s cooldown to prevent camera whipping
      this.history.set(fusionId, {
        clusterId: fusionId,
        centroid: { latitude: midLat, longitude: midLon },
        presentedAt: currentTime,
        cooldownUntil: currentTime + 15000,
        presentationCount: 1
      });
    }
  }

  /**
   * Evaluates if a high-priority candidate storm justifies immediately interrupting

   * the active presentation.
   *
   * Formula: candidate.activityScore >= 0.70 AND candidate.activityScore >= current.activityScore * 1.5
   *
   * @param topCandidate The top scored cluster across the globe
   */
  public checkInterrupt(topCandidate: ScoredCluster | null): boolean {
    if (!this.currentPresentation || !topCandidate) {
      return false;
    }

    // Do not interrupt with the same storm
    if (topCandidate.id === this.currentPresentation.id) {
      return false;
    }

    const currentScore = this.currentPresentation.activityScore;
    const candidateScore = topCandidate.activityScore;

    const meetsMinimum = candidateScore >= this.config.interruptMinScore;
    const meetsRatio = candidateScore >= currentScore * this.config.interruptScoreRatio;

    return meetsMinimum && meetsRatio;
  }

  /**
   * Records an emergency interrupt, transitioning currentPresentation directly to the new target.
   */
  public recordInterrupt(newTarget: ScoredCluster, currentTime: number): void {
    this.currentPresentation = newTarget;

    const cont = getContinent(newTarget.centroid.latitude, newTarget.centroid.longitude);
    this.lastVisitedContinent = cont;
    this.lastContinentVisitTime[cont] = currentTime;

    const existing = this.history.get(newTarget.id);
    this.history.set(newTarget.id, {
      clusterId: newTarget.id,
      centroid: { ...newTarget.centroid },
      presentedAt: currentTime,
      cooldownUntil: currentTime + this.config.clusterCooldownMs,
      presentationCount: (existing?.presentationCount ?? 0) + 1
    });
  }

  /**
   * Called when a camera presentation sequence completes (transition to IDLE).
   */
  public onPresentationCompleted(clusterId: string, currentTime: number): void {
    if (this.currentPresentation && this.currentPresentation.id === clusterId) {
      // Ensure cooldown until 45s from completion if desired
      const entry = this.history.get(clusterId);
      if (entry) {
        entry.cooldownUntil = Math.max(entry.cooldownUntil, currentTime + this.config.clusterCooldownMs);
      }
      this.currentPresentation = null;
    }
  }

  public getQueue(): readonly QueueItem[] {
    return this.queue;
  }

  public getCurrentPresentation(): ScoredCluster | null {
    return this.currentPresentation;
  }

  public getLastVisitedContinent(): ContinentCode | null {
    return this.lastVisitedContinent;
  }

  public getActiveCooldownCount(currentTime: number): number {
    let count = 0;
    for (const entry of this.history.values()) {
      if (entry.cooldownUntil > currentTime) {
        count++;
      }
    }
    return count;
  }

  public getHistory(): ReadonlyMap<string, PresentationHistoryEntry> {
    return this.history;
  }

  /**
   * Resets all internal queue, cooldown history, and active presentation state.
   * Crucial for clean scenario transitions without state leakage.
   */
  public clear(): void {
    this.queue = [];
    this.history.clear();
    this.currentPresentation = null;
    this.lastVisitedContinent = null;
    this.lastContinentVisitTime = {};
    this.recentVisitedContinents = [];
    this.recentTargetIds = [];
    this.presentationCount = 0;
  }

  public getPresentationCount(): number {
    return this.presentationCount;
  }

  public setPresentationCount(count: number): void {
    this.presentationCount = Math.max(0, Math.floor(count));
  }

  public resetPresentationCount(): void {
    this.presentationCount = 0;
  }

  public isDiscoverySlotActive(): boolean {
    return this.presentationCount > 0 && (this.presentationCount % 3 === 0);
  }
}
