#!/usr/bin/env node
// Coordinate round-trip tests — mirrors src/coords/transforms.js conventions.

const RE = 6371000;
const OMEGA = 7.2921159e-5;
const EARTH_RADIUS_SCENE = 50;
const SCALE = EARTH_RADIUS_SCENE / RE;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function latLonToScene(latDeg, lonDeg, altMeters) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const r = EARTH_RADIUS_SCENE + altMeters * SCALE;
  const ex = r * Math.cos(lat) * Math.cos(lon);
  const ey = r * Math.cos(lat) * Math.sin(lon);
  const ez = r * Math.sin(lat);
  return { x: ex, y: ez, z: -ey };
}

function sceneToLatLon(sx, sy, sz) {
  const ex = sx;
  const ey = -sz;
  const ez = sy;
  const r = Math.sqrt(ex * ex + ey * ey + ez * ez);
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, ez / r))) * RAD,
    lon: Math.atan2(ey, ex) * RAD,
  };
}

function eciToScene(x, y, z) {
  return { x: x * SCALE, y: z * SCALE, z: -y * SCALE };
}

function sceneToEci(sx, sy, sz) {
  return { x: sx / SCALE, y: -sz / SCALE, z: sy / SCALE };
}

function launchSiteToEci(latDeg, lonDeg, earthRotAngle) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG + earthRotAngle;
  return {
    pos: {
      x: RE * Math.cos(lat) * Math.cos(lon),
      y: RE * Math.cos(lat) * Math.sin(lon),
      z: RE * Math.sin(lat),
    },
    vel: {
      x: -OMEGA * RE * Math.cos(lat) * Math.sin(lon),
      y:  OMEGA * RE * Math.cos(lat) * Math.cos(lon),
      z: 0,
    },
  };
}

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
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
const r = Math.sqrt(launch.pos.x ** 2 + launch.pos.y ** 2 + launch.pos.z ** 2);
near(r, 6371000, 100, 'Launch site radius ≈ RE');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
