// ============================================================================
// PHASE MANAGER — State machine for mission phases
// ============================================================================
// Phases: IDLE → DESIGN → COUNTDOWN → ASCENT → ORBIT_ACHIEVED
// Cancel can interrupt DESIGN, COUNTDOWN, or ASCENT and return to IDLE.

import { getState, dispatch } from '../store.js';
import { on } from '../eventBus.js';

/** Valid phase transitions. */
const TRANSITIONS = {
  IDLE:            ['DESIGN'],
  DESIGN:          ['COUNTDOWN', 'IDLE'],   // IDLE = cancel
  COUNTDOWN:       ['ASCENT', 'IDLE'],      // IDLE = cancel
  ASCENT:          ['ORBIT_ACHIEVED', 'IDLE'], // IDLE = cancel/abort
  ORBIT_ACHIEVED:  ['IDLE', 'DESIGN'],      // click new site or generate new rocket
};

/**
 * Attempt a phase transition. Returns true if valid.
 */
export function transitionTo(newPhase) {
  const state = getState();
  const allowed = TRANSITIONS[state.phase];
  if (!allowed || !allowed.includes(newPhase)) {
    console.warn(`Invalid phase transition: ${state.phase} → ${newPhase}`);
    return false;
  }
  dispatch('SET_PHASE', newPhase);
  return true;
}

/**
 * Check if a transition is valid from current phase.
 */
export function canTransition(newPhase) {
  const state = getState();
  const allowed = TRANSITIONS[state.phase];
  return allowed && allowed.includes(newPhase);
}

/**
 * Get current phase.
 */
export function currentPhase() {
  return getState().phase;
}
