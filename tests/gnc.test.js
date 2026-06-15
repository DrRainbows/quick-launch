#!/usr/bin/env node
/**
 * @file tests/gnc.test.js
 * @description GNC unit tests: atmosphere, drag, PID, orbital elements, full simulation.
 */

'use strict';

const {
  atmosphereModel,
  dragCoefficient,
  Vec3,
  orbitalElements,
  PIDController,
  FlightPhase,
  CONST,
  runSimulation,
} = require('../gnc.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function approx(a, b, tolerance) {
  return Math.abs(a - b) < tolerance;
}

console.log('\n=== Atmosphere Model ===');

const sea = atmosphereModel(0);
assert(approx(sea.T, 288.15, 0.1), `Sea level T = ${sea.T.toFixed(2)} K (expect 288.15)`);
assert(approx(sea.P, 101325, 1), `Sea level P = ${sea.P.toFixed(0)} Pa (expect 101325)`);
assert(approx(sea.rho, 1.225, 0.01), `Sea level rho = ${sea.rho.toFixed(4)} kg/m³ (expect ~1.225)`);
assert(approx(sea.speedOfSound, 340.3, 1), `Sea level a = ${sea.speedOfSound.toFixed(1)} m/s (expect ~340)`);

const tropopause = atmosphereModel(11000);
assert(approx(tropopause.T, 216.65, 0.5), `11 km T = ${tropopause.T.toFixed(2)} K (expect 216.65)`);
assert(approx(tropopause.P, 22632, 50), `11 km P = ${tropopause.P.toFixed(0)} Pa (expect ~22632)`);

const stratosphere = atmosphereModel(30000);
assert(stratosphere.T > 220 && stratosphere.T < 240, `30 km T = ${stratosphere.T.toFixed(2)} K (expect 220–240)`);
assert(stratosphere.P > 500 && stratosphere.P < 2000, `30 km P = ${stratosphere.P.toFixed(0)} Pa (expect 500–2000)`);

const thermosphere = atmosphereModel(200000);
assert(thermosphere.T > 500 && thermosphere.T < 1200, `200 km T = ${thermosphere.T.toFixed(0)} K (expect 500–1200)`);
assert(thermosphere.rho < 1e-8, `200 km rho = ${thermosphere.rho.toExponential(2)} (expect < 1e-8)`);

const vacuum = atmosphereModel(400000);
assert(vacuum.rho < 1e-11, `400 km rho = ${vacuum.rho.toExponential(2)} (essentially vacuum)`);

console.log('\n=== Drag Coefficient ===');
assert(approx(dragCoefficient(0.5), 0.30, 0.01), `Cd(M=0.5) = ${dragCoefficient(0.5).toFixed(3)} (expect ~0.30)`);
assert(dragCoefficient(1.0) > 0.40, `Cd(M=1.0) = ${dragCoefficient(1.0).toFixed(3)} (expect >0.40)`);
assert(dragCoefficient(2.0) < 0.40, `Cd(M=2.0) = ${dragCoefficient(2.0).toFixed(3)} (expect <0.40)`);
assert(dragCoefficient(5.0) < 0.20, `Cd(M=5.0) = ${dragCoefficient(5.0).toFixed(3)} (expect <0.20)`);

console.log('\n=== Wind Model ===');
const { windModel } = require('../gnc.js');
const windGround = windModel(0, 0);
const windJet = windModel(12000, 0);
assert(
  Vec3.mag(windJet) > Vec3.mag(windGround),
  `Wind at 12 km (${Vec3.mag(windJet).toFixed(1)} m/s) > ground (${Vec3.mag(windGround).toFixed(1)} m/s)`
);
assert(Vec3.mag(windJet) > 30, `Jet stream speed = ${Vec3.mag(windJet).toFixed(1)} m/s (expect >30)`);

console.log('\n=== PID Controller ===');
const pid = new PIDController(1.0, 0.1, 0.5, -10, 10, 50);
let value = 0;
for (let i = 0; i < 100; i++) {
  const error = 1.0 - value;
  const command = pid.update(error, 0.01);
  value += command * 0.01;
}
assert(approx(value, 1.0, 0.1), `PID converges to setpoint: val = ${value.toFixed(4)} (expect ~1.0)`);

console.log('\n=== Orbital Elements ===');
const leoRadius = CONST.R_EARTH + 200000;
const circularVelocity = Math.sqrt(CONST.GM / leoRadius);
const elements = orbitalElements(
  { x: leoRadius, y: 0, z: 0 },
  { x: 0, y: circularVelocity, z: 0 }
);
assert(approx(elements.e, 0, 0.001), `Circular orbit e = ${elements.e.toFixed(5)} (expect ~0)`);
assert(approx(elements.periapsisAlt, 200000, 1000), `Periapsis alt = ${(elements.periapsisAlt / 1000).toFixed(1)} km (expect 200)`);
assert(approx(elements.apoapsisAlt, 200000, 1000), `Apoapsis alt = ${(elements.apoapsisAlt / 1000).toFixed(1)} km (expect 200)`);
assert(approx(elements.period, 5309, 50), `Period = ${elements.period.toFixed(0)} s (expect ~5309)`);

console.log('\n=== Full Simulation (GenericLEO → 200 km orbit) ===');
console.log('    Running... (this may take a few seconds)');

const t0 = Date.now();
const result = runSimulation('GenericLEO', { altitude: 200000, inclination: 28.5 }, {
  maxTime: 3600,
  dt: 0.1,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

console.log(
  `    Completed in ${elapsed}s wall time, ${result.totalTime.toFixed(0)}s flight time, ` +
  `${result.stepCount} steps`
);
console.log(`    Final phase: ${result.telemetry.phase}`);
console.log(`    Apoapsis: ${(result.telemetry.orbitalElements.apoapsisAlt / 1000).toFixed(1)} km`);
console.log(`    Periapsis: ${(result.telemetry.orbitalElements.periapsisAlt / 1000).toFixed(1)} km`);

assert(result.success, 'Simulation achieved orbit');
assert(result.telemetry.phase === FlightPhase.ORBIT_ACHIEVED, 'Final phase is ORBIT_ACHIEVED');
assert(result.telemetry.altitude > 150000, 'Final altitude > 150 km');
assert(result.telemetry.orbitalElements.apoapsisAlt > 150000, 'Apoapsis > 150 km');
assert(result.telemetry.orbitalElements.e < 0.1, 'Eccentricity < 0.1 (reasonable orbit)');
assert(result.trajectory.length > 10, 'Trajectory has sufficient data points');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
