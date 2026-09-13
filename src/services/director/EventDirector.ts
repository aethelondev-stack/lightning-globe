import type { ScoredCluster } from '../../types/scoring';
import type { QueueItem, PresentationHistoryEntry, DirectorConfig, ViewerRequest, InterleavedQueueTarget } from '../../types/director';
import type { ClassFilter } from '../../types/ui';
import type { MeteorologicalStormClass } from '../../types/cluster';
import type { CameraFilterMatrix } from '../../types/camera';
import { classifyMeteorologicalStorm } from '../clustering/StormCellBatcher';
import { EngineConfig } from '../../core/Config';
import { haversineDistanceKm } from '../../utils/coordinates';
import { GeoIndex, POPULAR_COUNTRIES } from '../../utils/geoRegions';
import { GeoEnricher } from '../geo/GeoEnricher';

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
 * - Dual-Track Interleaving Queue: Interleaves up to 10 Natural Storms with up to 10 Viewer Requests.
 * - Dynamic Cadence Acceleration: Cuts dwell time by 50% upon new viewer audience request.
 */
export class EventDirector {
  private queue: QueueItem[] = [];
  private viewerQueue: ViewerRequest[] = [];
  private lastTargetType: 'NATURAL' | 'VIEWER' = 'NATURAL';
  private currentViewerRequest: ViewerRequest | null = null;
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
  private cadenceAccelerateListeners: Set<() => void> = new Set();
  private viewerRequestListeners: Set<(req: ViewerRequest | null) => void> = new Set();

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
        // Most recent (0) gets -1.25, 2nd most recent (1) gets -0.85, etc.
        const penalty = Math.max(0.25, 1.25 - continentRecency * 0.35);
        priority -= penalty;
      } else {
        // Fresh/unvisited continent gets diversity priority boost (+1.10)
        priority += 1.10;
      }

      // Exact storm ID recency penalty
      const targetRecency = this.recentTargetIds.indexOf(cluster.id);
      if (targetRecency !== -1) {
        priority -= Math.max(0.30, 0.90 - targetRecency * 0.20);
      }

      // Inter-storm spatial separation boost: if far from currently presented storm (>2500 km), give roaming bonus
      if (this.currentPresentation) {
        const distFromCurrent = haversineDistanceKm(
          this.currentPresentation.centroid.latitude,
          this.currentPresentation.centroid.longitude,
          cluster.centroid.latitude,
          cluster.centroid.longitude
        );
        if (distFromCurrent >= 2500) {
          priority += 0.45;
        }
      }

      // 8-second observation cadence: penalize immediate same-continent re-visit
      const lastVisit = this.lastContinentVisitTime[cont] ?? 0;
      const elapsed = currentTime - lastVisit;
      if (elapsed < 8000) {
        priority -= 0.45;
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
   * Enqueues a verified viewer country target from live stream chat.
   * Enforces 10-request capacity limit, resolves country bounds, and accelerates current flight cadence.
   */
  public addViewerRequest(
    usernameOrOptions: string | { username: string; countryName: string; platform?: 'kick' | 'youtube' },
    countryQuery?: string,
    platform: 'kick' | 'youtube' = 'kick',
    currentTime: number = Date.now()
  ): { success: boolean; message: string; position?: number; isCalmSky?: boolean } {
    let username = '';
    let query = '';
    let plat: 'kick' | 'youtube' = platform;

    if (typeof usernameOrOptions === 'object') {
      username = usernameOrOptions.username;
      query = usernameOrOptions.countryName;
      plat = usernameOrOptions.platform || 'kick';
    } else {
      username = usernameOrOptions;
      query = countryQuery || '';
      plat = platform;
    }

    if (this.viewerQueue.length >= 10) {
      return { success: false, message: 'Camera request queue is full (10/10). Please try again in 2 minutes.' };
    }

    // Resolve country via POPULAR_COUNTRIES and GeoIndex
    const queryNorm = query.trim().toLowerCase();
    const allCountries = GeoIndex.getCountryList();
    const matchedCountry = POPULAR_COUNTRIES.find((c) => {
      if (c.name.toLowerCase() === queryNorm) return true;
      if (c.iso && c.iso.toLowerCase() === queryNorm) return true;
      if (queryNorm === 'türkiye' || queryNorm === 'turkey' || queryNorm === 'tr') return c.iso === 'TR';
      if (queryNorm === 'abd' || queryNorm === 'usa' || queryNorm === 'amerika' || queryNorm === 'united states') return c.iso === 'US';
      if (queryNorm === 'brezilya' || queryNorm === 'brazil' || queryNorm === 'br') return c.iso === 'BR';
      if (queryNorm === 'japonya' || queryNorm === 'japan' || queryNorm === 'jp') return c.iso === 'JP';
      if (queryNorm === 'almanya' || queryNorm === 'germany' || queryNorm === 'de') return c.iso === 'DE';
      if (queryNorm === 'ingiltere' || queryNorm === 'uk' || queryNorm === 'united kingdom' || queryNorm === 'gb') return c.iso === 'GB';
      if (queryNorm === 'kanada' || queryNorm === 'canada' || queryNorm === 'ca') return c.iso === 'CA';
      if (queryNorm === 'avustralya' || queryNorm === 'australia' || queryNorm === 'au') return c.iso === 'AU';
      return false;
    }) || allCountries.find((c) => {
      if (c.name.toLowerCase() === queryNorm) return true;
      if (c.iso && c.iso.toLowerCase() === queryNorm) return true;
      return false;
    }) || GeoIndex.getCountry(query);

    const countryName = matchedCountry ? matchedCountry.name : query;
    const countryIso = matchedCountry?.iso;
    let countryFlag = '🌍';
    if (countryIso && countryIso.length === 2) {
      const codePoints = countryIso.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0));
      countryFlag = String.fromCodePoint(...codePoints);
    }
    let centerLat = matchedCountry?.lat ?? 0;
    let centerLon = matchedCountry?.lon ?? 0;

    // Safety fallback: If coordinates resolved to (0, 0) Null Island, check POPULAR_COUNTRIES or GeoEnricher
    if (centerLat === 0 && centerLon === 0) {
      const pop = POPULAR_COUNTRIES.find((c) => c.iso === countryIso || c.name.toLowerCase() === queryNorm);
      if (pop && (pop.lat !== 0 || pop.lon !== 0)) {
        centerLat = pop.lat;
        centerLon = pop.lon;
      } else {
        try {
          const enricher = GeoEnricher.getInstance();
          if (enricher.isReady()) {
            const eList = enricher.getAllCountriesList();
            const found = eList.find((c) => c.name.toLowerCase() === queryNorm || (c.iso && c.iso.toLowerCase() === queryNorm));
            if (found && (found.centroid.lat !== 0 || found.centroid.lon !== 0)) {
              centerLat = found.centroid.lat;
              centerLon = found.centroid.lon;
              if (countryFlag === '🌍' && found.flag) {
                countryFlag = found.flag;
              }
            }
          }
        } catch {
          // Ignored
        }
      }
    }

    // Search for an active storm strictly inside country boundaries
    let bestCluster: ScoredCluster | null = null;
    const effectiveCountry = (matchedCountry && matchedCountry.minLat !== undefined)
      ? matchedCountry
      : POPULAR_COUNTRIES.find((c) => c.iso === countryIso || c.name.toLowerCase() === queryNorm);

    if (effectiveCountry && effectiveCountry.minLat !== undefined) {
      for (const cluster of this.lastKnownClusters) {
        const lat = cluster.centroid.latitude;
        const lon = cluster.centroid.longitude;
        const isInside = (
          lat >= effectiveCountry.minLat && lat <= (effectiveCountry.maxLat ?? 90) &&
          lon >= (effectiveCountry.minLon ?? -180) && lon <= (effectiveCountry.maxLon ?? 180));

        if (isInside) {
          if (!bestCluster || cluster.activityScore > bestCluster.activityScore) {
            bestCluster = cluster;
          }
        }
      }
    }

    const isCalm = bestCluster === null;
    const targetCluster: ScoredCluster = bestCluster ?? {
      id: `viewer-${countryIso || 'loc'}-${Date.now()}`,
      centroid: { latitude: centerLat, longitude: centerLon },
      events: [],
      eventCount: 0,
      firstEventTimestamp: currentTime,
      lastEventTimestamp: currentTime,
      boundingRadiusKm: 320,
      activityScore: 0.10,
      presentationClass: 'CONTINENTAL',
      strikesPerMinute: 0,
      growthRate: 1.0,
      breakdown: { rateScore: 0.1, growthScore: 0.1, energyScore: 0.1, clusterSizeScore: 0.1 },
      stormClass: 'ISOLATED'
    };

    const requestItem: ViewerRequest = {
      id: `vreq-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      username,
      platform: plat,
      countryName,
      countryIso,
      countryFlag,
      requestedAt: currentTime,
      cluster: targetCluster,
      hasStorm: !isCalm,
      isCalmSky: isCalm,
      status: isCalm ? 'calm' : 'storm'
    };

    this.viewerQueue.push(requestItem);

    // Dynamic Cadence Acceleration: Notify camera controller to speed up current dwell by 50%
    this.cadenceAccelerateListeners.forEach((fn) => fn());
    this.notifyViewerRequestChange();

    return {
      success: true,
      message: `${countryName} added to camera queue! (Position: #${this.viewerQueue.length})`,
      position: this.viewerQueue.length,
      isCalmSky: isCalm
    };
  }

  public getViewerQueue(): ViewerRequest[] {
    return this.viewerQueue;
  }

  public getCurrentViewerRequest(): ViewerRequest | null {
    return this.currentViewerRequest;
  }

  public getNextUpcomingViewerRequest(): ViewerRequest | null {
    return this.viewerQueue[0] || null;
  }

  public onCadenceAccelerate(callback: () => void): () => void {
    this.cadenceAccelerateListeners.add(callback);
    return () => this.cadenceAccelerateListeners.delete(callback);
  }

  public onViewerRequestChange(callback: (req: ViewerRequest | null) => void): () => void {
    this.viewerRequestListeners.add(callback);
    return () => this.viewerRequestListeners.delete(callback);
  }

  private notifyViewerRequestChange(): void {
    const upcoming = this.getNextUpcomingViewerRequest();
    this.viewerRequestListeners.forEach((fn) => fn(upcoming));
  }

  /**
   * Retrieves the next eligible storm target when the camera is ready (IDLE).
   * Applies the Interleaving (Sandviç) rhythm:
   * Alternates Natural Storm -> Viewer Request -> Natural Storm -> Viewer Request.
   */
  public getNextTarget(currentTime: number): ScoredCluster | null {
    // 1. Check if it's turn for a Viewer Request
    if (this.viewerQueue.length > 0 && this.lastTargetType === 'NATURAL') {
      const vReq = this.viewerQueue.shift()!;
      this.lastTargetType = 'VIEWER';
      this.currentViewerRequest = vReq;
      this.currentPresentation = vReq.cluster!;
      this.presentationCount++;
      this.notifyViewerRequestChange();
      return vReq.cluster!;
    }

    // 2. Otherwise process from Natural Priority Queue
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      // Guard: discard if cluster went stale while sitting in queue
      if (currentTime - item.cluster.lastEventTimestamp > this.config.queueStaleTimeoutMs) {
        continue;
      }

      const selected = item.cluster;
      this.currentPresentation = selected;
      this.lastTargetType = 'NATURAL';
      this.currentViewerRequest = null;

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
      this.notifyViewerRequestChange();

      // Interleaved Planetary Overview Slot (every 4th natural presentation):
      // Elevate presentation class to GLOBAL to give a wide-angle orbital overview of the active hemisphere
      if (this.presentationCount > 0 && this.presentationCount % 4 === 0 && selected.presentationClass !== 'MACRO') {
        return {
          ...selected,
          presentationClass: 'GLOBAL'
        };
      }

      return selected;
    }

    return null;
  }

  /**
   * Generates a geographically diverse subset of natural queue candidates,
   * avoiding spatial clumping and giving visibility to distinct weather systems.
   */
  public getDiverseNaturalQueue(maxCount: number = 10): QueueItem[] {
    if (this.queue.length <= 1) return this.queue.slice(0, maxCount);

    const selected: QueueItem[] = [];
    const usedContinents = new Set<string>();
    const usedCentroids: Array<{ lat: number; lon: number }> = [];

    // Pass 1: Select top candidate per distinct continent, requiring at least 300km separation
    for (const item of this.queue) {
      if (selected.length >= maxCount) break;
      const c = item.cluster;
      const cont = getContinent(c.centroid.latitude, c.centroid.longitude);

      const isTooClose = usedCentroids.some((pt) =>
        haversineDistanceKm(pt.lat, pt.lon, c.centroid.latitude, c.centroid.longitude) < 300
      );

      if (!isTooClose && !usedContinents.has(cont)) {
        selected.push(item);
        usedContinents.add(cont);
        usedCentroids.push({ lat: c.centroid.latitude, lon: c.centroid.longitude });
      }
    }

    // Pass 2: Select other high-priority candidates ensuring at least 200km spatial separation
    for (const item of this.queue) {
      if (selected.length >= maxCount) break;
      if (selected.includes(item)) continue;

      const c = item.cluster;
      const isTooClose = usedCentroids.some((pt) =>
        haversineDistanceKm(pt.lat, pt.lon, c.centroid.latitude, c.centroid.longitude) < 200
      );

      if (!isTooClose) {
        selected.push(item);
        usedCentroids.push({ lat: c.centroid.latitude, lon: c.centroid.longitude });
      }
    }

    // Pass 3: Fill any remaining capacity from the sorted queue
    for (const item of this.queue) {
      if (selected.length >= maxCount) break;
      if (!selected.includes(item)) {
        selected.push(item);
      }
    }

    return selected;
  }

  /**
   * Generates a 20-target interleaved queue list for the UI accordion panel.
   */
  public getInterleavedQueue(maxItems: number = 20): InterleavedQueueTarget[] {
    const naturalItems = this.getDiverseNaturalQueue(10);
    const viewerItems = this.viewerQueue.slice(0, 10);
    const result: InterleavedQueueTarget[] = [];

    let natIdx = 0;
    let viewIdx = 0;

    while ((natIdx < naturalItems.length || viewIdx < viewerItems.length) && result.length < maxItems) {
      // Natural item
      if (natIdx < naturalItems.length) {
        const item = naturalItems[natIdx++];
        const cluster = item.cluster;
        const thematic = GeoIndex.getThematicLocation(cluster.centroid.latitude, cluster.centroid.longitude);
        result.push({
          id: `nat-${cluster.id}`,
          type: 'NATURAL',
          rank: result.length + 1,
          countryName: thematic.name,
          countryFlag: thematic.flag,
          score: cluster.activityScore,
          scale: cluster.presentationClass,
          scaleClass: cluster.presentationClass,
          cluster
        });
      }

      // Viewer item
      if (viewIdx < viewerItems.length && result.length < maxItems) {
        const vReq = viewerItems[viewIdx++];
        result.push({
          id: vReq.id,
          type: 'VIEWER',
          rank: result.length + 1,
          countryName: vReq.countryName,
          countryFlag: vReq.countryFlag || '🌍',
          score: vReq.isCalmSky ? 0.0 : (vReq.cluster?.activityScore ?? 0.5),
          scale: vReq.isCalmSky ? 'SAKİN' : 'BÖLGESEL',
          scaleClass: vReq.isCalmSky ? 'SAKİN' : 'BÖLGESEL',
          viewerUser: vReq.username,
          isCalmSky: vReq.isCalmSky,
          viewerRequest: vReq,
          cluster: vReq.cluster
        });
      }
    }

    return result;
  }

  /**
   * Peeks at the next eligible storm target in queue without dequeuing or altering cooldown.
   */
  public peekNextTarget(currentTime: number): ScoredCluster | null {
    if (this.viewerQueue.length > 0 && this.lastTargetType === 'NATURAL') {
      return this.viewerQueue[0].cluster || null;
    }
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
