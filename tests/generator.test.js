#!/usr/bin/env node
/**
 * @file tests/generator.test.js
 * @description Batch validation: 200 random rockets must pass `validation.valid` ≥ 80%.
 */

'use strict';

const { generateRocket } = require('../lib/rocketGenerator.js');

const SAMPLE_COUNT = 200;
const MIN_VALID_RATE = 0.80;

const latitudes = [-70, -45, -28.5, -10, 0, 10, 28.5, 45, 60, 70];
const orbitClasses = ['LEO', 'SSO'];

const results = { total: 0, valid: 0, errors: 0, issues: [] };

for (let i = 0; i < SAMPLE_COUNT; i++) {
  const lat = latitudes[Math.floor(Math.random() * latitudes.length)];
  const orbitClass = orbitClasses[Math.floor(Math.random() * orbitClasses.length)];
  results.total++;

  try {
    const rocket = generateRocket(lat, orbitClass);
    if (rocket.validation?.valid) {
      results.valid++;
    } else {
      results.issues.push(
        `#${i}: lat=${lat} ${orbitClass} — ${(rocket.validation?.warnings || []).join('; ')}`
      );
    }
  } catch (error) {
    results.errors++;
    results.issues.push(`#${i}: ERROR ${error.message}`);
  }
}

const validRate = results.valid / results.total;
const pass = results.errors === 0 && validRate >= MIN_VALID_RATE;

console.log(`=== ROCKET GENERATOR VALIDATION: ${SAMPLE_COUNT} rockets ===\n`);
console.log(
  `validation.valid: ${results.valid}/${results.total} (${(validRate * 100).toFixed(0)}%)`
);
console.log(`errors: ${results.errors}`);

if (results.issues.length > 0) {
  console.log(`\n=== FAILURES (${results.issues.length}) ===`);
  results.issues.slice(0, 15).forEach((line) => console.log('  ' + line));
  if (results.issues.length > 15) {
    console.log(`  ... and ${results.issues.length - 15} more`);
  }
}

console.log(
  `\n=== VERDICT: ${pass ? 'PASS' : 'FAIL'} (need >=${MIN_VALID_RATE * 100}% valid) ===`
);
process.exit(pass ? 0 : 1);
