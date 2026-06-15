/**
 * @module src/adapters/gnc
 * @description ES module facade over `window.OrbitSim` (loaded from `gnc.js`).
 */

const OrbitSim = window.OrbitSim;

if (!OrbitSim) {
  throw new Error('OrbitSim not found on window. Load gnc.js before ES modules.');
}

export const GNCComputer = OrbitSim.GNCComputer;
export const FlightSimulator = OrbitSim.FlightSimulator;
export const FlightPhase = OrbitSim.FlightPhase;
export const createSimulation = OrbitSim.createSimulation;
export const runSimulation = OrbitSim.runSimulation;
export const atmosphereModel = OrbitSim.atmosphereModel;
export const Vec3 = OrbitSim.Vec3;
export const orbitalElements = OrbitSim.orbitalElements;

export default OrbitSim;
