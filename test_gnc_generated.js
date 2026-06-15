#!/usr/bin/env node
// Integration test: generated rockets → plan → GNC → orbit at 10 latitudes

'use strict';

const { generateFlyableRocket, assessOrbit } = require('./lib/missionPipeline.cjs');

const TEST_LATITUDES = [0, 5, 15, 28.5, 34.7, 42, 51.6, 58, 64, 72];
const MIN_PASS = 7; // 7/10 — high latitudes are genuinely harder

function pad(s, n) { return (s + ' '.repeat(n)).slice(0, n); }

console.log('=============================================================');
console.log('  GENERATED ROCKET → GNC → ORBIT (no hardcoded vehicles)');
console.log('=============================================================\n');

let passed = 0;
let failed = 0;

for (let i = 0; i < TEST_LATITUDES.length; i++) {
  const lat = TEST_LATITUDES[i];
  const orbitClass = Math.abs(lat) > 60 ? 'SSO' : 'LEO';
  const t0 = Date.now();

  try {
    const { rocket, orbit, simResult } = generateFlyableRocket(lat, 0, orbitClass, { maxAttempts: 100 });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    const ok = assessOrbit(orbit, simResult);

    if (ok) {
      passed++;
      console.log(
        `  [${i + 1}/10] Lat ${pad(lat.toFixed(1), 5)}: PASS  ` +
        `apo=${orbit.apoAlt.toFixed(0)}km peri=${orbit.periAlt.toFixed(0)}km e=${orbit.ecc.toFixed(4)}  ` +
        `(${rocket.stageCount} stg, ${(rocket.totalMass/1000).toFixed(0)}t, dV=${rocket.validation.totalDeltaV}) ${elapsed}s`
      );
    } else {
      failed++;
      console.log(
        `  [${i + 1}/10] Lat ${pad(lat.toFixed(1), 5)}: FAIL  ` +
        `phase=${orbit.phase} apo=${orbit.apoAlt.toFixed(0)}km peri=${orbit.periAlt.toFixed(0)}km e=${orbit.ecc.toFixed(4)} ${elapsed}s`
      );
    }
  } catch (err) {
    failed++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`  [${i + 1}/10] Lat ${pad(lat.toFixed(1), 5)}: FAIL  ${err.message} ${elapsed}s`);
  }
}

console.log('\n=============================================================');
console.log(`  Passed: ${passed}/10 (need >= ${MIN_PASS})`);
console.log('=============================================================\n');

process.exit(passed >= MIN_PASS ? 0 : 1);
