// ============================================================================
// AERODYNAMICS — Drag coefficient model
// ============================================================================
// Transonic drag rise model. Used by FlightSim for atmospheric drag.

/**
 * Drag coefficient as a function of Mach number.
 * Models transonic drag rise and supersonic decay.
 */
export function dragCd(mach) {
  if (mach < 0.8) return 0.29;
  if (mach < 1.1) return 0.29 + (mach - 0.8) * 0.7;   // transonic rise
  if (mach < 1.5) return 0.50 - (mach - 1.1) * 0.5;
  return Math.max(0.15, 0.30 - (mach - 1.5) * 0.05);
}
