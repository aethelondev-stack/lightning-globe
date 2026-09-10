import type { LightningCluster, MeteorologicalStormClass } from './cluster';

export type PresentationClass = 'MACRO' | 'LOCAL' | 'REGIONAL' | 'CONTINENTAL' | 'GLOBAL';

export interface ScoreBreakdown {
  rateScore: number;       // Vuruş sıklığı skoru [0, 1]
  growthScore: number;     // Büyüme hızı skoru [0, 1]
  energyScore: number;     // Akım şiddeti skoru [0, 1]
  clusterSizeScore: number;// Olay sayısı skoru [0, 1]
}

export interface ScoredCluster extends LightningCluster {
  activityScore: number;   // Normalize nihai aktivite skoru [0, 1]
  presentationClass: PresentationClass;
  strikesPerMinute: number;
  growthRate: number;      // Son 2 dk / önceki periyot oranı
  breakdown: ScoreBreakdown;
  stormClass?: MeteorologicalStormClass;
}

export interface ScoringConfig {
  weights: {
    rate: number;
    growth: number;
    size: number;
    energy: number;
  };
  framingThresholds: {
    macroRadiusMaxKm: number;
    localRadiusMaxKm: number;
    regionalRadiusMaxKm: number;
  };
  saturationLimits: {
    maxStrikesPerMinute: number;
    maxClusterEvents: number;
    maxCurrentKa: number;
  };
}
