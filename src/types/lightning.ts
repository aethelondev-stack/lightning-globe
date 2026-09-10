/**
 * Domain Models for Lightning Events
 * Referencing PROJECT_SPEC.md Section 5
 */

export type LightningType = 'CG' | 'IC'; // Cloud-to-Ground veya Intracloud

export type LightningSource = 'synthetic' | 'blitzortung' | 'mock' | 'goes16_glm' | 'goes18_glm' | 'goes19_glm' | 'mtg_li' | 'singapore_nea' | 'japan_jma' | 'finland_fmi' | 'hybrid';

export interface LightningEvent {
  id: string;
  timestamp: number; // Unix epoch ms
  latitude: number;  // -90 to +90
  longitude: number; // -180 to +180
  peakCurrent: number; // kA (kiloamperes)
  type: LightningType;
  source: LightningSource;
  color?: string; // Optional custom visualization color override
  pol?: number; // Optional polarity: +1 or -1
  opticalEnergy?: number; // Joules (from GOES-16 GLM optical sensor)
  opticalArea?: number; // km^2 (from GOES-16 GLM optical footprint)
}
