/**
 * Atmospheric convective instability and thermodynamic potential models
 * Derived from Open-Meteo Global Weather API (CAPE, Lifted Index, Convective Precipitation)
 * Referencing PROJECT_SPEC.md & FAZ 2 Architecture
 */

export type ConvectiveRiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';

export interface AtmosphericPotentialPoint {
  latitude: number;
  longitude: number;
  /** Convective Available Potential Energy in Joules per kilogram (J/kg) */
  cape: number;
  /** Lifted Index in degrees Celsius (°C) - negative values indicate instability */
  liftedIndex: number;
  /** Convective precipitation rate in mm/h */
  convectivePrecipitation: number;
  /** Qualitative categorical risk level */
  riskLevel: ConvectiveRiskLevel;
  /** Normalized potential score [0.0 to 1.0] for GPU shader intensity */
  potentialScore: number;
  /** Timestamp of the thermodynamic observation */
  timestamp: number;
}

export interface AtmosphericLayerConfig {
  enabled: boolean;
  opacity: number;
  pulseSpeed: number;
  altitudeOffset: number; // Globe radius offset
  minCapeThreshold: number; // Minimum CAPE to render visual instability
}
