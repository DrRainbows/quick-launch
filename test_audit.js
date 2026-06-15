#!/usr/bin/env node
// Full audit runner — headless physics + generator + GNC verification.

const { spawnSync } = require('child_process');
const path = require('path');

const NODE = process.execPath;
const root = __dirname;

const suites = [
  { name: 'Coordinates', file: 'test_coords.mjs' },
  { name: 'Rocket generator (200)', file: 'test_generator.js' },
  { name: 'FlightSim ascent', file: 'test_flightsim.js' },
  { name: 'GNC integration', file: 'test_gnc.js' },
  { name: 'GNC + generated rockets', file: 'test_gnc_generated.js' },
];

console.log('╔══════════════════════════════════════════╗');
console.log('║       LAUNCH GRAMMAR — FULL AUDIT        ║');
console.log('╚══════════════════════════════════════════╝\n');

let allPass = true;

for (const suite of suites) {
  console.log(`── ${suite.name} ──`);
  const result = spawnSync(NODE, [path.join(root, suite.file)], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    allPass = false;
    console.error(`✗ ${suite.name} FAILED (exit ${result.status})\n`);
  } else {
    console.log(`✓ ${suite.name} OK\n`);
  }
}

console.log(allPass ? 'AUDIT: ALL SUITES PASSED' : 'AUDIT: FAILURES DETECTED');
process.exit(allPass ? 0 : 1);
