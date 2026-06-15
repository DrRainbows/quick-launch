// ============================================================================
// GNC ADAPTER — ES module adapter for window.OrbitSim (from gnc.js)
// ============================================================================
// gnc.js loads as a classic script and sets window.OrbitSim.
// This adapter re-exports its contents as ES module named exports.

const OrbitSim = window.OrbitSim;

export const GNCComputer     = OrbitSim.GNCComputer;
export const FlightSimulator = OrbitSim.FlightSimulator;
export const FlightPhase     = OrbitSim.FlightPhase;
export const createSimulation = OrbitSim.createSimulation;
export const runSimulation   = OrbitSim.runSimulation;
export const atmosphereModel = OrbitSim.atmosphereModel;
export const Vec3            = OrbitSim.Vec3;
export const orbitalElements = OrbitSim.orbitalElements;
