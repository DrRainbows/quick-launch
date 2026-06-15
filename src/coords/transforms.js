// ============================================================================
// COORDINATE TRANSFORMS — Unified, documented once
// ============================================================================
// Convention:
//   ECI (Earth-Centered Inertial): X = vernal equinox, Y = 90°E, Z = north pole (Z-up)
//   Three.js scene: Y-up, right-handed
//   Mapping: X_eci → X_scene, Z_eci → Y_scene, Y_eci → -Z_scene
//
//   ECEF lat/lon:
//     x_ecef = R·cos(lat)·cos(lon)
//     y_ecef = R·cos(lat)·sin(lon)
//     z_ecef = R·sin(lat)
//
// All functions in this module use these conventions consistently.

import { RE, OMEGA, EARTH_RADIUS_SCENE, SCALE, DEG, RAD } from '../constants.js';

// ---- ECI ↔ Scene ----

/** ECI meters → Three.js scene position */
export function eciToScene(x, y, z) {
  return { x: x * SCALE, y: z * SCALE, z: -y * SCALE };
}

/** Three.js scene position → ECI meters */
export function sceneToEci(sx, sy, sz) {
  return { x: sx / SCALE, y: -sz / SCALE, z: sy / SCALE };
}

/** ECI velocity → Three.js scene direction (for orientation, unscaled) */
export function eciVelToScene(vx, vy, vz) {
  return { x: vx, y: vz, z: -vy };
}

// ---- ECEF (lat/lon) ↔ Scene ----

/** ECEF lat/lon/alt → scene coords (earthGroup-local, rotates with Earth) */
export function latLonToScene(latDeg, lonDeg, altMeters) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const r = EARTH_RADIUS_SCENE + altMeters * SCALE;
  const ex = r * Math.cos(lat) * Math.cos(lon);
  const ey = r * Math.cos(lat) * Math.sin(lon);
  const ez = r * Math.sin(lat);
  return { x: ex, y: ez, z: -ey };
}

/** Scene position (earthGroup-local) → ECEF lat/lon in degrees */
export function sceneToLatLon(sx, sy, sz) {
  const ex = sx;
  const ey = -sz;
  const ez = sy;
  const r = Math.sqrt(ex * ex + ey * ey + ez * ez);
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, ez / r))) * RAD,
    lon: Math.atan2(ey, ex) * RAD,
  };
}

// ---- ECI ↔ ECEF ----

/** ECI position → ECEF position given Earth rotation angle (radians) */
export function eciToEcef(x, y, z, earthRotAngle) {
  const cosT = Math.cos(-earthRotAngle);
  const sinT = Math.sin(-earthRotAngle);
  return {
    x: x * cosT + y * sinT,
    y: -x * sinT + y * cosT,
    z: z,
  };
}

/** ECEF position → ECI position given Earth rotation angle */
export function ecefToEci(x, y, z, earthRotAngle) {
  const cosT = Math.cos(earthRotAngle);
  const sinT = Math.sin(earthRotAngle);
  return {
    x: x * cosT + y * sinT,
    y: -x * sinT + y * cosT,
    z: z,
  };
}

/** ECEF position → scene coords (for impact markers etc.) */
export function ecefToScene(xEcef, yEcef, zEcef) {
  return { x: xEcef * SCALE, y: zEcef * SCALE, z: -yEcef * SCALE };
}

// ---- Launch Site ----

/** Launch site ECEF → ECI initial position and velocity */
export function launchSiteToEci(latDeg, lonDeg, earthRotAngle) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG + earthRotAngle;
  return {
    pos: {
      x: RE * Math.cos(lat) * Math.cos(lon),
      y: RE * Math.cos(lat) * Math.sin(lon),
      z: RE * Math.sin(lat),
    },
    vel: {
      x: -OMEGA * RE * Math.cos(lat) * Math.sin(lon),
      y:  OMEGA * RE * Math.cos(lat) * Math.cos(lon),
      z: 0,
    },
  };
}
