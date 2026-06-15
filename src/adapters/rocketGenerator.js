/**
 * @module src/adapters/rocketGenerator
 * @description ES module facade over `window.RocketGen` (loaded from `lib/rocketGenerator.js`).
 *
 * The pattern-language engine ships as a UMD classic script for zero-build browser
 * delivery. This adapter exposes named exports for the ESM application layer.
 */

const RocketGen = window.RocketGen;

if (!RocketGen) {
  throw new Error(
    'RocketGen not found on window. Load lib/rocketGenerator.js before ES modules.'
  );
}

export const generateRocket = RocketGen.generateRocket;
export const generateViableRocket = RocketGen.generateViableRocket;
export const generateEngine = RocketGen.generateEngine;
export const generateStage = RocketGen.generateStage;
export const generateFairing = RocketGen.generateFairing;
export const sizeTanks = RocketGen.sizeTanks;
export const selectDesignStrategy = RocketGen.selectDesignStrategy;
export const validateRocket = RocketGen.validateRocket;
export const PROPELLANTS = RocketGen.PROPELLANTS;
export const ENGINE_CYCLES = RocketGen.ENGINE_CYCLES;
export const ORBIT_CLASSES = RocketGen.ORBIT_CLASSES;
export const PHYS = RocketGen.PHYS;

export default RocketGen;
