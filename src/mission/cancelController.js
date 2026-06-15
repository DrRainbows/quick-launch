// ============================================================================
// CANCEL CONTROLLER — Cancel at any phase, cleanup, return to IDLE
// ============================================================================
// Manages per-mission resources and cleanup. Cancel disposes temp objects,
// resets state, and transitions back to IDLE.

import { getState, dispatch } from '../store.js';
import { emit } from '../eventBus.js';

let cancelCountdown = null;  // set by missionFlow when countdown starts

/**
 * Register a countdown cancel function (called by missionFlow).
 */
export function setCountdownCancel(fn) {
  cancelCountdown = fn;
}

/**
 * Cancel the current mission at whatever phase it's in.
 * Returns true if cancellation was performed.
 */
export function cancelMission() {
  const state = getState();
  const phase = state.phase;

  if (phase === 'IDLE' || phase === 'ORBIT_ACHIEVED') {
    return false; // nothing to cancel
  }

  emit('mission:cancel', { phase });

  switch (phase) {
    case 'DESIGN':
      // Just hide the design panel and return to IDLE
      dispatch('SET_PHASE', 'IDLE');
      dispatch('RESET_MISSION');
      break;

    case 'COUNTDOWN':
      // Stop the countdown timer
      if (cancelCountdown) {
        cancelCountdown();
        cancelCountdown = null;
      }
      dispatch('SET_PHASE', 'IDLE');
      dispatch('RESET_MISSION');
      break;

    case 'ASCENT':
      // Stop the simulator, release camera
      dispatch('SET_TRACKING', false);
      dispatch('SET_PHASE', 'ORBIT_ACHIEVED'); // enter idle-like state
      dispatch('RESET_WARP');
      // Don't RESET_MISSION — keep orbital objects from this mission
      break;
  }

  document.getElementById('subtitle').textContent = 'CLICK EARTH TO SELECT LAUNCH SITE';

  return true;
}
