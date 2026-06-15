/**
 * @module lib/shared/stageConfig
 * @description Maps rocket generator output (`simulationParams.stageSequence`) to
 *   flight-simulation stage configs. Shared by the browser (`src/rocket/stageConfig.js`)
 *   and headless test pipeline (`lib/pipeline/missionPipeline.mjs`).
 *
 * No fallbacks. No scaling hacks. The pattern language must produce a complete,
 * physically valid vehicle before this module is invoked.
 */

import {
  G0,
  MIN_LIFTOFF_TWR,
  STAGE_DV_MARGIN,
} from './constants.js';

/**
 * Fold strap-on boosters into stage 1 for ascent simulation.
 * Approximates parallel burn: booster mass and thrust are added to the core stage.
 * GNC does not model separate SRB separation events yet.
 *
 * @param {Array<object>} simStages - Mutable stage config array
 * @param {object} rocket - Generator output
 */
export function mergeBoostersIntoStage1(simStages, rocket) {
  const boosters = rocket.boosters;
  if (!boosters || !simStages[0]) return;

  const propEach = boosters.propellantMassEach ?? boosters.motor?.propellantMass;
  const dryEach = boosters.dryMassEach ?? boosters.motor?.dryMass;
  if (!propEach || !dryEach) return;

  const stage1 = simStages[0];
  stage1.propMass += propEach * boosters.count;
  stage1.dryMass += dryEach * boosters.count;
  stage1.thrustSL += boosters.totalThrustSL || 0;
  stage1.thrustVac += boosters.totalThrust || boosters.totalThrustSL || 0;
}

/**
 * Compute total delta-V [m/s] for a stage stack (vacuum Isp, bottom-up mass accounting).
 *
 * @param {Array<object>} simStages
 * @param {number} payloadMass [kg]
 * @returns {number}
 */
export function computeStackDeltaV(simStages, payloadMass) {
  let totalDV = 0;
  let massAbove = payloadMass;

  for (let i = simStages.length - 1; i >= 0; i--) {
    const stage = simStages[i];
    const massInitial = stage.dryMass + stage.propMass + massAbove;
    const massFinal = stage.dryMass + massAbove;
    totalDV += stage.ispVac * G0 * Math.log(massInitial / massFinal);
    massAbove += stage.dryMass + stage.propMass;
  }

  return totalDV;
}

/**
 * Build flight-simulation stage configs from generator output.
 *
 * @param {object} rocket - Output from `generateRocket()`
 * @param {object} mission - Output from `planMission()`
 * @returns {{ stages: Array<object>, payloadMass: number, fairingDiameter: number }}
 * @throws {Error} When simulation parameters are missing or physically inadequate
 */
export function buildStageConfigs(rocket, mission) {
  const simSeq = rocket.simulationParams?.stageSequence;
  if (!simSeq?.length) {
    throw new Error(
      'Rocket missing simulationParams.stageSequence — generator did not produce sim data'
    );
  }

  const fairingDiameter = rocket.maxDiameter || rocket.fairing?.diameter || 3.7;
  const referenceArea =
    rocket.simulationParams.referenceArea ||
    Math.PI * (fairingDiameter / 2) ** 2;

  const payloadMass = rocket.payload?.mass;
  if (!payloadMass || payloadMass <= 0) {
    throw new Error('Rocket missing payload mass');
  }

  const simStages = simSeq.map((entry, index) => {
    const dryMass = entry.dryMass;
    const propMass = entry.propellantMass || entry.propMass;
    const thrustVac = entry.thrustVac || 0;
    const thrustSL = entry.thrustSL || thrustVac;

    if (!dryMass || !propMass || thrustVac < 1000) {
      throw new Error(`Stage ${index + 1} incomplete in simulationParams`);
    }

    return {
      dryMass,
      propMass,
      thrustSL,
      thrustVac,
      ispSL: entry.ispSL || entry.ispVac || 280,
      ispVac: entry.ispVac || 310,
      nEngines: rocket.stages?.[index]?.engineCount || 1,
      burnTime: entry.burnTime,
      refArea: referenceArea,
    };
  });

  mergeBoostersIntoStage1(simStages, rocket);

  const requiredDV =
    (mission?.selected?.deltaVRequired || rocket.mission?.requiredDeltaV || 0) *
    STAGE_DV_MARGIN;

  const totalDV = computeStackDeltaV(simStages, payloadMass);
  if (totalDV < requiredDV) {
    throw new Error(
      `Stage configs ΔV ${totalDV.toFixed(0)} m/s below required ${requiredDV.toFixed(0)} m/s`
    );
  }

  const liftoffMass =
    simStages.reduce((sum, stage) => sum + stage.dryMass + stage.propMass, 0) +
    payloadMass;

  const liftoffTWR = simStages[0].thrustSL / (liftoffMass * G0);
  if (liftoffTWR < MIN_LIFTOFF_TWR) {
    throw new Error(
      `Stage 1 T/W ${liftoffTWR.toFixed(2)} < ${MIN_LIFTOFF_TWR} at liftoff`
    );
  }

  return { stages: simStages, payloadMass, fairingDiameter };
}
