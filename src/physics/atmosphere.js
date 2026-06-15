// ============================================================================
// ATMOSPHERE — US Standard Atmosphere 1976
// ============================================================================
// Extracted from FlightSim IIFE. Used by aerodynamics, FlightSim, telemetry.

import { G0 } from '../constants.js';

const R_AIR = 287.05;  // specific gas constant for dry air, J/(kg·K)
const GAMMA = 1.4;     // ratio of specific heats

export const ATM_LAYERS = [
  { h: 0,     T: 288.15, L: -0.0065, P: 101325 },
  { h: 11000, T: 216.65, L: 0,       P: 22632.1 },
  { h: 20000, T: 216.65, L: 0.001,   P: 5474.89 },
  { h: 32000, T: 228.65, L: 0.0028,  P: 868.019 },
  { h: 47000, T: 270.65, L: 0,       P: 110.906 },
  { h: 51000, T: 270.65, L: -0.0028, P: 66.939 },
  { h: 71000, T: 214.65, L: -0.002,  P: 3.9564 },
];

/**
 * Compute atmospheric properties at a given altitude (meters).
 * Returns { T (K), P (Pa), rho (kg/m³), a (m/s speed of sound) }.
 */
export function atmosphere(alt) {
  if (alt < 0) alt = 0;
  if (alt > 300000) return { T: 1000, P: 0, rho: 0, a: 0 };

  // Thermosphere (above 86km): simple exponential model
  if (alt > 86000) {
    const T = 186.87 + (alt - 86000) * 0.003;
    const P = 0.3734 * Math.exp(-(alt - 86000) / 6500);
    return { T, P, rho: P / (R_AIR * T), a: Math.sqrt(GAMMA * R_AIR * T) };
  }

  // Find layer
  let layer = ATM_LAYERS[0];
  for (let i = ATM_LAYERS.length - 1; i >= 0; i--) {
    if (alt >= ATM_LAYERS[i].h) { layer = ATM_LAYERS[i]; break; }
  }

  const dh = alt - layer.h;
  let T, P;

  if (Math.abs(layer.L) < 1e-10) {
    // Isothermal layer
    T = layer.T;
    P = layer.P * Math.exp(-G0 * dh / (R_AIR * T));
  } else {
    // Gradient layer
    T = layer.T + layer.L * dh;
    P = layer.P * Math.pow(T / layer.T, -G0 / (R_AIR * layer.L));
  }

  const rho = P / (R_AIR * T);
  return { T, P, rho, a: Math.sqrt(GAMMA * R_AIR * Math.max(T, 100)) };
}
