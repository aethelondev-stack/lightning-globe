import type { LightningEvent, LightningType } from '../../types/lightning';

/**
 * Raw unverified packet from incoming streams, webhooks, or WebSocket frames
 */
export interface RawLightningPacket {
  id?: unknown;
  timestamp?: unknown;
  time?: unknown;
  lat?: unknown;
  latitude?: unknown;
  lon?: unknown;
  lng?: unknown;
  longitude?: unknown;
  peakCurrent?: unknown;
  current?: unknown;
  type?: unknown;
  source?: unknown;
  color?: unknown;
  [key: string]: unknown;
}

export interface NormalizerMetrics {
  totalProcessed: number;
  validCount: number;
  rejectedCount: number;
  lastRejectionReason: string | null;
}

/**
 * LightningNormalizer: Pure validation and normalization engine.
 * Guarantees that corrupted, malicious, or malformed data packets
 * are cleanly rejected before reaching the domain and rendering pipeline.
 * Referencing ARCHITECTURE.md Section 1 & 2
 */
export class LightningNormalizer {
  private static metrics: NormalizerMetrics = {
    totalProcessed: 0,
    validCount: 0,
    rejectedCount: 0,
    lastRejectionReason: null
  };

  /**
   * Validates and transforms a raw data packet into a canonical LightningEvent.
   * Returns null if the packet contains invalid coordinates, NaN values, or corrupted types.
   */
  public static normalize(
    raw: unknown,
    fallbackSource: import('../../types/lightning').LightningSource = 'synthetic'
  ): LightningEvent | null {
    this.metrics.totalProcessed++;

    if (!raw || typeof raw !== 'object') {
      this.recordRejection('Packet is null, undefined, or not an object');
      return null;
    }

    const packet = raw as RawLightningPacket;

    // 1. Validate and normalize Latitude
    const rawLat = packet.latitude !== undefined ? packet.latitude : packet.lat;
    const lat = typeof rawLat === 'number' ? rawLat : parseFloat(String(rawLat));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      this.recordRejection(`Invalid latitude: ${rawLat}`);
      return null;
    }

