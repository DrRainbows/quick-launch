// =============================================================================
// ORBITAL MECHANICS ENGINE — Full Keplerian + J2 Perturbation Simulator
// =============================================================================
// All units SI: meters, seconds, radians, kg
// Angles stored internally as radians; degree helpers provided.
// =============================================================================

"use strict";

// ---------------------------------------------------------------------------
// SECTION 1 — PHYSICAL CONSTANTS
// ---------------------------------------------------------------------------

const CONST = Object.freeze({
  // Earth
  GM:            3.986004418e14,   // m^3 s^-2  (gravitational parameter)
  RE:            6.371e6,          // m          (mean equatorial radius)
  RE_EQUATORIAL: 6.3781e6,        // m          (WGS-84 equatorial)
  RE_POLAR:      6.3568e6,        // m          (WGS-84 polar)
  FLATTENING:    1 / 298.257223563, // WGS-84 flattening
  J2:            1.08263e-3,       // second zonal harmonic
  OMEGA_EARTH:   7.2921159e-5,    // rad/s      (sidereal rotation rate)

  // Orbit altitude boundaries (meters)
  LEO_MIN:   200e3,
  LEO_MAX:   2000e3,
  MEO_MIN:   2000e3,
  MEO_MAX:   35786e3,
  GEO_ALT:   35786e3,            // geostationary altitude
  GEO_RADIUS: 42164e3,           // from Earth center

  // Sun (simplified model)
  SUN_ANGULAR_RATE: (2 * Math.PI) / (365.25 * 86400), // rad/s

  // Atmospheric scale height for drag model (meters)
  SCALE_HEIGHT: 8500,

  // Surface gravity
  G0: 9.80665,                    // m/s^2
});

// ---------------------------------------------------------------------------
// SECTION 2 — MATH UTILITIES
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function deg2rad(d) { return d * DEG; }
function rad2deg(r) { return r * RAD; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

/** Normalize angle to [0, 2*PI) */
function normalizeAngle(a) {
  a = a % (2 * Math.PI);
  return a < 0 ? a + 2 * Math.PI : a;
}

/** 3-vector operations */
const V3 = {
  create(x, y, z) { return { x, y, z }; },
  add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
  sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
  scale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; },
  dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; },
  cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  },
  mag(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); },
  norm(v) {
    const m = V3.mag(v);
    return m > 0 ? V3.scale(v, 1 / m) : { x: 0, y: 0, z: 0 };
  },
  rotateZ(v, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return {
      x: c * v.x - s * v.y,
      y: s * v.x + c * v.y,
      z: v.z,
    };
  },
  rotateX(v, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return {
      x: v.x,
      y: c * v.y - s * v.z,
      z: s * v.y + c * v.z,
    };
  },
  rotateY(v, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return {
      x:  c * v.x + s * v.z,
      y:  v.y,
      z: -s * v.x + c * v.z,
    };
  },
};

// ---------------------------------------------------------------------------
// SECTION 3 — COORDINATE FRAME TRANSFORMATIONS
// ---------------------------------------------------------------------------

/**
 * Greenwich Mean Sidereal Time (radians) at a given epoch seconds from J2000.
 * Simplified model — sufficient for visualization.
 */
function gmst(secondsSinceJ2000) {
  // At J2000 epoch, GMST ~ 280.46061837 degrees
  const gmst0 = deg2rad(280.46061837);
  return normalizeAngle(gmst0 + CONST.OMEGA_EARTH * secondsSinceJ2000);
}

/**
 * ECI (J2000) -> ECEF.  Pure rotation about Z by -GMST.
 * @param {Object} posECI  {x, y, z} in meters
 * @param {number} time    seconds since J2000 epoch
 * @returns {Object} {x, y, z} in ECEF meters
 */
function eciToEcef(posECI, time) {
  const theta = gmst(time);
  return V3.rotateZ(posECI, -theta);
}

/**
 * ECEF -> ECI.
 */
function ecefToEci(posECEF, time) {
  const theta = gmst(time);
  return V3.rotateZ(posECEF, theta);
}

/**
 * ECEF Cartesian -> Geodetic (lat, lon, alt).
 * Uses iterative Bowring method (converges in 2-3 iterations for all cases).
 * @param {Object} posECEF  {x, y, z} in meters
 * @returns {Object} { lat, lon, alt } — lat/lon in radians, alt in meters
 */
function ecefToGeodetic(posECEF) {
  const { x, y, z } = posECEF;
  const a = CONST.RE_EQUATORIAL;
  const f = CONST.FLATTENING;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const ep2 = (a * a) / (b * b) - 1;

  const p = Math.sqrt(x * x + y * y);
  const lon = Math.atan2(y, x);

  // Initial latitude estimate
  let lat = Math.atan2(z, p * (1 - e2));

  for (let iter = 0; iter < 5; iter++) {
    const sinLat = Math.sin(lat);
    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    lat = Math.atan2(z + e2 * N * sinLat, p);
  }

  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const alt = p / Math.cos(lat) - N;

  return { lat, lon, alt };
}

/**
 * Geodetic -> ECEF.
 * @param {number} lat  radians
 * @param {number} lon  radians
 * @param {number} alt  meters above ellipsoid
 * @returns {Object} {x, y, z} in meters
 */
function geodeticToECEF(lat, lon, alt) {
  const a = CONST.RE_EQUATORIAL;
  const f = CONST.FLATTENING;
  const e2 = 2 * f - f * f;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);

  return {
    x: (N + alt) * cosLat * Math.cos(lon),
    y: (N + alt) * cosLat * Math.sin(lon),
    z: (N * (1 - e2) + alt) * sinLat,
  };
}

