import * as THREE from 'three';
import { EngineConfig } from '../core/Config';

/**
 * Geographic Coordinate Mathematics for Spherical Earth
 * Compliant with ThreeGlobe coordinate system and ARCHITECTURE.md
 */

/**
 * Converts Latitude, Longitude and optional relative altitude into a 3D Cartesian Vector3.
 * Matches ThreeGlobe coordinate orientation exactly:
 * - Equator at Y = 0
 * - North Pole at +Y, South Pole at -Y
 * - Prime Meridian (0° lon) aligned with Z-axis
 *
 * @param lat Latitude in degrees [-90, 90]
 * @param lng Longitude in degrees [-180, 180]
 * @param relAltitude Altitude as a fraction of globe radius (0 = surface, 0.1 = 10% above surface)
 * @param radius Base globe radius (default from EngineConfig: 100)
 */
export function latLngToVector3(
  lat: number,
  lng: number,
  relAltitude: number = 0,
  radius: number = EngineConfig.globe.radius
): THREE.Vector3 {
  // Clamp boundaries to prevent numeric edge artifacts
  const clampedLat = Math.max(-90, Math.min(90, lat));
  // Wrap longitude to [-180, 180]
  const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;

  const phi = ((90 - clampedLat) * Math.PI) / 180;
  const theta = ((90 - wrappedLng) * Math.PI) / 180;
  const r = radius * (1 + relAltitude);
  const phiSin = Math.sin(phi);

  return new THREE.Vector3(
    r * phiSin * Math.cos(theta),
    r * Math.cos(phi),
    r * phiSin * Math.sin(theta)
  );
}

/**
 * Converts a 3D Cartesian Vector3 on or near the globe surface back to Latitude, Longitude and Altitude.
 */
export function vector3ToLatLng(
  vector: THREE.Vector3,
  radius: number = EngineConfig.globe.radius
): { lat: number; lng: number; altitude: number } {
  const r = vector.length();
  if (r === 0) {
    return { lat: 0, lng: 0, altitude: 0 };
  }

  const phi = Math.acos(Math.max(-1, Math.min(1, vector.y / r)));
  const theta = Math.atan2(vector.z, vector.x);

  let lng = 90 - (theta * 180) / Math.PI;
  if (theta < -Math.PI / 2) {
    lng -= 360;
  }
  // Wrap to [-180, 180]
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;

  const lat = 90 - (phi * 180) / Math.PI;
  const altitude = r / radius - 1;

  return { lat, lng, altitude };
}

/**
 * Great-circle angular distance (in radians) between two geographic coordinates using the Haversine formula.
 * Handles antimeridian crossings and polar proximity without Euclidean distortion.
 */
export function haversineAngularDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/**
 * Haversine physical surface distance in kilometers (Earth mean radius = 6371.0 km).
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const EARTH_RADIUS_KM = 6371.0;
  return haversineAngularDistance(lat1, lon1, lat2, lon2) * EARTH_RADIUS_KM;
}

/**
 * Calculates the true spherical geographic center (centroid) of a collection of coordinates.
 * Uses 3D Cartesian unit-vector summation and trigonometric reversal to eliminate polar
 * and antimeridian (+-180 deg) singularities and distortion.
 *
 * @param coords Array of latitude and longitude coordinates
 * @returns Geographic spherical centroid in degrees { latitude, longitude }
 */
export function calculateSphericalCentroid(
  coords: Array<{ latitude: number; longitude: number }>
): { latitude: number; longitude: number } {
  if (coords.length === 0) {
    return { latitude: 0, longitude: 0 };
  }
  if (coords.length === 1) {
    return { latitude: coords[0].latitude, longitude: coords[0].longitude };
  }

  let totalX = 0;
  let totalY = 0;
  let totalZ = 0;

  for (let i = 0; i < coords.length; i++) {
    const latRad = (coords[i].latitude * Math.PI) / 180;
    const lonRad = (coords[i].longitude * Math.PI) / 180;

    const cosLat = Math.cos(latRad);
    totalX += cosLat * Math.cos(lonRad);
    totalY += cosLat * Math.sin(lonRad);
    totalZ += Math.sin(latRad);
  }

  const hyp = Math.sqrt(totalX * totalX + totalY * totalY);
  const len = Math.sqrt(totalX * totalX + totalY * totalY + totalZ * totalZ);

  // If points cancel each other out across exact antipodes
  if (len < 1e-9) {
    return { latitude: 0, longitude: 0 };
  }

  const lat = (Math.atan2(totalZ, hyp) * 180) / Math.PI;
  let lon = (Math.atan2(totalY, totalX) * 180) / Math.PI;

  // Wrap longitude to [-180, 180]
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;

  return { latitude: lat, longitude: lon };
}
