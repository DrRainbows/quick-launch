/**
 * @module lib/shared/constants
 * @description Physical and scene constants (SI units). Single source of truth for
 *   browser (`src/constants.js`) and Node test pipelines.
 */

/** Gravitational parameter of Earth [m³/s²] */
export const GM = 3.986004418e14;

/** Mean Earth radius [m] */
export const RE = 6371000;

/** Standard gravity [m/s²] */
export const G0 = 9.80665;

/** Earth sidereal rotation rate [rad/s] */
export const OMEGA = 7.2921159e-5;

/** J2 oblateness coefficient (dimensionless) */
export const J2 = 1.08263e-3;

/** WGS84 equatorial radius [m] */
export const RE_EQ = 6378137;

/** WGS84 polar radius [m] */
export const RE_POL = 6356752;

/** Earth radius in Three.js scene units */
export const EARTH_RADIUS_SCENE = 50;

/** Meters → scene units */
export const SCALE = EARTH_RADIUS_SCENE / RE;

/** Degrees → radians */
export const DEG = Math.PI / 180;

/** Radians → degrees */
export const RAD = 180 / Math.PI;

/** Kármán line altitude [m] */
export const KARMAN_ALTITUDE = 100000;

/** Minimum liftoff thrust-to-weight ratio enforced by stage config */
export const MIN_LIFTOFF_TWR = 1.05;

/** Delta-V margin applied when validating stage configs against mission budget */
export const STAGE_DV_MARGIN = 1.02;
