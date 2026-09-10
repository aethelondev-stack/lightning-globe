import * as THREE from 'three';
import { latLngToVector3 } from './coordinates';

export interface SolarPosition {
  /** Subsolar latitude (solar declination) in degrees [-23.44, 23.44] */
  latitude: number;
  /** Subsolar longitude (Greenwich hour angle) in degrees [-180, 180] */
  longitude: number;
  /** Normalized unit vector pointing from Earth center towards the Sun */
  direction: THREE.Vector3;
  /** 3D position vector scaled by distance (default 300 units) */
  vector: THREE.Vector3;
}

/**
 * Computes the astronomical subsolar point and Sun vector for a given UTC timestamp.
 * Follows standard solar ephemeris approximation suitable for planetary visualization.
 * 
 * @param date The Date object (defaults to current system time)
 * @param distance Distance of the light/vector from the origin (default 300)
 */
export function getSolarPosition(date: Date = new Date(), distance: number = 300): SolarPosition {
  // 1. Day of the year (1 - 366)
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // 2. Solar declination angle (subsolar latitude)
  // At equinox (March 21, day ~80) declination ~ 0
  // At summer solstice (June 21, day ~172) declination ~ +23.44°
  // At winter solstice (Dec 21, day ~355) declination ~ -23.44°
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365.25) * (dayOfYear + 10));

  // 3. Greenwich Hour Angle / Subsolar Longitude
  // At 12:00 UTC, Sun is at Prime Meridian (lon 0°)
  // At 00:00 UTC, Sun is at Antimeridian (lon 180° / -180°)
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  const utcSeconds = date.getUTCSeconds();
  const hoursFraction = utcHours + utcMinutes / 60 + utcSeconds / 3600;

  let subsolarLon = -((hoursFraction / 24) * 360 - 180);
  // Normalize to [-180, 180]
  subsolarLon = ((((subsolarLon + 180) % 360) + 360) % 360) - 180;

  // 4. Convert (latitude, longitude) to Three.js 3D coordinates
  // Use unit radius 1 to get exact normalized direction
  const direction = latLngToVector3(declination, subsolarLon, 0, 1).normalize();
  const vector = direction.clone().multiplyScalar(distance);

  return {
    latitude: declination,
    longitude: subsolarLon,
    direction,
    vector
  };
}

/**
 * Calculates nightFactor [0.0, 1.0] from surface normal dot sun direction.
 * In twilight zone [-0.15, 0.05], applies smoothstep to seamlessly blend day and night.
 */
export function calculateNightFactor(sunDot: number): number {
  const edge0 = -0.15;
  const edge1 = 0.05;
  const t = Math.max(0.0, Math.min(1.0, (sunDot - edge0) / (edge1 - edge0)));
  const smooth = t * t * (3.0 - 2.0 * t);
  return 1.0 - smooth;
}
