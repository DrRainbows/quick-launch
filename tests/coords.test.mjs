#!/usr/bin/env node
/**
 * @file tests/coords.test.mjs
 * @description Coordinate round-trip tests using the canonical `src/coords/transforms.js` module.
 */

import { RE } from '../lib/shared/constants.js';
import {
  latLonToScene,
  sceneToLatLon,
  eciToScene,
  sceneToEci,
  launchSiteToEci,
} from '../src/coords/transforms.js';

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function near(a, b, tol, name) {
  assert(name, Math.abs(a - b) <= tol);
}

console.log('=== COORDINATE ROUND-TRIP TESTS ===\n');

const sites = [
  { lat: 28.5, lon: -80.6, label: 'Cape Canaveral' },
  { lat: 5.2, lon: -52.8, label: 'Kourou' },
  { lat: 45.9, lon: 63.3, label: 'Baikonur' },
  { lat: -34.6, lon: -58.4, label: 'Mar del Plata' },
  { lat: 64.0, lon: -21.0, label: 'Iceland' },
  { lat: 0, lon: 0, label: 'Null Island' },
  { lat: 89.5, lon: 135, label: 'Near North Pole' },
  { lat: -77, lon: 166, label: 'Antarctica' },
];

for (const site of sites) {
  const scene = latLonToScene(site.lat, site.lon, 0);
  const back = sceneToLatLon(scene.x, scene.y, scene.z);
  near(back.lat, site.lat, 0.02, `${site.label}: lat round-trip`);
  let dLon = Math.abs(back.lon - site.lon);
  if (dLon > 180) dLon = 360 - dLon;
  assert(`${site.label}: lon round-trip`, dLon <= 0.02);
}

const eci = { x: 6.5e6, y: 1.2e6, z: 2.1e6 };
const scene = eciToScene(eci.x, eci.y, eci.z);
const backEci = sceneToEci(scene.x, scene.y, scene.z);
near(backEci.x, eci.x, 1, 'ECI x round-trip');
near(backEci.y, eci.y, 1, 'ECI y round-trip');
near(backEci.z, eci.z, 1, 'ECI z round-trip');

const launch = launchSiteToEci(28.5, -80.6, 0);
const radius = Math.hypot(launch.pos.x, launch.pos.y, launch.pos.z);
near(radius, RE, 100, 'Launch site radius ≈ RE');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
