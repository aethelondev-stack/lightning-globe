import type * as THREE from 'three';

export interface BoltSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
}

export interface ActiveBolt {
  id: string;
  mesh: THREE.Mesh | THREE.LineSegments;
  positions: Float32Array;
  dirs?: Float32Array;
  sides?: Float32Array;
  widths?: Float32Array;
  progresses?: Float32Array;
  indices?: Uint16Array;
  light?: THREE.PointLight;
  shockwaveRing?: THREE.Mesh;
  acousticRippleRing?: THREE.Mesh;
  sheetGlow?: THREE.Mesh;
  isPositive?: boolean;
  classification?: string;
  tierColor?: THREE.Color;
  maxShockwaveScale?: number;
  cloudAltitude?: number;
  cascadingCharges?: THREE.Points;
  chargePositions?: Float32Array;
  chargeColors?: Float32Array;
  chargeOffsets?: Float32Array;
  chargeCount?: number;
  chargePath?: THREE.Vector3[];
  mainTrunkArcLengths?: number[];
  totalTrunkLength?: number;
  hitCellId?: string | null;
  hasEmittedResidualSparks?: boolean;
  startTime: number;
  durationMs: number;
  intensity: number;
  active: boolean;
}

export interface VFXConfig {
  maxActiveBolts: number;
  boltDurationMs: number;
  boltBranchProbability: number;
  boltDisplacementScale: number;
  flashIntensity: number;
  flashDistance: number;
  flashDecayMs: number;
  cloudAltitude: number;
}
