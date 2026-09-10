import type { LightningCluster } from '../../types/cluster';
import type { ScoredCluster, PresentationClass, ScoreBreakdown, ScoringConfig } from '../../types/scoring';
import { EngineConfig } from '../../core/Config';

/**
 * ActivityScorer: Deterministic multi-criteria scoring & camera framing priority engine.
 *
 * Evaluates:
 * 1. Strikes Per Minute (Rate Score, weight: 0.40)
 * 2. Recent vs Historical Growth Trend (Growth Score, weight: 0.25)
 * 3. Cluster Size / Event Count (Size Score, weight: 0.20)
 * 4. Mean Peak Current Intensity (Energy Score, weight: 0.15)
 *
 * Normalizes aggregate score strictly to [0.0, 1.0].
 * Categorizes presentation class ('MACRO', 'LOCAL', 'REGIONAL', 'CONTINENTAL') by boundingRadiusKm.
 *
 * Referencing PROJECT_SPEC.md Sections 7 & 8 and IMPLEMENTATION_PHASES.md Phase 6.
 */
export class ActivityScorer {
  private readonly weights: ScoringConfig['weights'];
  private readonly framingThresholds: ScoringConfig['framingThresholds'];
  private readonly saturationLimits: ScoringConfig['saturationLimits'];

  constructor(config?: Partial<ScoringConfig>) {
    this.weights = config?.weights ?? EngineConfig.scoring.weights;
    this.framingThresholds = config?.framingThresholds ?? EngineConfig.scoring.framingThresholds;
    this.saturationLimits = config?.saturationLimits ?? EngineConfig.scoring.saturationLimits;
  }

  /**
   * Scores an individual lightning cluster across multiple normalized meteorological metrics.
   *
   * @param cluster Input LightningCluster from ClusterEngine
   * @param currentTime Reference timestamp (defaults to Date.now())
   * @returns ScoredCluster with activityScore in [0.0, 1.0] and presentationClass
   */
  public scoreCluster(cluster: LightningCluster, currentTime: number = Date.now()): ScoredCluster {
    // 1. Strikes Per Minute (Rate Score)
    const durationMs = Math.max(0, cluster.lastEventTimestamp - cluster.firstEventTimestamp);
    const durationMinutes = Math.max(1 / 60, durationMs / 60000); // Guard: minimum 1 second duration
    const spm = cluster.eventCount / Math.max(1, durationMinutes);
    const rateScore = Math.min(1.0, spm / this.saturationLimits.maxStrikesPerMinute);

    // 2. Growth Trend (Explosive Growth Acceleration)
    // Compare last 2 minutes vs previous 8 minutes (within 10 minute window)
    const twoMinCutoff = currentTime - 2 * 60 * 1000;
    const tenMinCutoff = currentTime - 10 * 60 * 1000;

    let nRecent = 0;
    let nOlder = 0;

    for (let i = 0; i < cluster.events.length; i++) {
      const ts = cluster.events[i].timestamp;
      if (ts >= twoMinCutoff) {
        nRecent++;
      } else if (ts >= tenMinCutoff) {
        nOlder++;
      }
    }

    const recentRate = nRecent / 2; // strikes / min in last 2 mins
    const olderRate = Math.max(1, nOlder / 8); // strikes / min in prior 8 mins (guard: min 1)
    const growthRatio = recentRate / olderRate;
    // Map ratio [0.5, 3.0] to [0.0, 1.0]
    const growthScore = Math.max(0.0, Math.min(1.0, (growthRatio - 0.5) / 2.5));

    // 3. Cluster Size Score
    const clusterSizeScore = Math.min(1.0, cluster.eventCount / this.saturationLimits.maxClusterEvents);

    // 4. Energy Score (Mean Peak Current)
    let totalCurrent = 0;
    let countWithCurrent = 0;

    for (let i = 0; i < cluster.events.length; i++) {
      const cur = cluster.events[i].peakCurrent;
      if (cur !== null && cur !== undefined && !isNaN(cur)) {
        totalCurrent += Math.abs(cur);
        countWithCurrent++;
      }
    }

    // Default to 25 kA if provider does not specify peak current
    const avgCurrent = countWithCurrent > 0 ? totalCurrent / countWithCurrent : 25;
    const energyScore = Math.min(1.0, avgCurrent / this.saturationLimits.maxCurrentKa);

    // 5. Weighted Aggregate Score
    const rawScore =
      this.weights.rate * rateScore +
      this.weights.growth * growthScore +
      this.weights.size * clusterSizeScore +
      this.weights.energy * energyScore;

    // Strict clamp [0.0, 1.0] and rounding to 3 decimal places
    const clampedScore = Math.max(0.0, Math.min(1.0, rawScore));
    const activityScore = Math.round(clampedScore * 1000) / 1000;

    // 6. Presentation Framing Class
    const r = cluster.boundingRadiusKm;
    let presentationClass: PresentationClass;
    if (r <= this.framingThresholds.macroRadiusMaxKm) {
      presentationClass = 'MACRO';
    } else if (r <= this.framingThresholds.localRadiusMaxKm) {
      presentationClass = 'LOCAL';
    } else if (r <= this.framingThresholds.regionalRadiusMaxKm) {
      presentationClass = 'REGIONAL';
    } else {
      presentationClass = 'CONTINENTAL';
    }

    const breakdown: ScoreBreakdown = {
      rateScore: Math.round(rateScore * 1000) / 1000,
      growthScore: Math.round(growthScore * 1000) / 1000,
      energyScore: Math.round(energyScore * 1000) / 1000,
      clusterSizeScore: Math.round(clusterSizeScore * 1000) / 1000
    };

    return {
      ...cluster,
      activityScore,
      presentationClass,
      strikesPerMinute: Math.round(spm * 10) / 10,
      growthRate: Math.round(growthRatio * 100) / 100,
      breakdown
    };
  }

  /**
   * Evaluates and ranks an array of clusters in descending order of activityScore.
   * Employs deterministic tie-breaking by eventCount and cluster ID.
   */
  public rankClusters(clusters: LightningCluster[], currentTime: number = Date.now()): ScoredCluster[] {
    const scored = clusters.map((c) => this.scoreCluster(c, currentTime));

    scored.sort((a, b) => {
      const diff = b.activityScore - a.activityScore;
      if (Math.abs(diff) > 0.0001) {
        return diff;
      }
      // Deterministic tie-breakers:
      if (b.eventCount !== a.eventCount) {
        return b.eventCount - a.eventCount;
      }
      return a.id.localeCompare(b.id);
    });

    return scored;
  }
}
