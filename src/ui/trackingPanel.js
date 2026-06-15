// ============================================================================
// TRACKING PANEL — Orbital objects list with altitude/status
// ============================================================================

import { RE } from '../constants.js';

/**
 * Update the tracking panel with current orbital objects and active vehicle.
 * @param {Array} orbitalObjects - state.orbitalObjects
 * @param {Object|null} simulator - active FlightSim instance
 * @param {string} phase - current app phase
 */
export function updateTrackingPanel(orbitalObjects, simulator, phase) {
  const container = document.getElementById('tracking-entries');
  if (!container) return;

  let html = '';

  // Active ascent vehicle
  if (phase === 'ASCENT' && simulator) {
    const telem = simulator.getTelemetry();
    const alt = (telem.altitude || 0) / 1000;
    html += `<div class="track-entry">
      <div class="track-dot" style="background:var(--cyan);box-shadow:0 0 6px var(--cyan);"></div>
      <span class="track-name">ACTIVE — Stage ${(telem.currentStage || 0) + 1}</span>
      <span class="track-status">${alt.toFixed(1)} km</span>
    </div>`;
  }

  // All orbital objects
  for (const obj of orbitalObjects) {
    const r = Math.sqrt(obj.state.x ** 2 + obj.state.y ** 2 + obj.state.z ** 2);
    const alt = (r - RE) / 1000;
    let statusText, dotColor;

    if (obj.impacted) {
      statusText = 'IMPACT';
      dotColor = '#ff3d00';
    } else if (obj.type === 'payload') {
      statusText = `${alt.toFixed(1)} km`;
      dotColor = '#00e676';
    } else {
      statusText = alt > 0 ? `${alt.toFixed(1)} km ↓` : 'IMPACT';
      dotColor = '#ff6d00';
    }

    html += `<div class="track-entry">
      <div class="track-dot" style="background:${dotColor};"></div>
      <span class="track-name">${obj.name || obj.type.toUpperCase()}</span>
      <span class="track-status">${statusText}</span>
    </div>`;
  }

  container.innerHTML = html;
}
