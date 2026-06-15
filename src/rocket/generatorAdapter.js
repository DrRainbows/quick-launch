// ============================================================================
// ROCKET GENERATOR ADAPTER — ES module facade over window.RocketGen
// ============================================================================
// rocketGenerator.js loads as a classic <script> tag and sets window.RocketGen.
// This adapter re-exports everything as ES module named exports.
// If/when rocketGenerator.js is converted to ES module, only this file changes.

const RG = window.RocketGen;

if (!RG) {
  throw new Error('RocketGen not found on window. Ensure lib/rocketGenerator.js is loaded before ES modules.');
}

export const generateRocket = RG.generateRocket;
export const generateViableRocket = RG.generateViableRocket;
export const generateEngine = RG.generateEngine;
export const generateStage = RG.generateStage;
export const generateFairing = RG.generateFairing;
export const sizeTanks = RG.sizeTanks;
export const selectDesignStrategy = RG.selectDesignStrategy;
export const validateRocket = RG.validateRocket;
export const PROPELLANTS = RG.PROPELLANTS;
export const ENGINE_CYCLES = RG.ENGINE_CYCLES;
export const ORBIT_CLASSES = RG.ORBIT_CLASSES;
export const PHYS = RG.PHYS;

export default RG;
