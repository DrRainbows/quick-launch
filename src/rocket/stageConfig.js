// ============================================================================
// STAGE CONFIG — Normalize generator output → FlightSim stage configs
// ============================================================================
// The rocket generator outputs various stage formats:
//   - simulationParams.stageSequence (preferred, aggregated thrust)
//   - stages[] with totalThrustSL/Vac or engine × engineCount
// This module normalizes either format into the shape FlightSim expects,
// validates delta-V budget, scales propellant if needed, and checks T/W.

import { G0 } from '../constants.js';

/**
 * Compute total delta-V of a stage array.
 */
function computeTotalDV(stages) {
  let dv = 0;
  for (const s of stages) {
    const wet = s.dryMass + s.propMass;
    dv += s.ispVac * G0 * Math.log(wet / Math.max(s.dryMass, 1));
  }
  return dv;
}

/**
 * Build normalized FlightSim stage configs from generator output.
 *
 * @param {Object} rocket - Full rocket object from generator
 * @param {Object} mission - Mission object (with selected orbit info)
 * @returns {Object} { stages: Array, payloadMass: number, fairingDiameter: number }
 */
export function buildStageConfigs(rocket, mission) {
  const sel = mission?.selected || {};
  const fairDiam = rocket.fairing?.diameter || rocket.fairingDiameter || rocket.maxDiameter || 3.7;
  const refArea = Math.PI * (fairDiam / 2) ** 2;

  let simStages = [];
  const simSeq = rocket.simulationParams?.stageSequence;
  const rawStages = rocket.stages || [];

  if (simSeq && simSeq.length > 0) {
    // Use simulationParams.stageSequence — already has aggregated thrust
    simStages = simSeq.map((s, i) => {
      const rawDry = s.dryMass || 4000;
      const propMass = s.propellantMass || s.propMass || 92000;
      // Cap structural fraction at realistic values (Falcon 9 ~4%, Atlas V ~8%)
      const maxFrac = (i === 0) ? 0.08 : 0.06;
      const actualFrac = rawDry / (rawDry + propMass);
      const dryMass = (actualFrac > maxFrac)
        ? maxFrac * propMass / (1 - maxFrac)
        : rawDry;
      return {
        dryMass,
        propMass,
        thrustSL: s.thrustSL || 0,
        thrustVac: Math.max(s.thrustVac || 0, s.thrustSL || 0),
        ispSL: Math.max(s.ispSL || 280, 200),
        ispVac: Math.max(s.ispVac || s.ispSL || 310, 200),
        nEngines: s.nEngines || 1,
        refArea,
      };
    });
  } else if (rawStages.length > 0) {
    // Use stages[] with totalThrustSL/Vac or engine × engineCount
    simStages = rawStages.map((s, i) => {
      const nEng = s.engineCount || 1;
      const tSL = s.totalThrustSL || (s.engine?.thrustSL || 0) * nEng;
      const tVac = s.totalThrustVac || (s.engine?.thrustVac || 0) * nEng;
      const rawDry = s.dryMass || 4000;
      const propMass = s.propellantMass || 92000;
      // Cap structural fraction at realistic values
      const maxFrac = (i === 0) ? 0.08 : 0.06;
      const actualFrac = rawDry / (rawDry + propMass);
      const dryMass = (actualFrac > maxFrac)
        ? maxFrac * propMass / (1 - maxFrac)
        : rawDry;
      return {
        dryMass,
        propMass,
        thrustSL: tSL,
        thrustVac: Math.max(tVac, tSL),
        ispSL: Math.max(s.ispSL || s.engine?.ispSL || 280, 200),
        ispVac: Math.max(s.ispVac || s.engine?.ispVac || 310, 200),
        nEngines: nEng,
        refArea,
      };
    });
  }

  // Compute total deltaV
  let totalDV = computeTotalDV(simStages);
  const requiredDV = (sel.deltaVRequired || rocket.mission?.requiredDeltaV || 9400) * 1.05; // 5% margin

  console.log(`Generated rocket: ${simStages.length} stages, dV=${totalDV.toFixed(0)}/${requiredDV.toFixed(0)} m/s`);
  simStages.forEach((s, i) => {
    const dv = s.ispVac * G0 * Math.log((s.dryMass + s.propMass) / s.dryMass);
    console.log(`  Stage ${i + 1}: T=${(s.thrustVac / 1000).toFixed(0)}kN, Isp=${s.ispVac.toFixed(0)}s, dV=${dv.toFixed(0)}m/s, prop=${(s.propMass / 1000).toFixed(1)}t`);
  });

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
    console.log(`  Scaled propellant to dV=${totalDV.toFixed(0)} m/s`);
  }

  // Ensure stage 1 T/W > 1.2
  if (simStages.length >= 1) {
    const payloadMass = rocket.payload?.mass || rocket.payloadMass || rocket.performance?.payloadToOrbit || 5000;
    const totalMassKg = simStages.reduce((a, s) => a + s.dryMass + s.propMass, 0) + payloadMass;
    const weight = totalMassKg * 9.81;
    const s1 = simStages[0];
    const tw = s1.thrustSL / weight;
    if (tw < 1.2) {
      const scale = 1.25 / tw;
      s1.thrustSL *= scale;
      s1.thrustVac *= scale;
      console.log(`  Boosted stage 1 thrust by ${scale.toFixed(2)}x for T/W=${(s1.thrustSL / weight).toFixed(2)}`);
    }
  }

  // Fallback if rocket is still inadequate
  if (simStages.length < 2 || totalDV < 7000 || simStages.some(s => s.propMass < 100 || s.thrustVac < 1000)) {
    console.warn('Rocket inadequate after scaling, using fallback');
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
