'use strict';
// ============================================================================
// MISSION PIPELINE — generate → plan → stageConfig → GNC (same path as browser)
// ============================================================================

const { generateRocket } = require('./rocketGenerator.js');
const { planMission } = require('./orbitalMechanics.js');
const { buildStageConfigs, stagesToGNCConfig } = require('./stageConfig.cjs');
const {
  runSimulation,
  orbitalElements,
  FlightPhase,
} = require('../gnc.js');

function flyRocket(rocket, lat, lon, orbitClass) {
  const mission = planMission({
    totalDeltaV: rocket.validation.totalDeltaV,
    launchLatDeg: lat,
    launchLonDeg: lon,
    preferredOrbit: orbitClass,
  });

  if (!mission.success || !mission.selected) {
    throw new Error(`Mission planning failed at lat=${lat}`);
  }

  const sel = mission.selected;
  const target = {
    altitude: Math.min(sel.altitude, 600000),
    inclination: sel.inclinationDeg,
  };

  const { stages: simStages, payloadMass } = buildStageConfigs(rocket, mission);
  const gncConfig = stagesToGNCConfig(simStages, rocket, lat, mission);
  gncConfig.payloadMass = payloadMass;

  const simResult = runSimulation(gncConfig, target, { maxTime: 3600, dt: 0.1 });
  const tel = simResult.telemetry;
  const elems = orbitalElements(simResult.finalState.pos, simResult.finalState.vel);

  return {
    rocket,
    mission,
    gncConfig,
    simResult,
    orbit: {
      apoAlt: elems.apoapsisAlt / 1000,
      periAlt: elems.periapsisAlt / 1000,
      ecc: elems.e,
      phase: tel.phase,
    },
  };
}

/**
 * Pattern language + physics: keep generating until GNC achieves orbit.
 * This is the real viability criterion — not a hardcoded fallback.
 */
function generateFlyableRocket(lat, lon = 0, orbitClass = 'LEO', options = {}) {
  const maxAttempts = options.maxAttempts || 80;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const payloadMass = options.payloadMass || Math.round(3000 + Math.random() * 7000);
      const rocket = generateRocket(lat, orbitClass, { ...options, payloadMass });
      if (!rocket.validation.valid) continue;
      const dvMargin = rocket.validation.totalDeltaV / rocket.mission.requiredDeltaV;
      if (dvMargin < 1.02) continue;
      if ((rocket.performance?.liftoffTWR || 0) < 1.08) continue;

      const result = flyRocket(rocket, lat, lon, orbitClass);
      if (assessOrbit(result.orbit, result.simResult)) return result;
      lastError = new Error(`Flight failed: phase=${result.orbit.phase} apo=${result.orbit.apoAlt.toFixed(0)}km`);
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error(`No flyable rocket in ${maxAttempts} attempts at lat=${lat}`);
}

/** @deprecated use generateFlyableRocket — kept for generator-only validation */
function flyGeneratedMission(lat, lon = 0, orbitClass = 'LEO', options = {}) {
  const rocket = generateRocket(lat, orbitClass, options);
  if (!rocket.validation.valid) {
    throw new Error(`Invalid rocket: ${rocket.validation.warnings.join('; ')}`);
  }
  return flyRocket(rocket, lat, lon, orbitClass);
}

function assessOrbit(orbit, simResult) {
  return (
    simResult?.success &&
    orbit.phase === FlightPhase.ORBIT_ACHIEVED &&
    orbit.apoAlt >= 150 &&
    orbit.periAlt >= 100 &&
    orbit.ecc < 0.15
  );
}

module.exports = { generateFlyableRocket, flyGeneratedMission, flyRocket, assessOrbit };
