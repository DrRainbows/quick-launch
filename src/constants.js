// ============================================================================
// PHYSICAL CONSTANTS — Single source of truth
// ============================================================================
// Every module imports from here. No more duplicating GM, RE, g0, OMEGA.

// Gravitational parameter (Earth), m³/s²
export const GM = 3.986004418e14;

// Mean Earth radius, m
export const RE = 6371000;

// Standard gravity, m/s²
export const G0 = 9.80665;

// Earth rotation rate, rad/s
export const OMEGA = 7.2921159e-5;

// J2 oblateness coefficient
export const J2 = 1.08263e-3;

// Equatorial radius (WGS84), m
export const RE_EQ = 6378137;

// Polar radius (WGS84), m
export const RE_POL = 6356752;

// Scene scale: Earth radius in Three.js scene units
export const EARTH_RADIUS_SCENE = 50;

// Meters to scene units
export const SCALE = EARTH_RADIUS_SCENE / RE;

// Angle conversions
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
