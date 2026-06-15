#!/usr/bin/env node
// Flight integration test — generated rocket through full GNC pipeline (Cape Canaveral)

'use strict';

const { generateFlyableRocket, assessOrbit } = require('./lib/missionPipeline.cjs');

const LAT = 28.5;
const LON = -80.6;

console.log('=== FLIGHT INTEGRATION TEST ===');
console.log(`Launch site: ${LAT}°N ${LON}°W\n`);

const t0 = Date.now();
const { rocket, simResult, orbit } = generateFlyableRocket(LAT, LON, 'LEO', { maxAttempts: 120 });
const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

console.log(`Vehicle: ${rocket.designStrategy.architecture}, ${rocket.stageCount} stages, ${(rocket.totalMass/1000).toFixed(0)}t`);
console.log(`dV: ${rocket.validation.totalDeltaV}/${rocket.mission.requiredDeltaV} m/s (valid=${rocket.validation.valid})`);
console.log(`T+${simResult.totalTime.toFixed(0)}s | phase=${orbit.phase}`);
console.log(`Orbit: apo=${orbit.apoAlt.toFixed(0)}km peri=${orbit.periAlt.toFixed(0)}km e=${orbit.ecc.toFixed(4)}`);
console.log(`Wall time: ${elapsed}s\n`);

const pass = assessOrbit(orbit, simResult);
console.log(pass ? '✓ ORBIT ACHIEVED' : '✗ ORBIT NOT ACHIEVED');
process.exit(pass ? 0 : 1);
