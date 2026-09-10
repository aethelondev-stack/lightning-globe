import type { LightningEvent } from './lightning';

/**
 * Domain model representing a spatio-temporal cluster of lightning events (storm cell).
 * Compliant with PROJECT_SPEC.md Section 6 & RESEARCH_REPORT.md Section 13.
 */
export interface LightningCluster {
  id: string;
  centroid: {
    latitude: number;
    longitude: number;
  };
  boundingRadiusKm: number;
  eventCount: number;
  events: LightningEvent[];
  firstEventTimestamp: number;
  lastEventTimestamp: number;
  centroidHistory?: Array<{ lat: number; lon: number; timestamp: number }>;
}

export interface ClusterConfig {
  spatialRadiusKm: number; // Maximum distance to link events into the same cluster (e.g. 150 km)
  temporalWindowMs: number; // Time window considered for active clustering (e.g. 10 minutes)
  minClusterEvents: number; // Minimum number of events required to form a cluster (noise rejection, e.g. 3)
  minBoundingRadiusKm: number; // Minimum bounding radius clamp for camera framing (e.g. 25 km)
}

export type StormCellWarningLevel = 'NORMAL' | 'ELEVATED' | 'CRITICAL';

export type StormCellTier = 'WHITE' | 'BLUE' | 'YELLOW' | 'RED' | 'EXTREME';

/**
 * 6 Meteorological Storm Classes (Foto 3 Specification Table)
 */
export type MeteorologicalStormClass =
  | 'ISOLATED'          // İzole Çakma: < 5 km, 10-15 dk
  | 'SINGLE_CELL'       // Tek Hücre: 15-40 km, 15-30 dk
  | 'MULTICELL'         // Çok Hücre: 40-90 km, 30-60 dk
  | 'SUPERCELL'         // Süper Hücre: 90-150 km, 1-4 saat
  | 'MCS'               // Büyük Fırtına Kümesi (MCS): 150-300 km, 3-6 saat
  | 'SQUALL_LINE'       // Fırtına Hattı: 300-500 km, 4-12 saat
  | 'EXTREME_OUTBREAK'; // Süper Fırtına Patlaması (Aşırı Ekstrem Mega-Afet): 500+ km, 2000+ vuruş

export interface MicroHotspot {
  id: string;
  sectorIndex: number;
  latitude: number;
  longitude: number;
  strikeCount: number;
  lastStrikeTime: number;
  alpha: number;
}

export interface StormPropagationVector {
  headingDeg: number;
  headingArrow: string;
  speedKmH: number;
  ghostCentroids: Array<{ latitude: number; longitude: number; timestamp: number }>;
}

export interface FusionState {
  targetCellId: string;
  partnerCellId: string;
  midLat: number;
  midLon: number;
  progress: number; // 0.0 to 1.0
  active: boolean;
}

/**
 * High-intensity storm cell formed within a 30-second sliding window (Phase 19, 23).
 * Focuses on active storm centers with >= 5 strikes for radar ring pulsation and honeycomb footprints.
 */
export interface StormCell {
  id: string;
  centroid: {
    latitude: number;
    longitude: number;
  };
  boundingRadiusKm: number;
  strikeCount: number;
  events: LightningEvent[];
  firstSeen: number;
  lastSeen: number;
  ageSeconds: number;
  meanIntensity: number;
  heartbeatRemainingMs?: number;
  fadeProgress?: number;
  warningLevel?: StormCellWarningLevel;
  tier?: StormCellTier;
  stormClass?: MeteorologicalStormClass;
  stormClassLabel?: string;
  subHotspots?: MicroHotspot[];
  propagationVector?: StormPropagationVector;
  fusionState?: FusionState;
}

