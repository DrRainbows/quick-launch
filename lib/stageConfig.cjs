'use strict';
// CJS mirror of src/rocket/stageConfig.js — keeps tests on the same path as the browser.

const G0 = 9.80665;

/** Fold strap-on boosters into stage 1 for GNC (parallel burn approximation). */
function mergeBoostersIntoStage1(simStages, rocket) {
  const b = rocket.boosters;
  if (!b || !simStages[0]) return;
  const propEach = b.propellantMassEach ?? b.motor?.propellantMass;
  const dryEach = b.dryMassEach ?? b.motor?.dryMass;
  if (!propEach || !dryEach) return;

  const s0 = simStages[0];
  s0.propMass += propEach * b.count;
  s0.dryMass += dryEach * b.count;
  s0.thrustSL += b.totalThrustSL || 0;
  s0.thrustVac += b.totalThrust || b.totalThrustSL || 0;
}

function buildStageConfigs(rocket, mission) {
  const simSeq = rocket.simulationParams?.stageSequence;
  if (!simSeq || simSeq.length < 1) {
    throw new Error('Rocket missing simulationParams.stageSequence');
  }

  const fairDiam = rocket.maxDiameter || rocket.fairing?.diameter || 3.7;
  const refArea = rocket.simulationParams.referenceArea || Math.PI * (fairDiam / 2) ** 2;
  const payloadMass = rocket.payload?.mass;
  if (!payloadMass || payloadMass <= 0) {
    throw new Error('Rocket missing payload mass');
  }

  const simStages = simSeq.map((s, i) => {
    const dryMass = s.dryMass;
    const propMass = s.propellantMass || s.propMass;
    const thrustVac = s.thrustVac || 0;
    const thrustSL = s.thrustSL || thrustVac;

    if (!dryMass || !propMass || thrustVac < 1000) {
      throw new Error(`Stage ${i + 1} incomplete in simulationParams`);
    }

    return {
      dryMass,
      propMass,
      thrustSL,
      thrustVac,
      ispSL: s.ispSL || s.ispVac || 280,
      ispVac: s.ispVac || 310,
      nEngines: rocket.stages?.[i]?.engineCount || 1,
      burnTime: s.burnTime,
      refArea,
    };
  });

  mergeBoostersIntoStage1(simStages, rocket);

  const requiredDV = (mission?.selected?.deltaVRequired || rocket.mission?.requiredDeltaV || 0) * 1.02;
  let totalDV = 0;
  let massAbove = payloadMass;
  for (let i = simStages.length - 1; i >= 0; i--) {
    const s = simStages[i];
    const m0 = s.dryMass + s.propMass + massAbove;
    const mf = s.dryMass + massAbove;
    totalDV += s.ispVac * G0 * Math.log(m0 / mf);
    massAbove += s.dryMass + s.propMass;
  }

  if (totalDV < requiredDV) {
    throw new Error(`Stage configs dV ${totalDV.toFixed(0)} < required ${requiredDV.toFixed(0)} m/s`);
  }

  const liftoffMass = simStages.reduce((a, s) => a + s.dryMass + s.propMass, 0) + payloadMass;
  const tw = simStages[0].thrustSL / (liftoffMass * G0);
  if (tw < 1.05) {
    throw new Error(`Stage 1 T/W ${tw.toFixed(2)} < 1.05`);
  }

  return { stages: simStages, payloadMass, fairingDiameter: fairDiam };
}

/** Convert stageConfig output → gnc.js FlightSimulator rocket object */
function stagesToGNCConfig(simStages, rocket, launchLat, mission) {
  const fairDiam = rocket.maxDiameter;
  const fp = rocket.flightProfile || {};
  const pitch = fp.pitchProgram || {};

  return {
    name: rocket.id,
    diameter: fairDiam,
    referenceArea: rocket.simulationParams.referenceArea,
    payloadMass: rocket.payload.mass,
    launchLatitude: launchLat,
    countdownTime: 10,
    kickAngle: pitch.pitchKickAngle || 2.0,
    kickAltitude: 500,
    maxQLimit: 35000,
    gimbalRateLimit: 5.0,
    stageSeparationDelay: 2.0,
    stages: simStages.map((s, i) => ({
      name: rocket.stages[i]?.designation || `Stage ${i + 1}`,
      dryMass: s.dryMass,
      propellantMass: s.propMass,
      thrust: s.thrustSL,
      thrustVac: s.thrustVac,
      isp: s.ispSL,
      ispVac: s.ispVac,
      burnTime: s.burnTime,
      nEngines: s.nEngines,
    })),
  };
}

module.exports = { buildStageConfigs, stagesToGNCConfig };
