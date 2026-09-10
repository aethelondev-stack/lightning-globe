import * as THREE from 'three';
import { latLngToVector3 } from './coordinates';

export interface LunarPosition {
  /** Sublunar latitude (Moon declination) in degrees [-28.6, 28.6] */
  latitude: number;
  /** Sublunar longitude (Greenwich hour angle) in degrees [-180, 180] */
  longitude: number;
  /** Normalized unit vector pointing from Earth center towards the Moon */
  direction: THREE.Vector3;
  /** 3D position vector scaled by distance (default 400 units) */
  vector: THREE.Vector3;
  /** Moon illuminated fraction [0.0 = New Moon, 1.0 = Full Moon] */
  illuminatedFraction: number;
  /** Mean elongation angle in degrees [0, 360) */
  elongation: number;
  /** Astronomical Moon phase name in Turkish */
  phaseName: string;
}

/**
 * Computes the astronomical sublunar point and 3D Moon position vector for a given UTC timestamp.
 * Follows Jean Meeus ("Astronomical Algorithms", Ch. 47) low-precision lunar ephemeris
 * accurate to ~0.5° of arc, ideal for real-time planetary visualizations with zero CPU overhead.
 *
 * @param date The Date object (defaults to current system time)
 * @param distance Distance of the Moon from the Earth center (default 400 units)
 */
export function getLunarPosition(date: Date = new Date(), distance: number = 400): LunarPosition {
  const degToRad = Math.PI / 180;
  const radToDeg = 180 / Math.PI;
  const wrap360 = (x: number) => (((x % 360) + 360) % 360);
  const wrap180 = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;

  // 1. Julian centuries since J2000.0 (January 1, 2000 at 12:00 TT)
  const time = date.getTime();
  const jd = time / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525.0;

  // 2. Fundamental lunar orbital elements (degrees)
  const L0 = wrap360(218.3164477 + 481267.88123421 * T); // Moon mean longitude
  const D = wrap360(297.8501921 + 445267.1114034 * T);   // Moon mean elongation
  const M = wrap360(357.5291092 + 35999.0502909 * T);    // Sun mean anomaly
  const Mprime = wrap360(134.9633964 + 477198.8675055 * T); // Moon mean anomaly
  const F = wrap360(93.2720950 + 483202.0175233 * T);   // Moon argument of latitude

  const Drad = D * degToRad;
  const Mrad = M * degToRad;
  const Mprad = Mprime * degToRad;
  const Frad = F * degToRad;

  // 3. Principal periodic perturbations for ecliptic longitude (degrees)
  const dLambda = 6.288774 * Math.sin(Mprad)
                + 1.274027 * Math.sin(2 * Drad - Mprad)
                + 0.658314 * Math.sin(2 * Drad)
                + 0.213618 * Math.sin(2 * Mprad)
                - 0.185116 * Math.sin(Mrad)
                - 0.114332 * Math.sin(2 * Frad)
                + 0.058793 * Math.sin(2 * Drad - 2 * Mprad)
                + 0.057066 * Math.sin(2 * Drad - Mrad - Mprad)
                + 0.053322 * Math.sin(2 * Drad + Mprad)
                + 0.045758 * Math.sin(2 * Drad - Mrad)
                - 0.040923 * Math.sin(Mrad - Mprad)
                - 0.034720 * Math.sin(Drad)
                - 0.030383 * Math.sin(Mrad + Mprad);

  const lambda = wrap360(L0 + dLambda);

  // 4. Principal periodic perturbations for ecliptic latitude (degrees)
  const beta = 5.128178 * Math.sin(Frad)
             + 0.280602 * Math.sin(Mprad + Frad)
             + 0.277693 * Math.sin(Mprad - Frad)
             + 0.173237 * Math.sin(2 * Drad - Frad)
             + 0.055413 * Math.sin(2 * Drad - Mprad + Frad)
             + 0.046271 * Math.sin(2 * Drad - Mprad - Frad)
             + 0.032573 * Math.sin(2 * Drad + Frad)
             + 0.017198 * Math.sin(2 * Mprad + Frad)
             + 0.009266 * Math.sin(2 * Drad + Mprad - Frad);

  // 5. Obliquity of the ecliptic (degrees to radians)
  const eps = (23.439291 - 0.0130042 * T) * degToRad;
  const lambdaRad = lambda * degToRad;
  const betaRad = beta * degToRad;

  // 6. Ecliptic to Equatorial coordinates (Right Ascension alpha, Declination delta)
  const sinDelta = Math.sin(betaRad) * Math.cos(eps) + Math.cos(betaRad) * Math.sin(eps) * Math.sin(lambdaRad);
  const delta = Math.asin(Math.max(-1, Math.min(1, sinDelta))) * radToDeg;

  const y = Math.cos(betaRad) * Math.cos(eps) * Math.sin(lambdaRad) - Math.sin(betaRad) * Math.sin(eps);
  const x = Math.cos(betaRad) * Math.cos(lambdaRad);
  const alpha = wrap360(Math.atan2(y, x) * radToDeg);

  // 7. Greenwich Mean Sidereal Time (degrees)
  const gmst = wrap360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T);

  // 8. Sublunar geographic coordinates (declination = latitude, GHA = longitude)
  const sublunarLat = delta;
  const sublunarLon = wrap180(alpha - gmst);

  // 9. Convert (latitude, longitude) to Three.js 3D coordinates aligned with Earth
  const vector = latLngToVector3(sublunarLat, sublunarLon, 0, distance);
  const direction = vector.clone().normalize();

  // 10. Phase fraction and descriptive nomenclature
  const phaseFraction = (1 - Math.cos(D * degToRad)) / 2;
  let phaseName = 'Yeni Ay';
  if (D < 22.5 || D >= 337.5) {
    phaseName = 'Yeni Ay';
  } else if (D < 67.5) {
    phaseName = 'Hilal (Büyüyen)';
  } else if (D < 112.5) {
    phaseName = 'İlk Dördün';
  } else if (D < 157.5) {
    phaseName = 'Şişkin Ay (Büyüyen)';
  } else if (D < 202.5) {
    phaseName = 'Dolunay';
  } else if (D < 247.5) {
    phaseName = 'Şişkin Ay (Küçülen)';
  } else if (D < 292.5) {
    phaseName = 'Son Dördün';
  } else {
    phaseName = 'Hilal (Küçülen)';
  }

  return {
    latitude: sublunarLat,
    longitude: sublunarLon,
    direction,
    vector,
    illuminatedFraction: phaseFraction,
    elongation: D,
    phaseName
  };
}