/**
 * Perifocal (PQW) frame -> ECI, given orbital elements.
 * P axis points toward periapsis, Q is 90 deg ahead in orbit plane.
 */
function perifocalToECI(pqw, raan, inc, argPeri) {
  // Rotation sequence: R3(-RAAN) * R1(-inc) * R3(-argPeri) * pqw
  let v = V3.rotateZ(pqw, -argPeri);
  v = V3.rotateX(v, -inc);
  v = V3.rotateZ(v, -raan);
  return v;
}

/**
 * Sun direction vector in ECI (simplified circular model).
 * @param {number} time  seconds since J2000
 * @returns {Object} unit vector {x,y,z}
 */
function sunDirectionECI(time) {
  // At J2000, the Sun is approximately along +X in ecliptic
  // Ecliptic obliquity: 23.4393 deg
  const obliquity = deg2rad(23.4393);
  const sunLon = CONST.SUN_ANGULAR_RATE * time; // ecliptic longitude

  // Sun in ecliptic frame
  const sunEcliptic = {
    x: Math.cos(sunLon),
    y: Math.sin(sunLon),
    z: 0,
  };

  // Rotate from ecliptic to equatorial (ECI) by obliquity about X
  return V3.rotateX(sunEcliptic, -obliquity);
}


// ---------------------------------------------------------------------------
// SECTION 4 — ORBITAL ELEMENT COMPUTATIONS
// ---------------------------------------------------------------------------

/**
 * Orbital velocity for a circular orbit at given radius.
 */
function circularVelocity(radius) {
  return Math.sqrt(CONST.GM / radius);
}

/**
 * Orbital period.
 */
function orbitalPeriod(semiMajorAxis) {
  return 2 * Math.PI * Math.sqrt(
    (semiMajorAxis * semiMajorAxis * semiMajorAxis) / CONST.GM
  );
}

/**
 * Mean motion (rad/s).
 */
function meanMotion(semiMajorAxis) {
  return Math.sqrt(CONST.GM / (semiMajorAxis * semiMajorAxis * semiMajorAxis));
}

/**
 * Compute full classical orbital elements for a target orbit.
 *
 * @param {string} orbitType   "LEO"|"SSO"|"MEO"|"GTO"|"GEO"|"POLAR"|"MOLNIYA"|"CUSTOM"
 * @param {number} altitude    target altitude in meters (for circular; apogee for elliptical)
 * @param {number} inclination radians (ignored for types that fix it, like SSO/GEO)
 * @param {Object} [opts]      optional overrides
 * @returns {Object} Classical elements:
 *   { a, e, i, raan, argPeri, trueAnomaly, epoch,
 *     altPerigee, altApogee, period, name }
 */
function computeOrbitalElements(orbitType, altitude, inclination, opts = {}) {
  let a, e, i, raan, argPeri, trueAnomaly;

  // Defaults
  raan = opts.raan !== undefined ? opts.raan : 0;
  argPeri = opts.argPeri !== undefined ? opts.argPeri : 0;
  trueAnomaly = opts.trueAnomaly !== undefined ? opts.trueAnomaly : 0;

  const r = CONST.RE + altitude;

  switch (orbitType) {
    case "LEO": {
      a = r;
      e = opts.eccentricity || 0;
      i = inclination;
      break;
    }

    case "SSO": {
      // Sun-synchronous: compute required inclination from altitude
      a = r;
      e = opts.eccentricity || 0;
      const n = meanMotion(a);
      // Required precession: 360 deg / year = 2*PI / (365.25*86400) rad/s
      const targetPrecession = 2 * Math.PI / (365.25 * 86400);
      // RAAN precession: dOmega/dt = -1.5 * n * J2 * (Re/a)^2 * cos(i)
      // Solve for cos(i):
      const cosI = -targetPrecession /
        (1.5 * n * CONST.J2 * Math.pow(CONST.RE / a, 2));
      i = Math.acos(clamp(cosI, -1, 1));
      break;
    }

    case "MEO": {
      a = r;
      e = opts.eccentricity || 0;
      i = inclination || deg2rad(55); // GPS-like default
      break;
    }

    case "GTO": {
      // Geostationary Transfer Orbit: perigee at parking orbit, apogee at GEO
      const rPerigee = opts.perigeeAlt
        ? CONST.RE + opts.perigeeAlt
        : CONST.RE + 200e3;
      const rApogee = CONST.RE + CONST.GEO_ALT;
      a = (rPerigee + rApogee) / 2;
      e = (rApogee - rPerigee) / (rApogee + rPerigee);
      i = inclination || deg2rad(28.5); // Cape Canaveral typical
      argPeri = opts.argPeri !== undefined ? opts.argPeri : deg2rad(180);
      break;
    }

    case "GEO": {
      a = CONST.GEO_RADIUS;
      e = 0;
      i = 0;
      break;
    }

    case "POLAR": {
      a = r;
      e = opts.eccentricity || 0;
      i = deg2rad(90);
      break;
    }

    case "MOLNIYA": {
      // Classic Molniya: 500 km x 40000 km, i=63.4 deg (critical inclination)
      const rPeri = CONST.RE + (opts.perigeeAlt || 500e3);
      const rApo  = CONST.RE + (opts.apogeeAlt || 40000e3);
      a = (rPeri + rApo) / 2;
      e = (rApo - rPeri) / (rApo + rPeri);
      i = deg2rad(63.4); // critical inclination — no apsidal precession
      argPeri = opts.argPeri !== undefined ? opts.argPeri : deg2rad(270);
      break;
    }

    case "CUSTOM": {
      a = opts.semiMajorAxis || r;
      e = opts.eccentricity || 0;
      i = inclination || 0;
      break;
    }

    default:
      throw new Error(`Unknown orbit type: ${orbitType}`);
  }

  const period = orbitalPeriod(a);
  const altPerigee = a * (1 - e) - CONST.RE;
  const altApogee  = a * (1 + e) - CONST.RE;

  return {
    a, e, i, raan, argPeri, trueAnomaly,
    epoch: opts.epoch || 0,
    altPerigee, altApogee, period,
    type: orbitType,
    name: opts.name || orbitType,
  };
}


