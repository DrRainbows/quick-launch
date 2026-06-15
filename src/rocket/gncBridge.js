// ============================================================================
// GNC BRIDGE — Full mapping from generator output to GNC-compatible config
// ============================================================================
// The rocket generator (lib/rocketGenerator.js) outputs ~60 parameters per
// stage, but the old sim bridge (stageConfig.js) drops 90% of them. This
// module maps the full generator output to the format expected by GNCComputer
// and FlightSimulator in gnc.js, preserving every useful field.
//
// Also exports a backwards-compatible bridge for the old FlightSim interface
// (src/physics/flightSim.js) so nothing breaks during transition.

import { G0 } from '../constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe numeric access with fallback. */
function num(value, fallback) {
  return (typeof value === 'number' && isFinite(value)) ? value : fallback;
}

/** Resolve the engine object from a stage.
 *  Generator outputs stage.engine as either a single engine object or
 *  (for multi-engine stages) the representative engine spec.
 *  The fallback stage may also store engines under stage.engines.
 */
function resolveEngine(stage) {
  if (stage.engine && typeof stage.engine === 'object' && !Array.isArray(stage.engine)) {
    return stage.engine;
  }
  if (stage.engines && typeof stage.engines === 'object' && !Array.isArray(stage.engines)) {
    return stage.engines;
  }
  return null;
}

/** Resolve engine count from various generator output shapes. */
function resolveEngineCount(stage) {
  if (typeof stage.engineCount === 'number') return stage.engineCount;
  if (stage.engines && typeof stage.engines.count === 'number') return stage.engines.count;
  return 1;
}

// ---------------------------------------------------------------------------
// bridgeToGNC — Full generator output to GNCComputer + FlightSimulator format
// ---------------------------------------------------------------------------

/**
 * Map generator output + mission data to GNC-compatible rocket config.
 *
 * The output matches the shape of RocketConfigs.GenericLEO in gnc.js,
 * which is what GNCComputer and FlightSimulator expect.
 *
 * @param {object} rocket  - Output from generateRocket()
 * @param {object} mission - Output from planMission() (from orbitalMechanics.js)
 * @returns {object} Config compatible with GNCComputer + FlightSimulator
 */
