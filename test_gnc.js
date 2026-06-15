#!/usr/bin/env node
// ============================================================================
// Smoke test for the GNC system — verifies atmospheric model, drag, and
// full simulation convergence to a 200 km LEO orbit.
// ============================================================================

const {
    atmosphereModel,
    dragCoefficient,
    dynamicPressure,
    dragForce,
    windModel,
    Vec3,
    orbitalElements,
    PIDController,
    GNCComputer,
    FlightSimulator,
    FlightPhase,
    RocketConfigs,
    CONST,
    createSimulation,
    runSimulation,
} = require("./gnc.js");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) { passed++; console.log(`  PASS: ${msg}`); }
    else           { failed++; console.error(`  FAIL: ${msg}`); }
}

function approx(a, b, tol) { return Math.abs(a - b) < tol; }

// --- Atmosphere tests -------------------------------------------------------
console.log("\n=== Atmosphere Model ===");

const sea = atmosphereModel(0);
assert(approx(sea.T, 288.15, 0.1),       `Sea level T = ${sea.T.toFixed(2)} K (expect 288.15)`);
assert(approx(sea.P, 101325, 1),          `Sea level P = ${sea.P.toFixed(0)} Pa (expect 101325)`);
assert(approx(sea.rho, 1.225, 0.01),      `Sea level rho = ${sea.rho.toFixed(4)} kg/m^3 (expect ~1.225)`);
assert(approx(sea.speedOfSound, 340.3, 1),`Sea level a = ${sea.speedOfSound.toFixed(1)} m/s (expect ~340)`);

const tropo = atmosphereModel(11000);
assert(approx(tropo.T, 216.65, 0.5),      `11 km T = ${tropo.T.toFixed(2)} K (expect 216.65)`);
assert(approx(tropo.P, 22632, 50),        `11 km P = ${tropo.P.toFixed(0)} Pa (expect ~22632)`);

const strato = atmosphereModel(30000);
assert(strato.T > 220 && strato.T < 240,  `30 km T = ${strato.T.toFixed(2)} K (expect 220-240)`);
assert(strato.P > 500 && strato.P < 2000, `30 km P = ${strato.P.toFixed(0)} Pa (expect 500-2000)`);

const thermo = atmosphereModel(200000);
assert(thermo.T > 500 && thermo.T < 1200,  `200 km T = ${thermo.T.toFixed(0)} K (expect 500-1200)`);
assert(thermo.rho < 1e-8,                  `200 km rho = ${thermo.rho.toExponential(2)} (expect < 1e-8)`);

const space = atmosphereModel(400000);
assert(space.rho < 1e-11,                  `400 km rho = ${space.rho.toExponential(2)} (essentially vacuum)`);

// --- Drag coefficient -------------------------------------------------------
console.log("\n=== Drag Coefficient ===");
assert(approx(dragCoefficient(0.5), 0.30, 0.01), `Cd(M=0.5) = ${dragCoefficient(0.5).toFixed(3)} (expect ~0.30)`);
assert(dragCoefficient(1.0) > 0.40,               `Cd(M=1.0) = ${dragCoefficient(1.0).toFixed(3)} (expect >0.40)`);
assert(dragCoefficient(2.0) < 0.40,               `Cd(M=2.0) = ${dragCoefficient(2.0).toFixed(3)} (expect <0.40)`);
assert(dragCoefficient(5.0) < 0.20,               `Cd(M=5.0) = ${dragCoefficient(5.0).toFixed(3)} (expect <0.20)`);

// --- Wind model -------------------------------------------------------------
console.log("\n=== Wind Model ===");
const w_ground = windModel(0, 0);
const w_jet    = windModel(12000, 0);
assert(Vec3.mag(w_jet) > Vec3.mag(w_ground), `Wind at 12km (${Vec3.mag(w_jet).toFixed(1)} m/s) > ground (${Vec3.mag(w_ground).toFixed(1)} m/s)`);
assert(Vec3.mag(w_jet) > 30,                  `Jet stream speed = ${Vec3.mag(w_jet).toFixed(1)} m/s (expect >30)`);

// --- PID controller ---------------------------------------------------------
console.log("\n=== PID Controller ===");
const pid = new PIDController(1.0, 0.1, 0.5, -10, 10, 50);
let val = 0;
for (let i = 0; i < 100; i++) {
    const err = 1.0 - val;
    const cmd = pid.update(err, 0.01);
    val += cmd * 0.01;
}
assert(approx(val, 1.0, 0.1), `PID converges to setpoint: val = ${val.toFixed(4)} (expect ~1.0)`);

// --- Orbital elements -------------------------------------------------------
console.log("\n=== Orbital Elements ===");
const r_leo = CONST.R_EARTH + 200000;
const v_circ = Math.sqrt(CONST.GM / r_leo);
const elem = orbitalElements(
    { x: r_leo, y: 0, z: 0 },
    { x: 0, y: v_circ, z: 0 }
);
assert(approx(elem.e, 0, 0.001),                       `Circular orbit e = ${elem.e.toFixed(5)} (expect ~0)`);
assert(approx(elem.periapsisAlt, 200000, 1000),         `Periapsis alt = ${(elem.periapsisAlt/1000).toFixed(1)} km (expect 200)`);
assert(approx(elem.apoapsisAlt, 200000, 1000),          `Apoapsis alt = ${(elem.apoapsisAlt/1000).toFixed(1)} km (expect 200)`);
assert(approx(elem.period, 5309, 50),                   `Period = ${elem.period.toFixed(0)} s (expect ~5309)`);

// --- Full Simulation --------------------------------------------------------
console.log("\n=== Full Simulation (GenericLEO -> 200 km orbit) ===");
console.log("    Running... (this may take a few seconds)");

const t0 = Date.now();
const result = runSimulation("GenericLEO", { altitude: 200000, inclination: 28.5 }, {
    maxTime: 3600,
    dt: 0.1,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

console.log(`    Simulation completed in ${elapsed}s wall time, ${result.totalTime.toFixed(0)}s flight time, ${result.stepCount} steps`);
console.log(`    Final phase: ${result.telemetry.phase}`);
console.log(`    Success: ${result.success}`);
console.log(`    Final altitude: ${(result.telemetry.altitude / 1000).toFixed(1)} km`);
console.log(`    Final speed: ${result.telemetry.speed.toFixed(0)} m/s`);
console.log(`    Apoapsis: ${(result.telemetry.orbitalElements.apoapsisAlt / 1000).toFixed(1)} km`);
console.log(`    Periapsis: ${(result.telemetry.orbitalElements.periapsisAlt / 1000).toFixed(1)} km`);
console.log(`    Eccentricity: ${result.telemetry.orbitalElements.e.toFixed(5)}`);
console.log(`    Trajectory points: ${result.trajectory.length}`);

assert(result.success, "Simulation achieved orbit");
assert(result.telemetry.altitude > 150000, `Final altitude > 150 km`);
assert(result.telemetry.orbitalElements.apoapsisAlt > 150000, `Apoapsis > 150 km`);
assert(result.telemetry.orbitalElements.e < 0.1, `Eccentricity < 0.1 (reasonable orbit)`);
assert(result.trajectory.length > 10, `Trajectory has sufficient data points`);

// --- Summary ----------------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