// ---------------------------------------------------------------------------
// SECTION 5 — LAUNCH GEOMETRY
// ---------------------------------------------------------------------------

/**
 * Earth surface rotational velocity at a given latitude (m/s, eastward).
 */
function launchSiteVelocity(latitude) {
  return CONST.OMEGA_EARTH * CONST.RE_EQUATORIAL * Math.cos(latitude);
}

/**
 * Launch azimuth for a desired orbital inclination from a given latitude.
 * Returns azimuth in radians measured clockwise from north.
 *
 * Two solutions exist (ascending / descending node pass).
 * We return the one that benefits from Earth rotation (ascending, eastward).
 *
 * The spherical trig relation: cos(i) = cos(lat) * sin(azimuth)
 * => sin(azimuth) = cos(i) / cos(lat)
 *
 * Inclination must be >= |latitude| for a direct (non-dogleg) launch.
 */
function launchAzimuth(latitude, inclination) {
  const cosLat = Math.cos(latitude);
  if (cosLat < 1e-12) {
    // Polar launch site — any azimuth gives ~90 deg inclination
    return 0;
  }

  let sinAz = Math.cos(inclination) / cosLat;
  sinAz = clamp(sinAz, -1, 1);

  // Ascending node pass (launch eastward for rotation benefit)
  const azimuth = Math.asin(sinAz);
  return azimuth; // 0 = due north, PI/2 = due east
}

/**
 * Inertial launch velocity vector in ECI, given launch site and azimuth.
 */
function launchVelocityECI(lat, lon, azimuth, time) {
  // Surface velocity due to Earth rotation
  const vRot = launchSiteVelocity(lat);

  // In local ENU (East-North-Up) frame, azimuth is clockwise from north:
  const vEast  = vRot + 0; // rotation is purely eastward
  const vNorth = 0;

  // Desired launch direction in ENU
  const launchDirE = Math.sin(azimuth);
  const launchDirN = Math.cos(azimuth);

  // Convert ENU to ECEF then to ECI at the launch site
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);

  // ENU to ECEF rotation
  // East:  [-sinLon,  cosLon, 0]
  // North: [-sinLat*cosLon, -sinLat*sinLon, cosLat]
  // Up:    [ cosLat*cosLon,  cosLat*sinLon, sinLat]

  return {
    eastDir: {
      x: -sinLon,
      y:  cosLon,
      z:  0,
    },
    northDir: {
      x: -sinLat * cosLon,
      y: -sinLat * sinLon,
      z:  cosLat,
    },
    upDir: {
      x: cosLat * cosLon,
      y: cosLat * sinLon,
      z: sinLat,
    },
    rotationVelocity: vRot,
  };
}


// ---------------------------------------------------------------------------
// SECTION 6 — DELTA-V BUDGET
// ---------------------------------------------------------------------------

/**
 * Compute the full delta-v budget for reaching a target orbit.
 *
 * @param {string} orbitType
 * @param {number} launchLat     radians
 * @param {number} altitude      target altitude (meters)
 * @param {number} inclination   radians
 * @returns {Object} budget breakdown in m/s
 */
