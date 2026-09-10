import type { PresentationClass } from './scoring';

export type CameraState = 'IDLE' | 'APPROACH' | 'HOLD' | 'RETURN';
export type CameraFramingMode = 'AUTO' | 'WIDE' | 'REGIONAL' | 'MEDIUM' | 'CLOSE';

export type CameraMode = 'AUTO' | 'MANUAL' | 'ORBIT' | 'TOUR';

export type ShotScale = 'VERY_CLOSE' | 'CLOSE' | 'COUNTRY' | 'REGIONAL' | 'CONTINENTAL' | 'ATMOSPHERIC' | 'AUTO_DIVERSITY';

export const SHOT_SCALE_DISTANCES: Record<ShotScale, number> = {
  VERY_CLOSE: 145,
  CLOSE: 175,
  COUNTRY: 220,
  REGIONAL: 260,
  CONTINENTAL: 310,
  ATMOSPHERIC: 380,
  AUTO_DIVERSITY: 220
};

export type FlightPhase =
  | 'IDLE'
  | 'APPROACH_PULLOUT'
  | 'APPROACH_GLIDE'
  | 'APPROACH_DIVE'
  | 'HOLD'
  | 'RETURN'
  | 'IDLE_DRIFT'
  | 'INTRO_ORBIT';

export interface CameraFilterMatrix {
  autoFollow: boolean;
  cameraMode: CameraMode;
  shotScale: ShotScale;
  pitchDeg: number;
  manualDistance: number;
  continents: string[];
  regions: string[];
  countries: string[];
  peteks: string[];
}

export interface FlightApproachIntent {
  targetClusterId: string;
  flightDurationMs: number;
  arrivalEpoch: number;
  targetLat: number;
  targetLon: number;
  isInterContinental: boolean;
}

export interface CameraTarget {
  clusterId: string;
  centroid: { latitude: number; longitude: number };
  boundingRadiusKm: number;
  presentationClass: PresentationClass;
  targetDistance: number;
}

export interface CameraDirectorConfig {
  approachDurationMs: number;
  holdDurationMs: number;
  minInterruptHoldMs?: number;
  returnDurationMs: number;
  userInterruptionCooldownMs: number;
  idleDwellMs?: number;
  idleDistance: number;
  minFocusDistance: number;
  defaultFramingMode?: CameraFramingMode;
  defaultDroneAngle?: number;
  enableIntroOrbit?: boolean;
  framingDistances: {
    MACRO: number;
    LOCAL: number;
    REGIONAL: number;
    CONTINENTAL: number;
    GLOBAL: number;
  };
}
