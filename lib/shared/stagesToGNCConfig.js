/**
 * @module lib/shared/stagesToGNCConfig
 * @description Converts validated stage configs into the rocket object shape expected
 *   by `GNCComputer` and `FlightSimulator` in `gnc.js`.
 */

/**
 * @param {Array<object>} simStages - Output from `buildStageConfigs().stages`
 * @param {object} rocket - Generator output
 * @param {number} launchLat - Launch site latitude [degrees]
 * @param {object} [_mission] - Mission plan (reserved for future azimuth/target overrides)
 * @returns {object} GNC-compatible rocket configuration
 */
export function stagesToGNCConfig(simStages, rocket, launchLat, _mission) {
  const fairingDiameter = rocket.maxDiameter || rocket.fairing?.diameter || 3.7;
  const pitchProgram = rocket.flightProfile?.pitchProgram || {};

  return {
    name: rocket.id,
    diameter: fairingDiameter,
    referenceArea: rocket.simulationParams.referenceArea,
    payloadMass: rocket.payload.mass,
    launchLatitude: launchLat,
    countdownTime: 10,
    kickAngle: pitchProgram.pitchKickAngle ?? 2.0,
    kickAltitude: 500,
    maxQLimit: 35000,
    gimbalRateLimit: 5.0,
    stageSeparationDelay: 2.0,
    stages: simStages.map((stage, index) => ({
      name: rocket.stages[index]?.designation || `Stage ${index + 1}`,
      dryMass: stage.dryMass,
      propellantMass: stage.propMass,
      thrust: stage.thrustSL,
      thrustVac: stage.thrustVac,
      isp: stage.ispSL,
      ispVac: stage.ispVac,
      burnTime: stage.burnTime,
      nEngines: stage.nEngines,
    })),
  };
}