export function bridgeToGNC(rocket, mission) {
  const sel = mission?.selected || {};
  const rawStages = rocket.stages || [];
  const simSeq = rocket.simulationParams?.stageSequence;

  // --- Top-level vehicle fields ---

  const fairingDiam = rocket.fairing?.diameter
    || rocket.designStrategy?.fairingDiameter
    || rocket.fairingDiameter
    || rocket.maxDiameter
    || 3.7;

  const referenceArea = rocket.simulationParams?.referenceArea
    || Math.PI * (fairingDiam / 2) ** 2;

  const payloadMass = rocket.payload?.mass
    || rocket.payloadMass
    || rocket.performance?.payloadToOrbit
    || 5000;

  const launchLatitude = sel.launchLatDeg
    ?? (mission?.launch?.latDeg)
    ?? rocket.mission?.launchLatitude
    ?? 28.5;

  // Derive gimbal rate limit from the first stage engine's gimbal angle.
  // The generator stores gimbalAngle (degrees) on the engine and on the stage.
  // We use it as a proxy for rate limit (degrees/s) since the GNC treats
  // gimbalRateLimit as the max slew rate.
  const firstStage = rawStages[0];
  const firstEngine = firstStage ? resolveEngine(firstStage) : null;
  const firstStageGimbal = firstStage?.gimbalAngle
    ?? firstEngine?.gimbalAngle
    ?? 5.0;

  // Max-Q limit: prefer generator's flight profile estimate, fall back to 35 kPa
  const maxQFromProfile = rocket.flightProfile?.maxQ?.value;
  const maxQLimit = maxQFromProfile
    ? Math.min(maxQFromProfile * 1.1, 50000)  // 10% margin above predicted, cap at 50kPa
    : 35000;

  // --- Per-stage mapping ---

  const stages = rawStages.map((rawStage, i) => {
    const engine = resolveEngine(rawStage);
    const nEngines = resolveEngineCount(rawStage);

    // The simSeq entry for this stage (if available) has pre-aggregated thrust
    const seqEntry = simSeq?.[i];

    // Thrust: prefer stage-level totals, then sequence entry, then engine * count
    const thrustSL = num(rawStage.totalThrustSL,
      num(seqEntry?.thrustSL,
        num(engine?.thrustSL, 0) * nEngines));

    const thrustVac = num(rawStage.totalThrustVac,
      num(seqEntry?.thrustVac,
        num(engine?.thrustVac, 0) * nEngines));

    // Isp: stage-level values are already representative (not per-engine)
    const ispSL = Math.max(
      num(rawStage.ispSL, num(engine?.ispSL, 280)),
      180
    );
    const ispVac = Math.max(
      num(rawStage.ispVac, num(engine?.ispVac, 310)),
      180
    );

    // Mass — cap structural fraction at realistic values.
    // The generator sometimes produces 20-35% structural fractions;
    // real rockets achieve 4-12% (Falcon 9 ~4%, Atlas V ~8%).
    const rawDryMass = num(rawStage.dryMass, 4000);
    const propellantMass = num(rawStage.propellantMass,
      num(seqEntry?.propellantMass, num(seqEntry?.propMass, 92000)));
    const maxFrac = (i === 0) ? 0.08 : 0.06;
    const actualFrac = rawDryMass / (rawDryMass + propellantMass);
    const dryMass = (actualFrac > maxFrac)
      ? maxFrac * propellantMass / (1 - maxFrac)
      : rawDryMass;

    // Burn time: from stage, sequence entry, or compute from mass flow
    const burnTime = num(rawStage.burnTime,
      num(seqEntry?.burnTime,
        thrustVac > 0 ? propellantMass / (thrustVac / (ispVac * G0)) : 200));

    // Gimbal angle: stage level (copied from engine by generator), or engine level
    const gimbalAngle = num(rawStage.gimbalAngle,
      num(engine?.gimbalAngle, 5.0));

    // Throttle range: generator stores minThrottle on stage and engine
    const minThrottle = num(rawStage.minThrottle,
      num(engine?.minThrottle,
        num(seqEntry?.throttleMin, 1.0)));
    const maxThrottle = num(rawStage.maxThrottle,
      num(engine?.maxThrottle, 1.0));

    // Restartable: from engine capabilities
    const restartable = engine?.restartable ?? false;

    return {
      // Identity
      name:           rawStage.designation || rawStage.name || `Stage ${i + 1}`,

      // Mass
      dryMass,
      propellantMass,

      // Thrust (GNCComputer reads stage.thrust for sea-level, stage.thrustVac for vacuum)
      thrust:         thrustSL,
      thrustVac:      Math.max(thrustVac, thrustSL),

      // Isp (GNCComputer reads stage.isp for sea-level, stage.ispVac for vacuum)
      isp:            ispSL,
      ispVac,

      // Timing
      burnTime,

      // Engine count
      nEngines,

      // Steering
      throttleRange:  [minThrottle, maxThrottle],
      gimbalAngle,

      // Restart capability
      restartable,
    };
  });

  // --- Assemble GNC-compatible config ---

  return {
    // Vehicle identity
    name:                 rocket.name || rocket.id || 'Generated Vehicle',

    // Geometry
    diameter:             num(firstStage?.diameter, fairingDiam),
    referenceArea,

    // Payload
    payloadMass,

    // Launch site
    launchLatitude,

    // GNC parameters
    countdownTime:        10,
    kickAngle:            5.0,
    kickAltitude:         300,
    maxQLimit,
    gimbalRateLimit:      firstStageGimbal,
    stageSeparationDelay: 2.0,

    // Stages
    stages,
  };
}


// ---------------------------------------------------------------------------
// bridgeToFlightSim — Backwards-compatible bridge for old FlightSim interface
// ---------------------------------------------------------------------------
// Returns the same shape as stageConfig.js buildStageConfigs(), so the
// existing missionFlow.js code path keeps working during transition.

/**
 * Map generator output + mission data to old FlightSim stage config format.
 *
 * @param {object} rocket  - Output from generateRocket()
 * @param {object} mission - Output from planMission() (from orbitalMechanics.js)
 * @returns {object} { stages: Array, payloadMass: number, fairingDiameter: number }
 */
