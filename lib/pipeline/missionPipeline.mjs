/**
 * @module lib/pipeline/missionPipeline
 * @description Headless mission pipeline mirroring the browser path:
 *
 *   generateRocket → planMission → buildStageConfigs → GNC → orbit assessment
 *
 * Uses `createRequire` to load UMD simulation engines (`rocketGenerator.js`,
 * `orbitalMechanics.js`, `gnc.js`) from Node without a bundler.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { buildStageConfigs } from '../shared/stageConfig.js';
import { stagesToGNCConfig } from '../shared/stagesToGNCConfig.js';
import { assessOrbit as assessOrbitCore } from '../shared/orbitAssessment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, 'missionPipeline.mjs'));

const { generateRocket } = require('../rocketGenerator.js');
const { planMission } = require('../orbitalMechanics.js');
const { runSimulation, orbitalElements, FlightPhase } = require('../../gnc.js');

/** Default retry budget for `generateFlyableRocket` */
export const DEFAULT_MAX_ATTEMPTS = 100;

/** Minimum ΔV margin (achieved / required) before attempting GNC flight */
export const MIN_DV_MARGIN = 1.02;

/** Minimum liftoff TWR from generator performance summary */
export const MIN_GENERATOR_LIFTOFF_TWR = 1.08;

/**
 * Fly a generated rocket through mission planning, stage config, and GNC.
 *
 * @param {object} rocket
 * @param {number} lat - Launch latitude [degrees]
 * @param {number} lon - Launch longitude [degrees]
 * @param {string} orbitClass - e.g. `'LEO'`, `'SSO'`
 * @returns {object} Flight result with rocket, mission, gncConfig, simResult, orbit
 */
export function flyRocket(rocket, lat, lon, orbitClass) {
  const mission = planMission({
    totalDeltaV: rocket.validation.totalDeltaV,
    launchLatDeg: lat,
    launchLonDeg: lon,
    preferredOrbit: orbitClass,
  });

  if (!mission.success || !mission.selected) {
    throw new Error(`Mission planning failed at lat=${lat}`);
  }

  const selected = mission.selected;
  const target = {
    altitude: Math.min(selected.altitude, 600000),
    inclination: selected.inclinationDeg,
  };

  const { stages: simStages, payloadMass } = buildStageConfigs(rocket, mission);
  const gncConfig = stagesToGNCConfig(simStages, rocket, lat, mission);
  gncConfig.payloadMass = payloadMass;

  const simResult = runSimulation(gncConfig, target, { maxTime: 3600, dt: 0.1 });
  const telemetry = simResult.telemetry;
  const elements = orbitalElements(simResult.finalState.pos, simResult.finalState.vel);

  return {
    rocket,
    mission,
    gncConfig,
    simResult,
    orbit: {
      apoAlt: elements.apoapsisAlt / 1000,
      periAlt: elements.periapsisAlt / 1000,
      ecc: elements.e,
      phase: telemetry.phase,
    },
  };
}

/**
 * Generate rockets until GNC achieves orbit — the real viability criterion.
 *
 * @param {number} lat
 * @param {number} [lon=0]
 * @param {string} [orbitClass='LEO']
 * @param {object} [options]
 * @returns {object} Successful flight result from `flyRocket`
 */
export function generateFlyableRocket(lat, lon = 0, orbitClass = 'LEO', options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const payloadMass =
        options.payloadMass ?? Math.round(3000 + Math.random() * 7000);

      const rocket = generateRocket(lat, orbitClass, { ...options, payloadMass });
      if (!rocket.validation.valid) continue;

      const dvMargin = rocket.validation.totalDeltaV / rocket.mission.requiredDeltaV;
      if (dvMargin < MIN_DV_MARGIN) continue;
      if ((rocket.performance?.liftoffTWR || 0) < MIN_GENERATOR_LIFTOFF_TWR) continue;

      const result = flyRocket(rocket, lat, lon, orbitClass);
      if (assessOrbitCore(result.orbit, result.simResult, FlightPhase.ORBIT_ACHIEVED)) {
        return result;
      }

      lastError = new Error(
        `Flight failed: phase=${result.orbit.phase} apo=${result.orbit.apoAlt.toFixed(0)}km`
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`No flyable rocket in ${maxAttempts} attempts at lat=${lat}`);
}

/**
 * Single-attempt flight for a pre-generated rocket (throws on validation failure).
 *
 * @deprecated Prefer `generateFlyableRocket` for integration tests
 */
export function flyGeneratedMission(lat, lon = 0, orbitClass = 'LEO', options = {}) {
  const rocket = generateRocket(lat, orbitClass, options);
  if (!rocket.validation.valid) {
    throw new Error(`Invalid rocket: ${rocket.validation.warnings.join('; ')}`);
  }
  return flyRocket(rocket, lat, lon, orbitClass);
}

export function assessOrbit(orbit, simResult) {
  return assessOrbitCore(orbit, simResult, FlightPhase.ORBIT_ACHIEVED);
}
