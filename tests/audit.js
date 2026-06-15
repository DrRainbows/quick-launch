#!/usr/bin/env node
/**
 * @file tests/audit.js
 * @description Full audit runner — executes all test suites in sequence.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const NODE = process.execPath;
const root = path.join(__dirname, '..');

const suites = [
  { name: 'Coordinates', file: 'tests/coords.test.mjs' },
  { name: 'Rocket generator (200)', file: 'tests/generator.test.js' },
  { name: 'FlightSim ascent', file: 'tests/flightsim.test.mjs' },
  { name: 'GNC integration', file: 'tests/gnc.test.js' },
  { name: 'GNC + generated rockets', file: 'tests/gnc-generated.test.mjs' },
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
