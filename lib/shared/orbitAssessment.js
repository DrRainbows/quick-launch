/**
 * @module lib/shared/orbitAssessment
 * @description Criteria for declaring orbit insertion successful.
 *   Used by integration tests and the headless mission pipeline.
 */

/** Minimum apoapsis altitude [km] for a successful insertion */
export const MIN_APOAPSIS_KM = 150;

/** Minimum periapsis altitude [km] for a stable orbit */
export const MIN_PERIAPSIS_KM = 100;

/** Maximum eccentricity for a nominally circular insertion */
export const MAX_ECCENTRICITY = 0.15;

/**
 * @param {object} orbit - { apoAlt, periAlt, ecc, phase } in km / dimensionless
 * @param {object} simResult - Output from `runSimulation()`
 * @param {string} orbitAchievedPhase - Value of `FlightPhase.ORBIT_ACHIEVED`
 * @returns {boolean}
 */
export function assessOrbit(orbit, simResult, orbitAchievedPhase) {
  return (
    simResult?.success === true &&
    orbit.phase === orbitAchievedPhase &&
    orbit.apoAlt >= MIN_APOAPSIS_KM &&
    orbit.periAlt >= MIN_PERIAPSIS_KM &&
    orbit.ecc < MAX_ECCENTRICITY
  );
}