function computeDeltaVBudget(orbitType, launchLat, altitude, inclination) {
  const r = CONST.RE + altitude;
  const vOrbit = circularVelocity(r);

  // Earth rotation benefit (negative means it helps)
  const azimuth = launchAzimuth(launchLat, inclination);
  const vRotation = launchSiteVelocity(launchLat);
  const vRotBenefit = vRotation * Math.sin(azimuth); // eastward component along launch azimuth

  // --- Loss estimates (altitude-dependent) ---
  // Gravity losses scale with burn time, which increases with altitude
  const altKm = altitude / 1000;
  const gravityLoss = lerp(1300, 1800, clamp((altKm - 200) / 1800, 0, 1));

  // Drag losses decrease at higher altitudes (longer coast through thin atmo)
  const dragLoss = lerp(150, 400, clamp(1 - (altKm - 200) / 800, 0, 1));

  // Steering losses
  const steeringLoss = lerp(80, 200, clamp((altKm - 200) / 2000, 0, 1));

  let circularization = 0;
  let planeChange = 0;
  let transferBurn = 0;

  switch (orbitType) {
    case "LEO":
    case "SSO":
    case "POLAR": {
      // Direct insertion; circularization is part of the orbital velocity
      circularization = 0;
      break;
    }

    case "GTO": {
      // Parking orbit at 200 km, then Hohmann to GEO apogee
      const rPark = CONST.RE + 200e3;
      const rApogee = CONST.RE + CONST.GEO_ALT;
      const vPark = circularVelocity(rPark);
      const aTransfer = (rPark + rApogee) / 2;
      const vTransferPeri = Math.sqrt(CONST.GM * (2 / rPark - 1 / aTransfer));
      transferBurn = vTransferPeri - vPark;
      break;
    }

    case "GEO": {
      // Full transfer: parking -> GTO -> GEO circularization + plane change
      const rPark = CONST.RE + 200e3;
      const rGEO = CONST.GEO_RADIUS;
      const vPark = circularVelocity(rPark);
      const aTransfer = (rPark + rGEO) / 2;
      const vTransferPeri = Math.sqrt(CONST.GM * (2 / rPark - 1 / aTransfer));
      const vTransferApo  = Math.sqrt(CONST.GM * (2 / rGEO - 1 / aTransfer));
      const vGEO = circularVelocity(rGEO);

      transferBurn = vTransferPeri - vPark;
      // Combined plane change + circularization at apogee (most efficient)
      const dv_circ_and_plane = Math.sqrt(
        vTransferApo * vTransferApo + vGEO * vGEO -
        2 * vTransferApo * vGEO * Math.cos(Math.abs(inclination))
      );
      circularization = dv_circ_and_plane;
      break;
    }

    case "MEO": {
      // Hohmann from parking orbit
      const rPark = CONST.RE + 200e3;
      const vPark = circularVelocity(rPark);
      const aTransfer = (rPark + r) / 2;
      const vTransferPeri = Math.sqrt(CONST.GM * (2 / rPark - 1 / aTransfer));
      const vTransferApo  = Math.sqrt(CONST.GM * (2 / r - 1 / aTransfer));
      const vTarget = circularVelocity(r);
      transferBurn = vTransferPeri - vPark;
      circularization = vTarget - vTransferApo;
      break;
    }

    case "MOLNIYA": {
      // Parking orbit, then raise apogee
      const rPark = CONST.RE + 200e3;
      const vPark = circularVelocity(rPark);
      const rPeri = CONST.RE + 500e3;
      const rApo  = CONST.RE + 40000e3;
      const aMol = (rPeri + rApo) / 2;
      const vMolPeri = Math.sqrt(CONST.GM * (2 / rPeri - 1 / aMol));
      transferBurn = vMolPeri - vPark;
      // Plane change to 63.4 deg if launch latitude differs
      planeChange = vPark * 2 * Math.sin(
        Math.abs(deg2rad(63.4) - Math.abs(launchLat)) / 2
      );
      break;
    }

    default: break;
  }

  // Ideal delta-v to reach parking orbit (or direct insertion for LEO)
  let idealOrbitalDv;
  if (orbitType === "LEO" || orbitType === "SSO" || orbitType === "POLAR") {
    idealOrbitalDv = vOrbit;
  } else {
    // For transfer orbits, the "ideal" part is just reaching parking orbit
    idealOrbitalDv = circularVelocity(CONST.RE + 200e3);
  }

  const total = idealOrbitalDv - vRotBenefit + gravityLoss + dragLoss +
                steeringLoss + circularization + transferBurn + planeChange;

  return {
    idealOrbitalVelocity: idealOrbitalDv,
    earthRotationBenefit: vRotBenefit,
    gravityLoss,
    dragLoss,
    steeringLoss,
    circularization,
    transferBurn,
    planeChange,
    total,
    // Additional useful info
    orbitalVelocityAtTarget: vOrbit,
    launchAzimuth: azimuth,
    launchAzimuthDeg: rad2deg(azimuth),
  };
}


// ---------------------------------------------------------------------------
// SECTION 7 — ACHIEVABLE ORBITS & ORBIT SELECTION
// ---------------------------------------------------------------------------

/**
 * Determine which orbit types are achievable given total delta-v capacity
 * and launch site geometry.
 *
 * @param {number} totalDeltaV     m/s available
 * @param {number} launchLatitude  radians
 * @param {number} launchLongitude radians
 * @returns {Array} achievable orbits with metadata
 */
function getAchievableOrbits(totalDeltaV, launchLatitude, launchLongitude) {
  const results = [];
  const latDeg = rad2deg(Math.abs(launchLatitude));

  // Helper: test a specific orbit configuration
  function testOrbit(type, altitude, inclination, name, priority) {
    const budget = computeDeltaVBudget(type, launchLatitude, altitude, inclination);
    const margin = totalDeltaV - budget.total;
    if (margin >= -50) { // allow 50 m/s margin for rounding
      results.push({
        type,
        altitude,
        inclination,
        inclinationDeg: rad2deg(inclination),
        name: name || type,
        deltaVRequired: budget.total,
        deltaVMargin: margin,
        budget,
        priority, // lower = more interesting/desirable
        achievable: margin >= 0,
      });
    }
  }

  // --- LEO family ---
  // Minimum energy LEO at launch latitude
  const minInc = Math.abs(launchLatitude);
  testOrbit("LEO", 200e3, minInc, "LEO 200km (min energy)", 50);
  testOrbit("LEO", 400e3, minInc, "LEO 400km (ISS-like)", 40);
  testOrbit("LEO", 550e3, minInc, "LEO 550km (Hubble-like)", 35);
  testOrbit("LEO", 800e3, minInc, "LEO 800km", 45);
  testOrbit("LEO", 1200e3, minInc, "LEO 1200km", 48);

  // --- SSO ---
  for (const alt of [400e3, 550e3, 700e3, 800e3]) {
    const ssoElems = computeOrbitalElements("SSO", alt, 0);
    testOrbit("SSO", alt, ssoElems.i,
      `SSO ${alt/1000}km (i=${rad2deg(ssoElems.i).toFixed(1)}deg)`, 25);
  }

  // --- Polar ---
  testOrbit("POLAR", 500e3, deg2rad(90), "Polar 500km", 30);
  testOrbit("POLAR", 800e3, deg2rad(90), "Polar 800km", 32);

  // --- MEO ---
  testOrbit("MEO", 20200e3, deg2rad(55), "MEO GPS-like (20200km)", 15);
  testOrbit("MEO", 23222e3, deg2rad(56), "MEO Galileo-like (23222km)", 18);

  // --- GTO ---
  testOrbit("GTO", CONST.GEO_ALT, minInc, "GTO (200km x GEO)", 10);

  // --- GEO ---
  testOrbit("GEO", CONST.GEO_ALT, minInc, "GEO (full circularization)", 5);

  // --- Molniya ---
  testOrbit("MOLNIYA", 40000e3, deg2rad(63.4), "Molniya (500x40000km)", 8);

  // Sort by priority (lower = more interesting)
  results.sort((a, b) => a.priority - b.priority);

  return results;
}

