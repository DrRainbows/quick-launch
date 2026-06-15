/**
 * @module src/adapters/orbitalMechanics
 * @description ES module facade over `window.OrbitalMechanics` (loaded from `lib/orbitalMechanics.js`).
 */

const OrbitalMechanics = window.OrbitalMechanics;

if (!OrbitalMechanics) {
  throw new Error(
    'OrbitalMechanics not found on window. Load lib/orbitalMechanics.js before ES modules.'
  );
}

export const planMission = OrbitalMechanics.planMission;
export const selectOrbit = OrbitalMechanics.selectOrbit;
export const computeDeltaVBudget = OrbitalMechanics.computeDeltaVBudget;
export const getAchievableOrbits = OrbitalMechanics.getAchievableOrbits;
export const computeOrbitalElements = OrbitalMechanics.computeOrbitalElements;
export const propagateOrbit = OrbitalMechanics.propagateOrbit;
export const generateOrbitTrace = OrbitalMechanics.generateOrbitTrace;
export const generateGroundTrack = OrbitalMechanics.generateGroundTrack;
export const launchAzimuth = OrbitalMechanics.launchAzimuth;
export const circularVelocity = OrbitalMechanics.circularVelocity;
export const orbitalPeriod = OrbitalMechanics.orbitalPeriod;
export const hohmannTransfer = OrbitalMechanics.hohmannTransfer;
export const CONST = OrbitalMechanics.CONST;

export default OrbitalMechanics;