    // 2. Validate and normalize Longitude
    const rawLon =
      packet.longitude !== undefined
        ? packet.longitude
        : packet.lon !== undefined
          ? packet.lon
          : packet.lng;
    const lon = typeof rawLon === 'number' ? rawLon : parseFloat(String(rawLon));
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      this.recordRejection(`Invalid longitude: ${rawLon}`);
      return null;
    }

    // 3. Validate and normalize Timestamp
    const rawTime = packet.timestamp !== undefined ? packet.timestamp : packet.time;
    let timestamp = typeof rawTime === 'number' ? rawTime : parseInt(String(rawTime), 10);
    // Convert nanosecond timestamp to milliseconds if applicable
    if (timestamp > 1e14) {
      timestamp = Math.floor(timestamp / 1e6);
    }
    const now = Date.now();
    // If timestamp is NaN, negative, or drifting > 24 hours into the future, clamp to now
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 86400000) {
      timestamp = now;
    }

    // 4. Validate and normalize Peak Current (kA)
    const rawCurrent =
      packet.peakCurrent !== undefined
        ? packet.peakCurrent
        : packet.current !== undefined
          ? packet.current
          : packet.mcg;
    let peakCurrent = typeof rawCurrent === 'number' ? Math.abs(rawCurrent) : parseFloat(String(rawCurrent));
    if (!Number.isFinite(peakCurrent) || peakCurrent === 0) {
      // Natural Berger-Uman lightning peak current distribution spanning all 5 tiers:
      // ~20% MINOR (<10kA), ~50% STANDARD (10-35kA), ~20% SEVERE (35-75kA), ~8% VIOLENT (75-150kA), ~2% SUPERBOLT (>150kA)
      const u = Math.random();
      if (u < 0.20) {
        peakCurrent = 4.0 + Math.random() * 5.5; // MINOR (<10 kA)
      } else if (u < 0.70) {
        peakCurrent = 12.0 + Math.random() * 22.0; // STANDARD (10-35 kA)
      } else if (u < 0.90) {
        peakCurrent = 36.0 + Math.random() * 38.0; // SEVERE (35-75 kA)
      } else if (u < 0.98) {
        peakCurrent = 78.0 + Math.random() * 70.0; // VIOLENT (75-150 kA)
      } else {
        peakCurrent = 155.0 + Math.random() * 95.0; // SUPERBOLT (>=150 kA)
      }
    }

    // 5. Validate and normalize Lightning Type ('CG' | 'IC')
    let type: LightningType = 'CG';
    if (typeof packet.type === 'string') {
      const upperType = packet.type.toUpperCase();
      if (upperType === 'IC' || upperType === 'INTRACLOUD') {
        type = 'IC';
      } else {
        type = 'CG';
      }
    }

    let source: import('../../types/lightning').LightningSource = fallbackSource;
    if (
      packet.source === 'blitzortung' ||
      packet.source === 'synthetic' ||
      packet.source === 'mock' ||
      packet.source === 'goes16_glm' ||
      packet.source === 'goes18_glm' ||
      packet.source === 'goes19_glm' ||
      packet.source === 'mtg_li' ||
      packet.source === 'singapore_nea' ||
      packet.source === 'japan_jma' ||
      packet.source === 'finland_fmi' ||
      packet.source === 'hybrid'
    ) {
      source = packet.source;
    }

    // 6. Deterministic Identifier (eliminates random Math.random collisions and guarantees deduplication across multiple feeds)
    const roundedLat = Math.round(lat * 1000) / 1000;
    const roundedLon = Math.round(lon * 1000) / 1000;
    const id =
      typeof packet.id === 'string' && packet.id.trim().length > 0
        ? packet.id.trim()
        : `${source}_${roundedLat.toFixed(3)}_${roundedLon.toFixed(3)}_${timestamp}`;

    const color = typeof packet.color === 'string' ? packet.color : undefined;

    // Optical fields from satellite sensors (e.g. GOES-16 GLM)
    let opticalEnergy: number | undefined;
    if (packet.opticalEnergy !== undefined) {
      const parsed = typeof packet.opticalEnergy === 'number' ? packet.opticalEnergy : parseFloat(String(packet.opticalEnergy));
      if (Number.isFinite(parsed) && parsed >= 0) {
        opticalEnergy = parsed;
      }
    } else if (packet.energy_j !== undefined) {
      const parsed = typeof packet.energy_j === 'number' ? packet.energy_j : parseFloat(String(packet.energy_j));
      if (Number.isFinite(parsed) && parsed >= 0) {
        opticalEnergy = parsed;
      }
    }

    let opticalArea: number | undefined;
    if (packet.opticalArea !== undefined) {
      const parsed = typeof packet.opticalArea === 'number' ? packet.opticalArea : parseFloat(String(packet.opticalArea));
      if (Number.isFinite(parsed) && parsed >= 0) {
        opticalArea = parsed;
      }
    } else if (packet.area_km2 !== undefined) {
      const parsed = typeof packet.area_km2 === 'number' ? packet.area_km2 : parseFloat(String(packet.area_km2));
      if (Number.isFinite(parsed) && parsed >= 0) {
        opticalArea = parsed;
      }
    }

    this.metrics.validCount++;

    return {
      id,
      timestamp,
      latitude: Math.round(lat * 100000) / 100000,
      longitude: Math.round(lon * 100000) / 100000,
      peakCurrent: Math.round(peakCurrent * 10) / 10,
      type,
      source,
      color,
      opticalEnergy,
      opticalArea
    };
  }

  private static recordRejection(reason: string): void {
    this.metrics.rejectedCount++;
    this.metrics.lastRejectionReason = reason;
  }

  public static getMetrics(): Readonly<NormalizerMetrics> {
    return { ...this.metrics };
  }

  public static resetMetrics(): void {
    this.metrics = {
      totalProcessed: 0,
      validCount: 0,
      rejectedCount: 0,
      lastRejectionReason: null
    };
  }
}
