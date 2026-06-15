// ============================================================================
// TELEMETRY — SpaceX-style readout updates
// ============================================================================
// Subscribes to sim:tick events and updates DOM telemetry elements.

import { G0, RE, OMEGA } from '../constants.js';

/** Format Mission Elapsed Time as HH:MM:SS. */
export function formatMET(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Compute great-circle downrange distance from launch site.
 * Converts ECI position to ECEF lat/lon using Earth rotation angle,
 * then uses the haversine formula for arc distance.
 *
 * @param {Object} simState - { x, y, z } in ECI meters
 * @param {number} launchLat - launch latitude in degrees
 * @param {number} launchLon - launch longitude in degrees
 * @param {number} earthRotAngle - current Earth rotation angle in radians
 * @returns {number} downrange distance in meters
 */
function computeDownrange(simState, launchLat, launchLon, earthRotAngle) {
  // Convert ECI position to ECEF by rotating back by Earth angle
  const cosT = Math.cos(-earthRotAngle);
  const sinT = Math.sin(-earthRotAngle);
  const xEcef = simState.x * cosT + simState.y * sinT;
  const yEcef = -simState.x * sinT + simState.y * cosT;
  const zEcef = simState.z;

  // ECEF to geodetic lat/lon
  const r = Math.sqrt(xEcef * xEcef + yEcef * yEcef + zEcef * zEcef);
  if (r < 1) return 0;
  const lat2 = Math.asin(Math.max(-1, Math.min(1, zEcef / r)));  // radians
  const lon2 = Math.atan2(yEcef, xEcef);                         // radians

  // Launch site in radians
  const lat1 = launchLat * Math.PI / 180;
  const lon1 = launchLon * Math.PI / 180;

  // Great-circle arc distance: R * arccos(sin(lat1)*sin(lat2) + cos(lat1)*cos(lat2)*cos(dlon))
  const cosArc = Math.sin(lat1) * Math.sin(lat2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const arc = Math.acos(Math.max(-1, Math.min(1, cosArc)));

  return RE * arc;
}

/**
 * Update all telemetry DOM elements from FlightSim telemetry data.
 * @param {Object} telem - from FlightSim.getTelemetry()
 * @param {number} simTime - current simulation time
 * @param {Object} simState - raw state { x, y, z, vx, vy, vz, mass }
 * @param {boolean} showAdvanced - whether advanced panel is visible
 * @param {Array} trajectoryPoints - trajectory history for plot
 * @param {number} launchLat - launch latitude in degrees
 * @param {number} launchLon - launch longitude in degrees
 * @param {number} earthRotAngle - current Earth rotation angle in radians
 */
export function updateTelemetryDisplay(telem, simTime, simState, showAdvanced, trajectoryPoints, launchLat, launchLon, earthRotAngle) {
  const alt = telem.altitude || 0;
  const speed = telem.airspeed || 0;
  const accel = (telem.acceleration || 0) / G0;
  const dynP = telem.dynamicPressure || 0;
  const mach = telem.mach || 0;

  // Great-circle downrange distance from launch site
  const downrange = computeDownrange(simState, launchLat || 0, launchLon || 0, earthRotAngle || 0);

  // Primary readouts
  const speedKmh = speed * 3.6;
  const el = (id) => document.getElementById(id);
  el('t-speed').textContent = speedKmh < 100 ? speedKmh.toFixed(1) : Math.round(speedKmh).toLocaleString();
  el('t-alt').textContent = (alt / 1000).toFixed(1);
  el('t-mach').textContent = mach.toFixed(2);
  el('t-accel').textContent = accel.toFixed(1);
  el('t-dynp').textContent = (dynP / 1000).toFixed(1);
  el('t-downrange').textContent = (downrange / 1000).toFixed(1);

  // Velocity decomposition: radial (along position vector) and tangential (perpendicular)
  const r = Math.sqrt(simState.x * simState.x + simState.y * simState.y + simState.z * simState.z);
  let vRad = 0, vTan = 0;
  if (r > 1) {
    // Radial velocity = dot(v, r_hat)
    vRad = (simState.vx * simState.x + simState.vy * simState.y + simState.vz * simState.z) / r;
    // Tangential velocity = sqrt(v^2 - vRad^2)
    const vMagSq = simState.vx * simState.vx + simState.vy * simState.vy + simState.vz * simState.vz;
    vTan = Math.sqrt(Math.max(0, vMagSq - vRad * vRad));
  }
  // For bar width, normalize against orbital velocity (~7800 m/s) for meaningful display
  const vRef = 8000;
  const radPct = Math.min(100, (Math.abs(vRad) / vRef) * 100);
  const tanPct = Math.min(100, (vTan / vRef) * 100);

  el('v-rad-fill').style.width = radPct + '%';
  el('v-rad-val').textContent = Math.round(vRad);
  el('v-tan-fill').style.width = tanPct + '%';
  el('v-tan-val').textContent = Math.round(vTan);

  // Propellant bars
  const propPct = (telem.propellantRemaining || 0) * 100;
  el('prop-lox-fill').style.height = propPct + '%';
  el('prop-lox-pct').textContent = Math.round(propPct) + '%';
  el('prop-fuel-fill').style.height = propPct + '%';
  el('prop-fuel-pct').textContent = Math.round(propPct) + '%';

  // MET
  el('met-time').textContent = 'T+' + formatMET(simTime);

  // Track trajectory points for mini plot (include phase for coloring)
  trajectoryPoints.push({ alt: alt / 1000, downrange: downrange / 1000, time: simTime, phase: telem.phase });

  // Advanced engineering telemetry
  if (showAdvanced) {
    const oe = telem.orbitalElements || {};
    el('a-sma').textContent = ((oe.a || 0) / 1000).toFixed(1) + ' km';
    el('a-ecc').textContent = (oe.e || 0).toFixed(5);
    el('a-inc').textContent = (oe.inc || 0).toFixed(2) + '°';
    el('a-apo').textContent = ((oe.apoAlt || 0) / 1000).toFixed(1) + ' km';
    el('a-peri').textContent = ((oe.periAlt || 0) / 1000).toFixed(1) + ' km';
    el('a-period').textContent = ((oe.period || 0) / 60).toFixed(1) + ' min';
    el('a-mass').textContent = (simState.mass).toFixed(0) + ' kg';
    el('a-pitch').textContent = (telem.pitchAngle || 0).toFixed(1) + '°';
    el('a-dynp').textContent = (dynP / 1000).toFixed(2) + ' kPa';
    el('a-maxq').textContent = ((telem.maxQ || 0) / 1000).toFixed(1) + ' kPa';
    el('a-maxg').textContent = (telem.maxG || 0).toFixed(1) + ' g';
    el('a-pos').textContent = `${(simState.x / 1000).toFixed(0)}, ${(simState.y / 1000).toFixed(0)}, ${(simState.z / 1000).toFixed(0)} km`;
    el('a-vel').textContent = `${simState.vx.toFixed(0)}, ${simState.vy.toFixed(0)}, ${simState.vz.toFixed(0)} m/s`;
  }
}