export function bridgeToFlightSim(rocket, mission) {
  const sel = mission?.selected || {};
  const fairDiam = rocket.fairing?.diameter
    || rocket.fairingDiameter
    || rocket.maxDiameter
    || 3.7;
  const refArea = Math.PI * (fairDiam / 2) ** 2;

  let simStages = [];
  const simSeq = rocket.simulationParams?.stageSequence;
  const rawStages = rocket.stages || [];

  if (simSeq && simSeq.length > 0) {
    // Use simulationParams.stageSequence (already has aggregated thrust)
    simStages = simSeq.map(s => ({
      dryMass:  s.dryMass || 4000,
      propMass: s.propellantMass || s.propMass || 92000,
      thrustSL: s.thrustSL || 0,
      thrustVac: Math.max(s.thrustVac || 0, s.thrustSL || 0),
      ispSL:    Math.max(s.ispSL || 280, 200),
      ispVac:   Math.max(s.ispVac || s.ispSL || 310, 200),
      refArea,
    }));
  } else if (rawStages.length > 0) {
    // Use stages[] with totalThrustSL/Vac or engine * engineCount
    simStages = rawStages.map(s => {
      const nEng = s.engineCount || 1;
      const engine = resolveEngine(s);
      const tSL = s.totalThrustSL || (engine?.thrustSL || 0) * nEng;
      const tVac = s.totalThrustVac || (engine?.thrustVac || 0) * nEng;
      return {
        dryMass:  s.dryMass || 4000,
        propMass: s.propellantMass || 92000,
        thrustSL: tSL,
        thrustVac: Math.max(tVac, tSL),
        ispSL:    Math.max(s.ispSL || engine?.ispSL || 280, 200),
        ispVac:   Math.max(s.ispVac || engine?.ispVac || 310, 200),
        refArea,
      };
    });
  }

  // --- Delta-V validation and scaling (same logic as stageConfig.js) ---

  let totalDV = computeTotalDV(simStages);
  const requiredDV = (sel.deltaVRequired || rocket.mission?.requiredDeltaV || 9400) * 1.05;

  // Scale propellant if delta-V insufficient
  if (totalDV > 0 && totalDV < requiredDV && simStages.length >= 2 && simStages.every(s => s.thrustVac > 1000)) {
    const deficit = requiredDV - totalDV;
    for (const s of simStages) {
      const currentDV = s.ispVac * G0 * Math.log((s.dryMass + s.propMass) / s.dryMass);
      const targetDV = currentDV + deficit * (currentDV / totalDV);
      const oldPropMass = s.propMass;
      const newPropMass = s.dryMass * (Math.exp(targetDV / (s.ispVac * G0)) - 1);
      const propScale = newPropMass / oldPropMass;
      s.propMass = newPropMass;
      if (propScale > 1.5) {
        s.thrustSL *= Math.sqrt(propScale);
        s.thrustVac *= Math.sqrt(propScale);
      }
    }
    totalDV = computeTotalDV(simStages);
  }

  // Ensure stage 1 T/W > 1.2
  if (simStages.length >= 1) {
    const payloadMass = rocket.payload?.mass || rocket.payloadMass || rocket.performance?.payloadToOrbit || 5000;
    const totalMassKg = simStages.reduce((a, s) => a + s.dryMass + s.propMass, 0) + payloadMass;
    const weight = totalMassKg * G0;
    const s1 = simStages[0];
    const tw = s1.thrustSL / weight;
    if (tw < 1.2) {
      const scale = 1.25 / tw;
      s1.thrustSL *= scale;
      s1.thrustVac *= scale;
    }
  }

  // Fallback if rocket is still inadequate
  if (simStages.length < 2 || totalDV < 7000 || simStages.some(s => s.propMass < 100 || s.thrustVac < 1000)) {
    simStages = [
      { dryMass: 22000, propMass: 280000, thrustSL: 7605000, thrustVac: 8415000, ispSL: 282, ispVac: 311, refArea: 10.75 },
      { dryMass: 4000, propMass: 92000, thrustSL: 981000, thrustVac: 981000, ispSL: 348, ispVac: 348, refArea: 10.75 },
    ];
  }

  return {
    stages: simStages,
    payloadMass: rocket.payload?.mass || rocket.payloadMass || rocket.performance?.payloadToOrbit || 5000,
    fairingDiameter: fairDiam,
  };
}

// ---------------------------------------------------------------------------
// Internal: delta-V calculator for the old FlightSim stage format
// ---------------------------------------------------------------------------

function computeTotalDV(stages) {
  let dv = 0;
  for (const s of stages) {
    const wet = s.dryMass + s.propMass;
    dv += s.ispVac * G0 * Math.log(wet / Math.max(s.dryMass, 1));
  }
  return dv;
}