/**
 * Select the most dramatic/interesting achievable orbit.
 *
 * Philosophy: We prefer the most impressive orbit the rocket can reach.
 * GEO > Molniya > GTO > MEO > SSO > Polar > LEO, with nuance for margin.
 *
 * @param {Array} achievableOrbits from getAchievableOrbits()
 * @param {Object} rocketCapability { totalDeltaV, payloadMass }
 * @returns {Object} selected orbit
 */
function selectOrbit(achievableOrbits, rocketCapability) {
  // Filter to only truly achievable (positive margin)
  const viable = achievableOrbits.filter(o => o.achievable);

  if (viable.length === 0) {
    // Nothing achievable — return the closest miss
    const sorted = [...achievableOrbits].sort(
      (a, b) => Math.abs(a.deltaVMargin) - Math.abs(b.deltaVMargin)
    );
    return sorted[0] || null;
  }

  // Weight: priority (lower is better) gets preference,
  // but penalize orbits with very thin margins (< 200 m/s)
  const scored = viable.map(o => {
    let score = 100 - o.priority; // Higher score = more desirable
    // Bonus for comfortable margins
    if (o.deltaVMargin > 500) score += 10;
    else if (o.deltaVMargin > 200) score += 5;
    else if (o.deltaVMargin < 100) score -= 15; // penalize razor-thin margin
    return { ...o, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}


// ---------------------------------------------------------------------------
// SECTION 8 — KEPLER EQUATION SOLVER & ORBIT PROPAGATION
// ---------------------------------------------------------------------------

/**
 * Solve Kepler's equation M = E - e*sin(E) for eccentric anomaly E.
 * Uses Newton-Raphson iteration.
 *
 * @param {number} M  mean anomaly (radians)
 * @param {number} e  eccentricity
 * @returns {number} eccentric anomaly E (radians)
 */
function solveKepler(M, e) {
  M = normalizeAngle(M);
  let E = M; // initial guess

  for (let iter = 0; iter < 30; iter++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Eccentric anomaly -> true anomaly.
 */
function eccentricToTrue(E, e) {
  return 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2)
  );
}

/**
 * True anomaly -> eccentric anomaly.
 */
function trueToEccentric(nu, e) {
  return 2 * Math.atan2(
    Math.sqrt(1 - e) * Math.sin(nu / 2),
    Math.sqrt(1 + e) * Math.cos(nu / 2)
  );
}

/**
 * Propagate Keplerian orbit with J2 secular perturbations.
 *
 * J2 causes three secular effects:
 *   1. RAAN precession:    dΩ/dt = -1.5 * n * J2 * (Re/p)^2 * cos(i)
 *   2. Argument of perigee precession: dω/dt = 1.5*n*J2*(Re/p)^2*(2 - 2.5*sin^2(i))
 *   3. Mean anomaly drift: dM/dt adjusted slightly
 *
 * @param {Object} elements  orbital elements (from computeOrbitalElements)
 * @param {number} dt        time step in seconds from epoch
 * @returns {Object} propagated state { position, velocity, elements, trueAnomaly }
 *   position/velocity in ECI (meters, m/s)
 */
function propagateOrbit(elements, dt) {
  const { a, e, i, epoch } = elements;
  let { raan, argPeri, trueAnomaly } = elements;

  const n = meanMotion(a);  // mean motion
  const p = a * (1 - e * e); // semi-latus rectum

  // --- J2 secular perturbations ---
  const reOverP2 = Math.pow(CONST.RE / p, 2);
  const sinI = Math.sin(i);
  const cosI = Math.cos(i);

  // RAAN precession (negative = regresses for prograde orbits)
  const dRaanDt = -1.5 * n * CONST.J2 * reOverP2 * cosI;

  // Argument of perigee precession
  const dArgPeriDt = 1.5 * n * CONST.J2 * reOverP2 * (2 - 2.5 * sinI * sinI);

  // Mean anomaly includes J2 correction
  const dMDt = n * (1 + 1.5 * CONST.J2 * reOverP2 * Math.sqrt(1 - e * e) *
    (1 - 1.5 * sinI * sinI));

  // Apply perturbations
  const newRaan = normalizeAngle(raan + dRaanDt * dt);
  const newArgPeri = normalizeAngle(argPeri + dArgPeriDt * dt);

  // Compute mean anomaly at epoch from current true anomaly
  const E0 = trueToEccentric(trueAnomaly, e);
  const M0 = E0 - e * Math.sin(E0);

  // Propagate mean anomaly
  const M = normalizeAngle(M0 + dMDt * dt);

  // Solve Kepler's equation
  const E = solveKepler(M, e);
  const newTrueAnomaly = eccentricToTrue(E, e);

  // --- Position and velocity in perifocal frame ---
  const r = p / (1 + e * Math.cos(newTrueAnomaly));

  const posPQW = {
    x: r * Math.cos(newTrueAnomaly),
    y: r * Math.sin(newTrueAnomaly),
    z: 0,
  };

  const velFactor = Math.sqrt(CONST.GM / p);
  const velPQW = {
    x: -velFactor * Math.sin(newTrueAnomaly),
    y:  velFactor * (e + Math.cos(newTrueAnomaly)),
    z:  0,
  };

  // --- Transform to ECI ---
  const posECI = perifocalToECI(posPQW, newRaan, i, newArgPeri);
  const velECI = perifocalToECI(velPQW, newRaan, i, newArgPeri);

  return {
    position: posECI,
    velocity: velECI,
    radius: r,
    speed: V3.mag(velECI),
    trueAnomaly: newTrueAnomaly,
    elements: {
      ...elements,
      raan: newRaan,
      argPeri: newArgPeri,
      trueAnomaly: newTrueAnomaly,
    },
    time: epoch + dt,
  };
}


// ---------------------------------------------------------------------------
// SECTION 9 — STATE VECTOR <-> ORBITAL ELEMENTS CONVERSION
// ---------------------------------------------------------------------------

/**
 * Convert ECI state vector (position, velocity) to classical orbital elements.
 *
 * @param {Object} pos  {x,y,z} ECI position in meters
 * @param {Object} vel  {x,y,z} ECI velocity in m/s
 * @returns {Object} classical orbital elements
 */
function stateToElements(pos, vel) {
  const r = V3.mag(pos);
  const v = V3.mag(vel);

  // Specific angular momentum
  const h = V3.cross(pos, vel);
  const hMag = V3.mag(h);

  // Node vector (Z x h)
  const n = V3.cross({ x: 0, y: 0, z: 1 }, h);
  const nMag = V3.mag(n);

  // Eccentricity vector
  const eVec = V3.sub(
    V3.scale(pos, (v * v - CONST.GM / r)),
    V3.scale(vel, V3.dot(pos, vel))
  );
  const eVecScaled = V3.scale(eVec, 1 / CONST.GM);
  const e = V3.mag(eVecScaled);

  // Semi-latus rectum and semi-major axis
  const p = hMag * hMag / CONST.GM;
  const a = p / (1 - e * e);

  // Inclination
  const i = Math.acos(clamp(h.z / hMag, -1, 1));

  // RAAN
  let raan = 0;
  if (nMag > 1e-10) {
    raan = Math.acos(clamp(n.x / nMag, -1, 1));
    if (n.y < 0) raan = 2 * Math.PI - raan;
  }

  // Argument of perigee
  let argPeri = 0;
  if (nMag > 1e-10 && e > 1e-10) {
    argPeri = Math.acos(clamp(V3.dot(n, eVecScaled) / (nMag * e), -1, 1));
    if (eVecScaled.z < 0) argPeri = 2 * Math.PI - argPeri;
  }

  // True anomaly
  let trueAnomaly = 0;
  if (e > 1e-10) {
    trueAnomaly = Math.acos(clamp(V3.dot(eVecScaled, pos) / (e * r), -1, 1));
    if (V3.dot(pos, vel) < 0) trueAnomaly = 2 * Math.PI - trueAnomaly;
  }

  return {
    a, e, i, raan, argPeri, trueAnomaly,
    period: orbitalPeriod(a),
    altPerigee: a * (1 - e) - CONST.RE,
    altApogee:  a * (1 + e) - CONST.RE,
  };
}

/**
 * Convert orbital elements to ECI state vector.
 * (Convenience wrapper around propagateOrbit at dt=0)
 */
function elementsToState(elements) {
  return propagateOrbit(elements, 0);
}


// ---------------------------------------------------------------------------
// SECTION 10 — VISUALIZATION HELPERS
// ---------------------------------------------------------------------------

/**
 * Generate a complete orbit trace (array of ECI points) for one full period.
 *
 * @param {Object} elements    orbital elements
 * @param {number} [numPoints] number of points along the orbit (default 360)
 * @param {number} [numOrbits] number of orbits to trace (default 1)
 * @returns {Array<Object>} array of { position, velocity, time, lat, lon, alt }
 */
function generateOrbitTrace(elements, numPoints = 360, numOrbits = 1) {
  const period = elements.period;
  const totalTime = period * numOrbits;
  const dt = totalTime / numPoints;
  const points = [];

  for (let step = 0; step <= numPoints; step++) {
    const t = step * dt;
    const state = propagateOrbit(elements, t);
    const ecef = eciToEcef(state.position, elements.epoch + t);
    const geo = ecefToGeodetic(ecef);

    points.push({
      position: state.position,   // ECI {x,y,z} meters
      velocity: state.velocity,   // ECI {x,y,z} m/s
      time: t,
      lat: rad2deg(geo.lat),
      lon: rad2deg(geo.lon),
      alt: geo.alt,
      radius: state.radius,
      speed: state.speed,
      trueAnomaly: state.trueAnomaly,
    });
  }

  return points;
}

/**
 * Generate a ground track (lat/lon path) for a given number of orbits.
 *
 * @param {Object} elements
 * @param {number} numOrbits
 * @param {number} pointsPerOrbit
 * @returns {Array<Object>} array of { lat, lon } in degrees
 */
function generateGroundTrack(elements, numOrbits = 3, pointsPerOrbit = 360) {
  const totalPoints = numOrbits * pointsPerOrbit;
  const trace = generateOrbitTrace(elements, totalPoints, numOrbits);
  return trace.map(p => ({ lat: p.lat, lon: p.lon, alt: p.alt, time: p.time }));
}

/**
 * Generate the orbit ellipse in the perifocal (PQW) frame.
 * Useful for 2D orbit shape visualization.
 *
 * @param {Object} elements
 * @param {number} numPoints
 * @returns {Array<Object>} array of {x, y} in meters (perifocal frame)
 */
function generateOrbitEllipsePQW(elements, numPoints = 360) {
  const { a, e } = elements;
  const p = a * (1 - e * e);
  const points = [];

  for (let step = 0; step <= numPoints; step++) {
    const nu = (step / numPoints) * 2 * Math.PI;
    const r = p / (1 + e * Math.cos(nu));
    points.push({
      x: r * Math.cos(nu),
      y: r * Math.sin(nu),
    });
  }

  return points;
}

/**
 * Generate visibility windows — when the satellite is above a minimum
 * elevation from a ground station.
 *
 * @param {Object} elements
 * @param {number} stationLat   radians
 * @param {number} stationLon   radians
 * @param {number} stationAlt   meters
 * @param {number} minElevation radians (e.g. deg2rad(10) for 10 deg)
 * @param {number} duration     seconds to search
 * @param {number} stepSize     seconds between checks
 * @returns {Array<Object>} visibility windows { startTime, endTime, maxElevation }
 */
function computeVisibilityWindows(
  elements, stationLat, stationLon, stationAlt,
  minElevation = deg2rad(10), duration = 86400, stepSize = 30
) {
  const stationECEF = geodeticToECEF(stationLat, stationLon, stationAlt);
  const windows = [];
  let inView = false;
  let windowStart = 0;
  let maxElev = 0;

  for (let t = 0; t <= duration; t += stepSize) {
    const state = propagateOrbit(elements, t);
    const satECEF = eciToEcef(state.position, elements.epoch + t);
    const diff = V3.sub(satECEF, stationECEF);
    const range = V3.mag(diff);

    // Compute elevation angle
    // Station "up" direction in ECEF is approximately the normalized station position
    const stationUp = V3.norm(stationECEF);
    const sinElev = V3.dot(diff, stationUp) / range;
    const elev = Math.asin(clamp(sinElev, -1, 1));

    if (elev >= minElevation) {
      if (!inView) {
        windowStart = t;
        maxElev = elev;
        inView = true;
      }
      if (elev > maxElev) maxElev = elev;
    } else if (inView) {
      windows.push({
        startTime: windowStart,
        endTime: t,
        duration: t - windowStart,
        maxElevation: rad2deg(maxElev),
      });
      inView = false;
    }
  }

  // Close any open window
  if (inView) {
    windows.push({
      startTime: windowStart,
      endTime: duration,
      duration: duration - windowStart,
      maxElevation: rad2deg(maxElev),
    });
  }

  return windows;
}


// ---------------------------------------------------------------------------
// SECTION 11 — HOHMANN TRANSFER CALCULATOR
// ---------------------------------------------------------------------------

/**
 * Compute a Hohmann transfer between two circular orbits.
 *
 * @param {number} r1  radius of initial orbit (meters from Earth center)
 * @param {number} r2  radius of target orbit (meters from Earth center)
 * @returns {Object} transfer parameters
 */
function hohmannTransfer(r1, r2) {
  const v1 = circularVelocity(r1);
  const v2 = circularVelocity(r2);
  const aTransfer = (r1 + r2) / 2;

  const vTransfer1 = Math.sqrt(CONST.GM * (2 / r1 - 1 / aTransfer));
  const vTransfer2 = Math.sqrt(CONST.GM * (2 / r2 - 1 / aTransfer));

  const dv1 = Math.abs(vTransfer1 - v1);
  const dv2 = Math.abs(v2 - vTransfer2);

  return {
    dv1,           // burn at departure orbit
    dv2,           // burn at arrival orbit
    dvTotal: dv1 + dv2,
    transferTime: Math.PI * Math.sqrt(aTransfer * aTransfer * aTransfer / CONST.GM),
    aTransfer,
    v1, v2,
    vTransfer1, vTransfer2,
  };
}


// ---------------------------------------------------------------------------
// SECTION 12 — ECLIPSE / SHADOW COMPUTATION
// ---------------------------------------------------------------------------

/**
 * Determine if a satellite is in Earth's shadow (cylindrical shadow model).
 *
 * @param {Object} satPosECI  satellite ECI position
 * @param {number} time       seconds since J2000
 * @returns {boolean} true if in shadow
 */
function isInShadow(satPosECI, time) {
  const sunDir = sunDirectionECI(time);
  const satR = V3.mag(satPosECI);

  // Project satellite position onto sun direction
  const sunDot = V3.dot(satPosECI, sunDir);

  // If satellite is on the sun-side of Earth, it's illuminated
  if (sunDot > 0) return false;

  // Distance from Earth-Sun line
  const perpendicular = V3.sub(satPosECI, V3.scale(sunDir, sunDot));
  const perpDist = V3.mag(perpendicular);

  // In shadow if perpendicular distance is less than Earth radius
  return perpDist < CONST.RE;
}


// ---------------------------------------------------------------------------
// SECTION 13 — COMPLETE MISSION PLANNER
// ---------------------------------------------------------------------------

/**
 * Plan a complete mission from launch to orbit.
 * This is the top-level orchestrator that uses all the above functions.
 *
 * @param {Object} params
 * @param {number} params.totalDeltaV      m/s total available
 * @param {number} params.launchLatDeg     degrees
 * @param {number} params.launchLonDeg     degrees
 * @param {string} [params.preferredOrbit] optional orbit type override
 * @param {number} [params.epochSeconds]   seconds since J2000 (default 0)
 * @returns {Object} complete mission plan
 */
function planMission(params) {
  const {
    totalDeltaV,
    launchLatDeg,
    launchLonDeg,
    preferredOrbit,
    epochSeconds = 0,
  } = params;

  const launchLat = deg2rad(launchLatDeg);
  const launchLon = deg2rad(launchLonDeg);

  // 1. Find all achievable orbits
  const achievable = getAchievableOrbits(totalDeltaV, launchLat, launchLon);

  // 2. Select the best orbit
  let selected;
  if (preferredOrbit) {
    selected = achievable.find(o => o.type === preferredOrbit && o.achievable);
    if (!selected) {
      selected = selectOrbit(achievable, { totalDeltaV });
    }
  } else {
    selected = selectOrbit(achievable, { totalDeltaV });
  }

  if (!selected) {
    return {
      success: false,
      message: "Insufficient delta-v for any orbit",
      achievable,
      minDeltaVNeeded: achievable.length > 0
        ? Math.min(...achievable.map(o => o.deltaVRequired))
        : null,
    };
  }

  // 3. Compute orbital elements
  const elements = computeOrbitalElements(
    selected.type,
    selected.altitude,
    selected.inclination,
    {
      epoch: epochSeconds,
      raan: launchLon + Math.PI / 2, // ascending node near launch longitude
      name: selected.name,
    }
  );

  // 4. Delta-v budget
  const budget = computeDeltaVBudget(
    selected.type, launchLat, selected.altitude, selected.inclination
  );

  // 5. Launch geometry
  const azimuth = launchAzimuth(launchLat, selected.inclination);
  const rotationalVelocity = launchSiteVelocity(launchLat);

  // 6. Generate orbit trace for visualization
  const orbitTrace = generateOrbitTrace(elements, 360, 1);
  const groundTrack = generateGroundTrack(elements, 3, 120);

  // 7. Compute some interesting derived quantities
  const state0 = propagateOrbit(elements, 0);
  const eclipseAtStart = isInShadow(state0.position, epochSeconds);

  return {
    success: true,
    selected: {
      type: selected.type,
      name: selected.name,
      altitude: selected.altitude,
      altitudeKm: selected.altitude / 1000,
      inclinationDeg: rad2deg(selected.inclination),
      deltaVRequired: selected.deltaVRequired,
      deltaVMargin: selected.deltaVMargin,
    },
    elements,
    budget,
    launch: {
      latitude: launchLatDeg,
      longitude: launchLonDeg,
      azimuthDeg: rad2deg(azimuth),
      rotationalVelocity,
      launchSiteECEF: geodeticToECEF(launchLat, launchLon, 0),
    },
    orbit: {
      period: elements.period,
      periodMinutes: elements.period / 60,
      altPerigeeKm: elements.altPerigee / 1000,
      altApogeeKm: elements.altApogee / 1000,
      eccentricity: elements.e,
      velocityAtPerigee: circularVelocity(elements.a * (1 - elements.e)),
      velocityAtApogee: circularVelocity(elements.a * (1 + elements.e)),
    },
    visualization: {
      orbitTrace,
      groundTrack,
      orbitEllipse: generateOrbitEllipsePQW(elements, 180),
    },
    eclipseAtStart,
    achievableOrbits: achievable,
  };
}


// ---------------------------------------------------------------------------
// SECTION 14 — SSO INCLINATION TABLE (precomputed reference)
// ---------------------------------------------------------------------------

/**
 * Compute the required SSO inclination for a range of altitudes.
 * Useful as a quick-reference lookup.
 */
function ssoInclinationTable() {
  const table = [];
  for (let altKm = 200; altKm <= 1500; altKm += 50) {
    const alt = altKm * 1000;
    const elems = computeOrbitalElements("SSO", alt, 0);
    table.push({
      altitudeKm: altKm,
      inclinationDeg: rad2deg(elems.i),
      periodMinutes: elems.period / 60,
    });
  }
  return table;
}


// ---------------------------------------------------------------------------
// SECTION 15 — EXPORTS
// ---------------------------------------------------------------------------

// For Node.js / module bundlers
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    // Constants
    CONST,
    DEG, RAD,

    // Utilities
    deg2rad, rad2deg, normalizeAngle, clamp, lerp,
    V3,

    // Coordinate transforms
    gmst,
    eciToEcef,
    ecefToEci,
    ecefToGeodetic,
    geodeticToECEF,
    perifocalToECI,
    sunDirectionECI,

    // Orbital mechanics core
    circularVelocity,
    orbitalPeriod,
    meanMotion,
    computeOrbitalElements,
    solveKepler,
    eccentricToTrue,
    trueToEccentric,
    propagateOrbit,
    stateToElements,
    elementsToState,
    hohmannTransfer,

    // Launch geometry
    launchSiteVelocity,
    launchAzimuth,
    launchVelocityECI,

    // Delta-v and mission planning
    computeDeltaVBudget,
    getAchievableOrbits,
    selectOrbit,
    planMission,

    // Visualization
    generateOrbitTrace,
    generateGroundTrack,
    generateOrbitEllipsePQW,
    computeVisibilityWindows,
    isInShadow,

    // Reference
    ssoInclinationTable,
  };
}

// For browser global scope
if (typeof window !== "undefined") {
  window.OrbitalMechanics = {
    CONST,
    DEG, RAD,
    deg2rad, rad2deg, normalizeAngle, clamp, lerp,
    V3,
    gmst,
    eciToEcef, ecefToEci,
    ecefToGeodetic, geodeticToECEF,
    perifocalToECI, sunDirectionECI,
    circularVelocity, orbitalPeriod, meanMotion,
    computeOrbitalElements,
    solveKepler, eccentricToTrue, trueToEccentric,
    propagateOrbit, stateToElements, elementsToState,
    hohmannTransfer,
    launchSiteVelocity, launchAzimuth, launchVelocityECI,
    computeDeltaVBudget, getAchievableOrbits, selectOrbit,
    planMission,
    generateOrbitTrace, generateGroundTrack, generateOrbitEllipsePQW,
    computeVisibilityWindows, isInShadow,
    ssoInclinationTable,
  };
}
