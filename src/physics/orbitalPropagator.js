// ============================================================================
// ORBITAL PROPAGATOR — Persistent object propagation (Velocity-Verlet)
// ============================================================================
// Propagates satellites, spent stages, and debris in Keplerian gravity.
// Detects ground impact mid-step to prevent tunneling.
// Visual updates are handled by render/orbitalObjects.js — this is pure physics.

import { GM, RE, SCALE } from '../constants.js';
import { eciToScene } from '../coords/transforms.js';

/**
 * Propagate an orbital object's ECI state by dtTotal seconds.
 * Uses velocity-Verlet with adaptive substeps for stability at high time warp.
 * Returns true if the object impacted the surface.
 */
export function propagateObject(state, dtTotal) {
  const MAX_STEP = 10; // max 10s per integration step
  const nSteps = Math.max(1, Math.ceil(dtTotal / MAX_STEP));
  const dt = dtTotal / nSteps;

  for (let step = 0; step < nSteps; step++) {
    const r = Math.sqrt(state.x * state.x + state.y * state.y + state.z * state.z);
    const a = -GM / (r * r * r);
    state.vx += a * state.x * dt;
    state.vy += a * state.y * dt;
    state.vz += a * state.z * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.z += state.vz * dt;

    // Mid-step impact check (prevent tunneling)
    const rCheck = Math.sqrt(state.x * state.x + state.y * state.y + state.z * state.z);
    if (rCheck < RE) {
      return true; // impacted
    }
  }
  return false; // still in orbit
}

/**
 * Compute orbit ring points (128 segments) from current ECI state.
 * Returns Float32Array of scene-space positions [x,y,z, x,y,z, ...] or null if hyperbolic.
 */
export function computeOrbitRing(eciState) {
  const s = eciState;
  const r = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
  const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
  const energy = 0.5 * v * v - GM / r;
  const sma = -GM / (2 * energy);
  if (sma < 0 || sma > 1e9) return null; // hyperbolic or invalid

  const period = 2 * Math.PI * Math.sqrt(sma * sma * sma / GM);
  const dt = period / 128;
  const points = [];

  // Propagate one full orbit with simple Verlet
  let px = s.x, py = s.y, pz = s.z;
  let pvx = s.vx, pvy = s.vy, pvz = s.vz;

  for (let i = 0; i <= 128; i++) {
    const sp = eciToScene(px, py, pz);
    points.push(sp.x, sp.y, sp.z);

    const rr = Math.sqrt(px * px + py * py + pz * pz);
    const a = -GM / (rr * rr * rr);
    pvx += a * px * dt;
    pvy += a * py * dt;
    pvz += a * pz * dt;
    px += pvx * dt;
    py += pvy * dt;
    pz += pvz * dt;
  }

  return new Float32Array(points);
}
