// ============================================================================
// GROUND TRACK — Orbital ground track visualization on Earth surface
// ============================================================================
// Draws the sub-satellite point trace (sine-wave ground track) on the globe.
// The track is parented to earthGroup so it rotates with the Earth.
// Computes one full orbital period of the ground track from the current state.

import { GM, RE, OMEGA, EARTH_RADIUS_SCENE, SCALE, DEG } from '../constants.js';

let groundTrackLines = [];   // Array of Three.js Line objects
let targetEarthGroup = null;  // Reference to earthGroup

/** Maximum number of ground track lines (one per payload). */
const MAX_TRACKS = 10;

/**
 * Initialize the ground track system with a reference to earthGroup.
 * Call once during scene setup.
 * @param {THREE.Group} earthGroup
 */
export function initGroundTrack(earthGroup) {
  targetEarthGroup = earthGroup;
}

/**
 * Compute ground track points for a payload in orbit.
 * Propagates the orbit forward for one period, converting ECI positions
 * to ECEF lat/lon at each timestep, then to surface positions.
 *
 * @param {Object} eciState - { x, y, z, vx, vy, vz } in ECI meters
 * @param {number} earthRotAngle - current Earth rotation angle (radians)
 * @returns {Float32Array|null} - scene-space positions for earthGroup-local coords, or null
 */
function computeGroundTrackPoints(eciState, earthRotAngle) {
  const s = eciState;
  const r = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
  const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
  const energy = 0.5 * v * v - GM / r;
  const sma = -GM / (2 * energy);
  if (sma < 0 || sma > 1e9) return null; // hyperbolic or invalid

  const period = 2 * Math.PI * Math.sqrt(sma * sma * sma / GM);
  const nPoints = 256;
  const dt = period / nPoints;

  // Propagate using simple Verlet (same approach as orbit ring)
  let px = s.x, py = s.y, pz = s.z;
  let pvx = s.vx, pvy = s.vy, pvz = s.vz;

  const points = [];
  let lastLon = null;

  for (let i = 0; i <= nPoints; i++) {
    const time = i * dt;

    // ECI to ECEF: rotate by -(earthRotAngle + OMEGA * time)
    const theta = -(earthRotAngle + OMEGA * time);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const xEcef = px * cosT + py * sinT;
    const yEcef = -px * sinT + py * cosT;
    const zEcef = pz;

    // ECEF to geodetic lat/lon
    const rr = Math.sqrt(xEcef * xEcef + yEcef * yEcef + zEcef * zEcef);
    const lat = Math.asin(Math.max(-1, Math.min(1, zEcef / rr)));
    const lon = Math.atan2(yEcef, xEcef);

    // Check for longitude wrap-around (break the line)
    if (lastLon !== null && Math.abs(lon - lastLon) > Math.PI) {
      // Insert NaN to break the line at anti-meridian crossing
      points.push(NaN, NaN, NaN);
    }
    lastLon = lon;

    // Convert lat/lon to earthGroup-local surface position (slightly above surface)
    const surfR = EARTH_RADIUS_SCENE + 0.15; // slight offset above surface
    const ex = surfR * Math.cos(lat) * Math.cos(lon);
    const ey = surfR * Math.cos(lat) * Math.sin(lon);
    const ez = surfR * Math.sin(lat);
    // ECEF to scene convention: x_scene = ex, y_scene = ez, z_scene = -ey
    points.push(ex, ez, -ey);

    // Verlet propagation step
    const rProp = Math.sqrt(px * px + py * py + pz * pz);
    const a = -GM / (rProp * rProp * rProp);
    pvx += a * px * dt;
    pvy += a * py * dt;
    pvz += a * pz * dt;
    px += pvx * dt;
    py += pvy * dt;
    pz += pvz * dt;
  }

  return new Float32Array(points);
}

/**
 * Create or update ground track for a payload orbital object.
 * Call after orbit is achieved to draw the ground track on the globe.
 *
 * @param {Object} orbitalObj - an orbital object from state.orbitalObjects
 * @param {number} earthRotAngle - current Earth rotation angle (radians)
 */
export function addGroundTrack(orbitalObj, earthRotAngle) {
  if (!targetEarthGroup) return;
  if (orbitalObj.type !== 'payload' || orbitalObj.impacted) return;
  if (orbitalObj._groundTrack) return; // Already has a ground track

  const trackData = computeGroundTrackPoints(orbitalObj.state, earthRotAngle);
  if (!trackData) return;

  // Create line segments (handling NaN breaks for anti-meridian crossings)
  // Split the data into separate continuous segments at NaN boundaries
  const segments = [];
  let currentSeg = [];

  for (let i = 0; i < trackData.length; i += 3) {
    if (isNaN(trackData[i])) {
      if (currentSeg.length > 0) {
        segments.push(new Float32Array(currentSeg));
        currentSeg = [];
      }
    } else {
      currentSeg.push(trackData[i], trackData[i + 1], trackData[i + 2]);
    }
  }
  if (currentSeg.length > 0) {
    segments.push(new Float32Array(currentSeg));
  }

  // Create a line for each continuous segment
  const color = orbitalObj.color || 0x00e676;
  const lines = [];

  for (const seg of segments) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(seg, 3));
    const mat = new THREE.LineDashedMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      dashSize: 0.8,
      gapSize: 0.4,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.frustumCulled = false;
    targetEarthGroup.add(line);
    lines.push(line);
  }

  // Store reference on the orbital object for cleanup
  orbitalObj._groundTrack = lines;
  groundTrackLines.push(...lines);

  // Limit total number of ground tracks
  while (groundTrackLines.length > MAX_TRACKS * 10) {
    const old = groundTrackLines.shift();
    targetEarthGroup.remove(old);
    old.geometry.dispose();
    old.material.dispose();
  }
}

/**
 * Remove ground track for a specific orbital object.
 * @param {Object} orbitalObj
 */
export function removeGroundTrack(orbitalObj) {
  if (!orbitalObj._groundTrack || !targetEarthGroup) return;
  for (const line of orbitalObj._groundTrack) {
    targetEarthGroup.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    const idx = groundTrackLines.indexOf(line);
    if (idx >= 0) groundTrackLines.splice(idx, 1);
  }
  orbitalObj._groundTrack = null;
}

/**
 * Clear all ground tracks from the scene.
 */
export function clearAllGroundTracks() {
  if (!targetEarthGroup) return;
  for (const line of groundTrackLines) {
    targetEarthGroup.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  }
  groundTrackLines = [];
}
