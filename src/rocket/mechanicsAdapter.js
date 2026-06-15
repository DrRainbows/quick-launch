// ============================================================================
// ORBITAL MECHANICS ADAPTER — ES module facade over window.OrbitalMechanics
// ============================================================================
// orbitalMechanics.js loads as a classic <script> tag and sets window.OrbitalMechanics.
// This adapter re-exports everything as ES module named exports.

const OM = window.OrbitalMechanics;

if (!OM) {
  throw new Error('OrbitalMechanics not found on window. Ensure lib/orbitalMechanics.js is loaded before ES modules.');
}

export const planMission = OM.planMission;
export const selectOrbit = OM.selectOrbit;
export const computeDeltaVBudget = OM.computeDeltaVBudget;
export const getAchievableOrbits = OM.getAchievableOrbits;
export const computeOrbitalElements = OM.computeOrbitalElements;
export const propagateOrbit = OM.propagateOrbit;
export const generateOrbitTrace = OM.generateOrbitTrace;
export const generateGroundTrack = OM.generateGroundTrack;
export const launchAzimuth = OM.launchAzimuth;
export const circularVelocity = OM.circularVelocity;
export const orbitalPeriod = OM.orbitalPeriod;
export const hohmannTransfer = OM.hohmannTransfer;
export const CONST = OM.CONST;

export default OM;
