// ============================================================================
// EVENT LOG — Scrolling T+ event log
// ============================================================================

import { formatMET } from './telemetry.js';

/**
 * Clear all entries from the event log DOM.
 */
export function clearEventLog() {
  const container = document.getElementById('log-entries');
  if (container) container.innerHTML = '';
}

/**
 * Add an entry to the mission event log.
 * @param {string} text - event description
 * @param {boolean} isEvent - highlight as major event
 * @param {number} simTime - current sim time
 * @param {Array} eventLogArray - state.eventLog reference to push into
 */
export function addLogEntry(text, isEvent, simTime, eventLogArray) {
  if (eventLogArray) {
    eventLogArray.push({ text, time: simTime, isEvent });
  }
  const container = document.getElementById('log-entries');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'log-entry' + (isEvent ? ' event' : '');
  el.textContent = `T+${formatMET(simTime)} ${text}`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;

  // Keep last 20 entries visible
  while (container.children.length > 20) container.removeChild(container.firstChild);
}
