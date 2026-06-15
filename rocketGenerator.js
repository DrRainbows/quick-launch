// ============================================================================
// PARAMETRIC ORBITAL ROCKET GENERATOR
// ============================================================================
// Complete solution space for any conceivable orbital-class launch vehicle.
// Produces fully-specified rocket objects suitable for trajectory simulation.
//
// Public API:
//   generateRocket(latitude, targetOrbitClass, options?)  -> RocketSpec
//
// All SI units unless noted: mass in kg, force in N, length in m,
// pressure in Pa, temperature in K, time in s.
// ============================================================================

"use strict";

// ---------------------------------------------------------------------------
// 0. PHYSICAL CONSTANTS
// ---------------------------------------------------------------------------
const PHYS = Object.freeze({
  g0:        9.80665,       // m/s^2  standard gravity
  R_earth:   6371000,       // m      mean Earth radius
  mu_earth:  3.986004418e14,// m^3/s^2 Earth gravitational parameter
  atm:       101325,        // Pa     standard atmosphere
  gamma_air: 1.4,           // ratio of specific heats (air)
  R_air:     287.058,       // J/(kg*K)  specific gas constant for air
  omega_earth: 7.2921159e-5,// rad/s  Earth rotation rate
});

// ---------------------------------------------------------------------------
// 1. PROPELLANT DATABASE
// ---------------------------------------------------------------------------
// Each entry contains thermochemical and handling properties needed
// to size engines, tanks, and predict performance.
const PROPELLANTS = Object.freeze({

  "LOX/RP-1": {
    oxidizer: "LOX", fuel: "RP-1",
    oxDensity: 1141,    // kg/m^3
    fuelDensity: 810,   // kg/m^3
    optimalOF: 2.56,    // stoichiometric-ish optimum
    ofRange: [2.1, 2.8],
    chamberTempNominal: 3670, // K
    gammaExhaust: 1.24,
    molarMassExhaust: 23.3e-3, // kg/mol
    ispVacTheoretical: 358,  // s (ideal, frozen-flow reference)
    ispSlTheoretical: 300,
    cStarNominal: 1780,      // m/s  characteristic velocity
    toxicity: "low",
    cryogenic: "oxidizer_only",
    storability: "semi",
    costPerKg: 0.5,          // $/kg indicative
  },

  "LOX/LH2": {
    oxidizer: "LOX", fuel: "LH2",
    oxDensity: 1141,
    fuelDensity: 70.8,
    optimalOF: 5.5,
    ofRange: [4.5, 6.5],
    chamberTempNominal: 3520,
    gammaExhaust: 1.26,
    molarMassExhaust: 12.0e-3,
    ispVacTheoretical: 465,
    ispSlTheoretical: 370,
    cStarNominal: 2360,
    toxicity: "none",
    cryogenic: "both",
    storability: "cryo",
    costPerKg: 3.0,
  },

  "LOX/CH4": {
    oxidizer: "LOX", fuel: "LCH4",
    oxDensity: 1141,
    fuelDensity: 422.6,
    optimalOF: 3.55,
    ofRange: [3.0, 4.0],
    chamberTempNominal: 3600,
    gammaExhaust: 1.23,
    molarMassExhaust: 20.0e-3,
    ispVacTheoretical: 380,
    ispSlTheoretical: 320,
    cStarNominal: 1860,
    toxicity: "none",
    cryogenic: "both",
    storability: "cryo",
    costPerKg: 0.8,
  },

  "N2O4/UDMH": {
    oxidizer: "N2O4", fuel: "UDMH",
    oxDensity: 1440,
    fuelDensity: 793,
    optimalOF: 2.6,
    ofRange: [2.0, 3.2],
    chamberTempNominal: 3250,
    gammaExhaust: 1.25,
    molarMassExhaust: 22.0e-3,
    ispVacTheoretical: 330,
    ispSlTheoretical: 280,
    cStarNominal: 1720,
    toxicity: "high",
    cryogenic: "none",
    storability: "storable",
    costPerKg: 5.0,
  },

  "SOLID": {
    oxidizer: "AP",  fuel: "HTPB/Al",
    oxDensity: 1950,
    fuelDensity: 1750,
    bulkDensity: 1800,     // kg/m^3 cast grain
    optimalOF: 3.5,
    ofRange: [3.0, 4.0],
    chamberTempNominal: 3400,
    gammaExhaust: 1.17,
    molarMassExhaust: 28.0e-3,
    ispVacTheoretical: 300,
    ispSlTheoretical: 268,
    cStarNominal: 1550,
    toxicity: "moderate",
    cryogenic: "none",
    storability: "storable",
    costPerKg: 8.0,
  },
});

// ---------------------------------------------------------------------------
// 2. ENGINE CYCLE DATABASE
// ---------------------------------------------------------------------------
// Defines the parametric envelope for each cycle architecture.
const ENGINE_CYCLES = Object.freeze({

  "pressure-fed": {
    chamberPressureRange: [5e5, 30e5],    // Pa (5-30 bar)
    ispEfficiency: [0.88, 0.93],          // fraction of theoretical Isp
    thrustRange: [1e4, 5e5],              // N per engine
    massSpecific: 0.012,                  // kg/N  (engine mass per unit thrust)
    throttleable: false,
    throttleRange: [1.0, 1.0],
    gimbalCapable: true,
    gimbalRange: [0, 5],                  // degrees
    restartable: true,
    maxRestarts: 10,
    reliabilityBase: 0.995,
    complexity: 1.0,
    coolingMethods: ["ablative", "radiative", "film"],
    compatiblePropellants: ["LOX/RP-1", "LOX/CH4", "N2O4/UDMH", "LOX/LH2"],
    tvcMethods: ["gimbal", "jet_vanes"],
    startupTime: 0.3,                    // s
    shutdownTime: 0.2,                   // s
    costRelative: 1.0,
  },

  "gas-generator": {
    chamberPressureRange: [40e5, 150e5],
    ispEfficiency: [0.92, 0.96],
    thrustRange: [5e4, 10e6],
    massSpecific: 0.008,
    throttleable: true,
    throttleRange: [0.50, 1.0],
    gimbalCapable: true,
    gimbalRange: [0, 7],
    restartable: true,
    maxRestarts: 5,
    reliabilityBase: 0.993,
    complexity: 2.0,
    coolingMethods: ["regenerative", "film", "ablative"],
    compatiblePropellants: ["LOX/RP-1", "LOX/LH2", "LOX/CH4", "N2O4/UDMH"],
    tvcMethods: ["gimbal"],
    startupTime: 1.5,
    shutdownTime: 0.8,
    costRelative: 3.0,
  },

  "staged-combustion": {
    chamberPressureRange: [100e5, 300e5],
    ispEfficiency: [0.96, 0.99],
    thrustRange: [5e5, 10e6],
    massSpecific: 0.010,
    throttleable: true,
    throttleRange: [0.40, 1.0],
    gimbalCapable: true,
    gimbalRange: [0, 8],
    restartable: true,
    maxRestarts: 3,
    reliabilityBase: 0.990,
    complexity: 4.0,
    coolingMethods: ["regenerative", "film"],
    compatiblePropellants: ["LOX/RP-1", "LOX/LH2", "LOX/CH4"],
    tvcMethods: ["gimbal"],
    startupTime: 2.5,
    shutdownTime: 1.2,
    costRelative: 6.0,
  },

  "expander": {
    chamberPressureRange: [20e5, 80e5],
    ispEfficiency: [0.94, 0.97],
    thrustRange: [1e4, 2e5],
    massSpecific: 0.009,
    throttleable: true,
    throttleRange: [0.50, 1.0],
    gimbalCapable: true,
    gimbalRange: [0, 6],
    restartable: true,
    maxRestarts: 15,
    reliabilityBase: 0.997,
    complexity: 2.5,
    coolingMethods: ["regenerative"],
    compatiblePropellants: ["LOX/LH2", "LOX/CH4"],
    tvcMethods: ["gimbal"],
    startupTime: 3.0,
    shutdownTime: 1.0,
    costRelative: 4.0,
  },

  "electric-pump-fed": {
    chamberPressureRange: [20e5, 80e5],
    ispEfficiency: [0.91, 0.95],
    thrustRange: [1e4, 1e6],
    massSpecific: 0.010,
    throttleable: true,
    throttleRange: [0.40, 1.0],
    gimbalCapable: true,
    gimbalRange: [0, 6],
    restartable: true,
    maxRestarts: 20,
    reliabilityBase: 0.994,
    complexity: 1.5,
    coolingMethods: ["regenerative", "ablative", "film"],
    compatiblePropellants: ["LOX/RP-1", "LOX/CH4", "LOX/LH2"],
    tvcMethods: ["gimbal"],
    startupTime: 0.8,
    shutdownTime: 0.3,
    costRelative: 2.0,
    batteryMassPerMJ: 5.0,  // kg per MJ of pump energy (Li-ion class)
  },

  "solid": {
    chamberPressureRange: [20e5, 100e5],
    ispEfficiency: [0.90, 0.95],
    thrustRange: [5e4, 1e7],
    massSpecific: 0.005,        // casing is light relative to thrust
    throttleable: false,
    throttleRange: [1.0, 1.0],
    gimbalCapable: false,
    gimbalRange: [0, 0],
    restartable: false,
    maxRestarts: 0,
    reliabilityBase: 0.996,
    complexity: 0.5,
    coolingMethods: ["ablative"],
    compatiblePropellants: ["SOLID"],
    tvcMethods: ["flex_nozzle", "jet_vanes", "none"],
    startupTime: 0.1,
    shutdownTime: 0.0,         // burns to depletion
    costRelative: 1.5,
  },
});

// ---------------------------------------------------------------------------
// 3. STRUCTURAL MATERIALS DATABASE
// ---------------------------------------------------------------------------
const TANK_MATERIALS = Object.freeze({

  "Al-Li_2195": {
    density: 2710,             // kg/m^3
    yieldStrength: 530e6,      // Pa
    ultimateStrength: 570e6,
    elasticModulus: 77e9,
    fatigueLife: 1000,         // cycles to crack initiation
    thermalExpansion: 22e-6,   // 1/K
    minServiceTemp: 20,        // K (LOX/LH2 compatible)
    maxServiceTemp: 420,
    weldEfficiency: 0.85,
    manufacturability: "good",
    costRelative: 3.0,
    compatiblePropellants: ["LOX/RP-1", "LOX/LH2", "LOX/CH4"],
  },

  "Steel_301": {
    density: 7880,
    yieldStrength: 965e6,
    ultimateStrength: 1280e6,
    elasticModulus: 193e9,
    fatigueLife: 5000,
    thermalExpansion: 17e-6,
    minServiceTemp: 20,
    maxServiceTemp: 800,
    weldEfficiency: 0.90,
    manufacturability: "excellent",
    costRelative: 1.0,
    compatiblePropellants: ["LOX/RP-1", "LOX/LH2", "LOX/CH4", "N2O4/UDMH"],
  },

  "Steel_304L": {
    density: 7900,
    yieldStrength: 210e6,
    ultimateStrength: 586e6,
    elasticModulus: 193e9,
    fatigueLife: 10000,
    thermalExpansion: 17.3e-6,
    minServiceTemp: 4,
    maxServiceTemp: 870,
    weldEfficiency: 0.95,
    manufacturability: "excellent",
    costRelative: 1.2,
    compatiblePropellants: ["LOX/RP-1", "LOX/LH2", "LOX/CH4", "N2O4/UDMH"],
  },

  "Carbon_Composite": {
    density: 1600,
    yieldStrength: 600e6,       // tensile
    ultimateStrength: 900e6,
    elasticModulus: 135e9,
    fatigueLife: 500,
    thermalExpansion: 2e-6,
    minServiceTemp: 150,        // not cryo-compatible without liner
    maxServiceTemp: 450,
    weldEfficiency: 1.0,        // bonded, no welds
    manufacturability: "difficult",
    costRelative: 8.0,
    compatiblePropellants: ["LOX/RP-1", "LOX/CH4", "SOLID"],
    requiresLiner: true,
    linerMassFraction: 0.15,
  },

  "Stainless_Steel_30X": {
    density: 7900,
    yieldStrength: 1100e6,      // cryo-worked
    ultimateStrength: 1500e6,
    elasticModulus: 200e9,
    fatigueLife: 8000,
    thermalExpansion: 17e-6,
    minServiceTemp: 4,
    maxServiceTemp: 900,
    weldEfficiency: 0.92,
    manufacturability: "excellent",
    costRelative: 1.5,
    compatiblePropellants: ["LOX/RP-1", "LOX/LH2", "LOX/CH4", "N2O4/UDMH"],
  },
});

// ---------------------------------------------------------------------------
// 4. ORBIT CLASS DEFINITIONS
// ---------------------------------------------------------------------------
// Delta-v budgets include gravity losses, drag losses, and steering losses.
const ORBIT_CLASSES = Object.freeze({

  "LEO": {
    altitudeRange: [200e3, 2000e3],  // m
    defaultAltitude: 400e3,
    inclination: null,               // set from latitude
    idealDeltaV: 7800,               // m/s  orbital velocity at 400 km
    gravityLoss: 1200,               // m/s  typical
    dragLoss: 200,                   // m/s
    steeringLoss: 150,               // m/s
    totalDeltaV: function(alt) {
      const v_orb = Math.sqrt(PHYS.mu_earth / (PHYS.R_earth + (alt || this.defaultAltitude)));
      return v_orb + this.gravityLoss + this.dragLoss + this.steeringLoss;
    },
  },

  "SSO": {
    altitudeRange: [400e3, 900e3],
    defaultAltitude: 600e3,
    inclination: 97.8,              // degrees (sun-synchronous)
    idealDeltaV: 7600,
    gravityLoss: 1250,
    dragLoss: 180,
    steeringLoss: 300,              // higher due to dog-leg
    totalDeltaV: function(alt) {
      const v_orb = Math.sqrt(PHYS.mu_earth / (PHYS.R_earth + (alt || this.defaultAltitude)));
      return v_orb + this.gravityLoss + this.dragLoss + this.steeringLoss;
    },
  },

  "MEO": {
    altitudeRange: [2000e3, 35786e3],
    defaultAltitude: 20200e3,
    inclination: 55,
    idealDeltaV: 3870,
    gravityLoss: 1200,
    dragLoss: 200,
    steeringLoss: 200,
    transferDeltaV: 2500,           // additional for transfer orbit
    totalDeltaV: function(alt) {
      const v_orb = Math.sqrt(PHYS.mu_earth / (PHYS.R_earth + (alt || this.defaultAltitude)));
      const v_leo = Math.sqrt(PHYS.mu_earth / (PHYS.R_earth + 200e3));
      const rp = PHYS.R_earth + 200e3;
      const ra = PHYS.R_earth + (alt || this.defaultAltitude);
      const a_t = (rp + ra) / 2;
      const dv_transfer = Math.sqrt(PHYS.mu_earth * (2/rp - 1/a_t)) - v_leo;
      const dv_circ = v_orb - Math.sqrt(PHYS.mu_earth * (2/ra - 1/a_t));
      return v_leo + this.gravityLoss + this.dragLoss + dv_transfer + dv_circ;
    },
  },

  "GTO": {
    altitudeRange: [35786e3, 35786e3],
    defaultAltitude: 35786e3,
    inclination: 0,
    idealDeltaV: 10000,
    gravityLoss: 1300,
    dragLoss: 200,
    steeringLoss: 200,
    totalDeltaV: function(alt) {
      const v_leo = Math.sqrt(PHYS.mu_earth / (PHYS.R_earth + 200e3));
      const rp = PHYS.R_earth + 200e3;
      const ra = PHYS.R_earth + 35786e3;
      const a_t = (rp + ra) / 2;
      const dv_tli = Math.sqrt(PHYS.mu_earth * (2/rp - 1/a_t)) - v_leo;
      return v_leo + this.gravityLoss + this.dragLoss + this.steeringLoss + dv_tli;
    },
  },

  "GEO": {
    altitudeRange: [35786e3, 35786e3],
    defaultAltitude: 35786e3,
    inclination: 0,
    gravityLoss: 1300,
    dragLoss: 200,
    steeringLoss: 200,
    totalDeltaV: function(alt, latitude) {
      const v_leo = Math.sqrt(PHYS.mu_earth / (PHYS.R_earth + 200e3));
      const rp = PHYS.R_earth + 200e3;
      const ra = PHYS.R_earth + 35786e3;
      const a_t = (rp + ra) / 2;
      const dv_tli = Math.sqrt(PHYS.mu_earth * (2/rp - 1/a_t)) - v_leo;
      const v_geo = Math.sqrt(PHYS.mu_earth / ra);
      const v_apo = Math.sqrt(PHYS.mu_earth * (2/ra - 1/a_t));
      const lat_rad = (latitude || 28.5) * Math.PI / 180;
      const dv_circ_and_plane = Math.sqrt(
        v_apo * v_apo + v_geo * v_geo - 2 * v_apo * v_geo * Math.cos(lat_rad)
      );
      return v_leo + this.gravityLoss + this.dragLoss + this.steeringLoss + dv_tli + dv_circ_and_plane;
    },
  },

  "Escape": {
    altitudeRange: [null, null],
    defaultAltitude: null,
    inclination: null,
    gravityLoss: 1300,
    dragLoss: 200,
    steeringLoss: 200,
    totalDeltaV: function() {
      const v_leo = Math.sqrt(PHYS.mu_earth / (PHYS.R_earth + 200e3));
      const rp = PHYS.R_earth + 200e3;
      const v_esc = Math.sqrt(2 * PHYS.mu_earth / rp);
      const dv_esc = v_esc - v_leo;
      return v_leo + this.gravityLoss + this.dragLoss + this.steeringLoss + dv_esc;
    },
  },
});


// ============================================================================
// 5. UTILITY FUNCTIONS
// ============================================================================

/** Clamp a value between min and max. */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear interpolation. */
function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Random float in [lo, hi]. */
function randRange(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

/** Pick a random element from an array. */
function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Weighted random choice. weights[] must match items[] length. */
function weightedChoice(items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Gaussian random with given mean and std-dev (Box-Muller). */
function randGauss(mean, stddev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-30)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
}

/** Round to n decimal places. */
function roundTo(val, n) {
  const f = Math.pow(10, n);
  return Math.round(val * f) / f;
}


// ============================================================================
// 6. NOZZLE & THERMOCHEMISTRY
// ============================================================================

/**
 * Compute nozzle exit velocity given chamber conditions and expansion ratio.
 * Uses isentropic 1-D nozzle theory.
 *
 * @param {number} Tc     - chamber temperature (K)
 * @param {number} gamma  - ratio of specific heats
 * @param {number} M_mol  - mean molar mass of exhaust (kg/mol)
 * @param {number} epsilon - area expansion ratio Ae/At
 * @returns {{ ve: number, pe: number, Te: number }}
 */
function nozzleExitConditions(Tc, gamma, M_mol, epsilon, Pc) {
  const R_u = 8.314462;  // J/(mol*K)
  const R_g = R_u / M_mol;

  // Solve for exit Mach number from area ratio (Newton iteration)
  // A/A* = (1/M)*((2/(gamma+1))*(1 + (gamma-1)/2 * M^2))^((gamma+1)/(2*(gamma-1)))
  let Me = 2.0; // initial guess, supersonic branch
  for (let i = 0; i < 50; i++) {
    const gp1 = gamma + 1;
    const gm1 = gamma - 1;
    const t = 1 + gm1 / 2 * Me * Me;
    const A_ratio = (1 / Me) * Math.pow(2 / gp1 * t, gp1 / (2 * gm1));
    const dA_dM = A_ratio * (-1 / Me + gm1 * Me / t * (gp1 / (2 * gm1)));
    // Newton step: f(M) = A_ratio - epsilon = 0
    const err = A_ratio - epsilon;
    Me = Me - err / dA_dM;
    if (Me < 1.0) Me = 1.01;
    if (Math.abs(err) < 1e-8) break;
  }

  const Te = Tc / (1 + (gamma - 1) / 2 * Me * Me);
  const pe = Pc * Math.pow(Te / Tc, gamma / (gamma - 1));
  const ve = Me * Math.sqrt(gamma * R_g * Te);

  return { ve, pe, Te, Me };
}

/**
 * Compute specific impulse (s) from engine parameters.
 *
 * @param {object} prop       - propellant entry from PROPELLANTS
 * @param {number} Pc         - chamber pressure (Pa)
 * @param {number} epsilon    - nozzle expansion ratio
 * @param {number} efficiency - Isp efficiency factor (0-1)
 * @param {number} Pa         - ambient pressure (Pa), 0 for vacuum
 * @returns {{ ispSL: number, ispVac: number, thrustCoeff: number }}
 */
function computeIsp(prop, Pc, epsilon, efficiency, Pa) {
  if (Pa === undefined) Pa = PHYS.atm;
  const gamma = prop.gammaExhaust;
  const Tc = prop.chamberTempNominal;
  const M_mol = prop.molarMassExhaust;

  const { ve, pe } = nozzleExitConditions(Tc, gamma, M_mol, epsilon, Pc);

  // Thrust coefficient CF = ve/cStar + (pe - Pa)*Ae / (Pc*At)
  // But simpler: Isp = efficiency * (theoretical Isp adjusted for Pc and epsilon)
  // We use a blended model: thermochemical base + correction for off-nominal Pc.
  const Pc_ref = 100e5; // reference chamber pressure (100 bar)
  const pcCorrection = 0.02 * Math.log(Pc / Pc_ref); // small logarithmic correction

  const ispVac = prop.ispVacTheoretical * efficiency * (1 + pcCorrection);

  // Sea-level Isp: subtract the back-pressure penalty
  // dIsp = (pe - Pa)*Ae / (mdot * g0) simplified via expansion ratio
  const At = 1; // unit throat area for ratio computation
  const Ae = At * epsilon;
  const cStar = prop.cStarNominal;
  const mdot_per_At = Pc / cStar; // kg/(s*m^2)
  const backPressureDelta = (pe - Pa) * Ae / (mdot_per_At * PHYS.g0);
  const ispSL = clamp(ispVac + backPressureDelta / At * (Pa > 0 ? -1 : 0) * 0.001, // simplified model
    prop.ispSlTheoretical * 0.85 * efficiency,
    ispVac
  );

  // More direct model: scale between known SL and Vac theoretical
  const slFrac = Pa / PHYS.atm;
  const ispSL_direct = lerp(ispVac, prop.ispSlTheoretical * efficiency * (1 + pcCorrection), slFrac);

  return {
    ispSL: roundTo(Math.max(ispSL_direct, 180), 1),
    ispVac: roundTo(ispVac, 1),
    exhaustVelocityVac: ispVac * PHYS.g0,
    exhaustVelocitySL: ispSL_direct * PHYS.g0,
  };
}


// ============================================================================
// 7. ENGINE GENERATION
// ============================================================================

/**
 * Generate a complete engine specification.
 *
 * @param {string} cycleName     - key into ENGINE_CYCLES
 * @param {string} propellantName- key into PROPELLANTS
 * @param {object} constraints   - { thrustTarget, role }
 *   role: "booster" | "sustainer" | "upper" | "kick"
 * @returns {object} engine spec
 */
function generateEngine(cycleName, propellantName, constraints) {
  const cycle = ENGINE_CYCLES[cycleName];
  const prop = PROPELLANTS[propellantName];

  if (!cycle || !prop) {
    throw new Error(`Invalid cycle "${cycleName}" or propellant "${propellantName}"`);
  }
  if (!cycle.compatiblePropellants.includes(propellantName)) {
    throw new Error(`Cycle "${cycleName}" incompatible with propellant "${propellantName}"`);
  }

  const role = constraints.role || "sustainer";
  const thrustTarget = constraints.thrustTarget || lerp(cycle.thrustRange[0], cycle.thrustRange[1], 0.3);
  const thrust = clamp(thrustTarget, cycle.thrustRange[0], cycle.thrustRange[1]);

  // Chamber pressure: higher for high-performance roles
  let pcFrac;
  switch (role) {
    case "booster":   pcFrac = randRange(0.4, 0.7); break;
    case "sustainer":  pcFrac = randRange(0.5, 0.8); break;
    case "upper":     pcFrac = randRange(0.5, 0.9); break;
    case "kick":      pcFrac = randRange(0.2, 0.5); break;
    default:          pcFrac = 0.5;
  }
  const Pc = lerp(cycle.chamberPressureRange[0], cycle.chamberPressureRange[1], pcFrac);

  // Nozzle expansion ratio: large for vacuum, small for sea-level
  let epsilon;
  switch (role) {
    case "booster":   epsilon = randRange(8, 20);  break;
    case "sustainer":  epsilon = randRange(12, 35); break;
    case "upper":     epsilon = randRange(40, 200); break;
    case "kick":      epsilon = randRange(30, 80);  break;
    default:          epsilon = 25;
  }

  // Mixture ratio
  const OF = randRange(prop.ofRange[0], prop.ofRange[1]);

  // Isp efficiency
  const efficiency = randRange(cycle.ispEfficiency[0], cycle.ispEfficiency[1]);

  const { ispSL, ispVac, exhaustVelocityVac, exhaustVelocitySL } = computeIsp(prop, Pc, epsilon, efficiency, PHYS.atm);

  // Mass flow rate from thrust and Isp
  const ispEffective = (role === "booster" || role === "sustainer") ? ispSL : ispVac;
  const massFlowRate = thrust / (ispEffective * PHYS.g0);

  // Engine dry mass
  let dryMass = thrust * cycle.massSpecific;
  // Heavier nozzle for large expansion ratios
  dryMass *= (1 + 0.002 * (epsilon - 20));
  dryMass = Math.max(dryMass, 15); // minimum 15 kg for any engine

  // Electric pump-fed: add battery mass
  let batteryMass = 0;
  if (cycleName === "electric-pump-fed" && cycle.batteryMassPerMJ) {
    // Pump power ~ mdot * Pc / density  (simplified)
    const avgDensity = (prop.oxDensity * OF + prop.fuelDensity) / (OF + 1);
    const pumpPower = massFlowRate * Pc / avgDensity; // W (very rough)
    // For a nominal burn time of ~150s for booster, 300s for upper
    const burnTime = (role === "booster" || role === "sustainer") ? 150 : 300;
    const energyMJ = pumpPower * burnTime / 1e6;
    batteryMass = energyMJ * cycle.batteryMassPerMJ;
    dryMass += batteryMass;
  }

  // Throat diameter from Pc and thrust
  // F = Pc * At * Cf,  Cf ~ 1.5 for sea-level nozzle
  const Cf = (role === "upper" || role === "kick") ? 1.8 : 1.5;
  const At = thrust / (Pc * Cf);
  const throatDiameter = 2 * Math.sqrt(At / Math.PI);
  const exitDiameter = throatDiameter * Math.sqrt(epsilon);

  // Gimbal
  const gimbalAngle = cycle.gimbalCapable
    ? randRange(cycle.gimbalRange[0], cycle.gimbalRange[1])
    : 0;

  // Throttle
  const minThrottle = cycle.throttleable ? cycle.throttleRange[0] : 1.0;

  // Cooling
  const coolingMethod = randChoice(cycle.coolingMethods);

  // Reliability: slight thrust-dependent penalty for very large engines
  const thrustPenalty = thrust > 2e6 ? 0.001 * (thrust / 1e6 - 2) : 0;
  const reliability = clamp(cycle.reliabilityBase - thrustPenalty, 0.95, 0.999);

  return {
    name: `${cycleName.replace(/-/g, "_")}_${propellantName.replace(/\//g, "_")}_${Math.round(thrust / 1000)}kN`,
    cycle: cycleName,
    propellant: propellantName,
    role,

    // Performance
    thrustSL: roundTo(thrust * (ispSL / ispVac), 0),
    thrustVac: roundTo(thrust, 0),
    ispSL,
    ispVac,
    exhaustVelocityVac: roundTo(exhaustVelocityVac, 1),
    exhaustVelocitySL: roundTo(exhaustVelocitySL, 1),
    massFlowRate: roundTo(massFlowRate, 2),
    mixtureRatio: roundTo(OF, 3),

    // Chamber & nozzle
    chamberPressure: roundTo(Pc, 0),          // Pa
    chamberPressureBar: roundTo(Pc / 1e5, 1),
    expansionRatio: roundTo(epsilon, 1),
    throatDiameter: roundTo(throatDiameter, 4),  // m
    exitDiameter: roundTo(exitDiameter, 3),      // m

    // Physical
    dryMass: roundTo(dryMass, 1),
    batteryMass: roundTo(batteryMass, 1),
    length: roundTo(exitDiameter * 1.8 + 0.3, 2), // rough engine length

    // Capabilities
    gimbalAngle: roundTo(gimbalAngle, 1),
    minThrottle: roundTo(minThrottle, 2),
    maxThrottle: 1.0,
    restartable: cycle.restartable,
    maxRestarts: cycle.maxRestarts,
    coolingMethod,

    // Timing
    startupTime: cycle.startupTime,
    shutdownTime: cycle.shutdownTime,

    // Reliability
    reliability,

    // Cost
    costRelative: cycle.costRelative,

    // Derived helpers for simulation
    specificPower: roundTo(thrust / dryMass, 0), // N/kg  (TWR metric)
  };
}


// ============================================================================
// 8. SOLID MOTOR GENERATION
// ============================================================================

/**
 * Generate a solid rocket motor (booster or kick stage).
 *
 * @param {number} totalImpulse - desired total impulse (N*s)
 * @param {string} role         - "booster" | "kick"
 * @returns {object}
 */
function generateSolidMotor(totalImpulse, role) {
  const prop = PROPELLANTS["SOLID"];
  const cycle = ENGINE_CYCLES["solid"];

  const Pc = randRange(cycle.chamberPressureRange[0], cycle.chamberPressureRange[1]);
  const efficiency = randRange(cycle.ispEfficiency[0], cycle.ispEfficiency[1]);

  const ispVac = prop.ispVacTheoretical * efficiency;
  const ispSL = prop.ispSlTheoretical * efficiency;
  const ispEffective = role === "booster" ? lerp(ispSL, ispVac, 0.4) : ispVac;

  // Propellant mass from total impulse
  const propMass = totalImpulse / (ispEffective * PHYS.g0);

  // Burn time: solids typically 60-130s for boosters, 30-60s for kick stages
  const burnTime = role === "booster" ? randRange(60, 130) : randRange(30, 60);

  const avgThrust = totalImpulse / burnTime;
  const thrust = clamp(avgThrust, cycle.thrustRange[0], cycle.thrustRange[1]);

  // Casing mass fraction: typically 0.07-0.12 of propellant mass
  const casingFraction = randRange(0.07, 0.12);
  const casingMass = propMass * casingFraction;
  const nozzleMass = thrust * 0.003; // nozzle mass scales with thrust
  const dryMass = casingMass + nozzleMass;

  // Grain geometry
  const grainVolume = propMass / prop.bulkDensity;
  // Assume cylindrical segment with star or cylindrical bore
  const lengthToRadiusRatio = randRange(4, 8);
  const outerRadius = Math.pow(grainVolume / (Math.PI * lengthToRadiusRatio), 1 / 3);
  const grainLength = lengthToRadiusRatio * outerRadius;
  const outerDiameter = outerRadius * 2;

  // Expansion ratio
  const epsilon = role === "booster" ? randRange(7, 16) : randRange(30, 60);

  // Thrust profile: approximate as segments
  // Boost phase often has a thrust ramp
  const thrustProfile = {
    type: role === "booster" ? "regressive" : "neutral",
    peakToAvgRatio: role === "booster" ? randRange(1.05, 1.25) : 1.0,
    ignitionTransient: 0.3,  // seconds
  };

  return {
    name: `solid_${role}_${Math.round(thrust / 1000)}kN`,
    cycle: "solid",
    propellant: "SOLID",
    role,

    thrustSL: roundTo(thrust * (ispSL / ispVac), 0),
    thrustVac: roundTo(thrust, 0),
    ispSL: roundTo(ispSL, 1),
    ispVac: roundTo(ispVac, 1),
    exhaustVelocityVac: roundTo(ispVac * PHYS.g0, 1),
    massFlowRate: roundTo(thrust / (ispEffective * PHYS.g0), 2),
    mixtureRatio: roundTo(prop.optimalOF, 2),

    chamberPressure: roundTo(Pc, 0),
    chamberPressureBar: roundTo(Pc / 1e5, 1),
    expansionRatio: roundTo(epsilon, 1),

    propellantMass: roundTo(propMass, 0),
    casingMass: roundTo(casingMass, 0),
    dryMass: roundTo(dryMass, 0),
    totalMass: roundTo(propMass + dryMass, 0),

    burnTime: roundTo(burnTime, 1),
    thrustProfile,

    grainGeometry: {
      outerDiameter: roundTo(outerDiameter, 3),
      length: roundTo(grainLength, 2),
      volume: roundTo(grainVolume, 2),
    },

    gimbalAngle: 0,
    minThrottle: 1.0,
    maxThrottle: 1.0,
    restartable: false,
    coolingMethod: "ablative",
    reliability: cycle.reliabilityBase,
    startupTime: 0.1,
    shutdownTime: 0,
  };
}


// ============================================================================
// 9. TANK & STRUCTURE SIZING
// ============================================================================

/**
 * Size propellant tanks for a stage.
 *
 * @param {number} propMass       - total propellant mass (kg)
 * @param {number} OF             - O/F mixture ratio
 * @param {object} prop           - propellant entry
 * @param {string} materialName   - key into TANK_MATERIALS
 * @param {number} maxAccel       - max axial acceleration (m/s^2) for pressure loads
 * @param {number} Pc             - chamber pressure for pressurization sizing
 * @param {number} fairingDia     - outer diameter constraint (m)
 * @returns {object} tank specification
 */
function sizeTanks(propMass, OF, prop, materialName, maxAccel, Pc, fairingDia) {
  const mat = TANK_MATERIALS[materialName];
  if (!mat) throw new Error(`Unknown material "${materialName}"`);

  const safetyFactor = randRange(1.25, 1.5);

  // Split propellant into ox and fuel by O/F ratio
  const oxMass = propMass * OF / (OF + 1);
  const fuelMass = propMass / (OF + 1);

  const oxDensity = prop.oxDensity;
  const fuelDensity = prop.fuelDensity;
  const oxVolume = oxMass / oxDensity;
  const fuelVolume = fuelMass / fuelDensity;

  // Ullage volume: 3-5% of propellant volume
  const ullageFrac = randRange(0.03, 0.05);
  const oxVolumeTotal = oxVolume * (1 + ullageFrac);
  const fuelVolumeTotal = fuelVolume * (1 + ullageFrac);

  // Tank internal pressure: MEOP
  // For pump-fed: 2-5 bar above vapor pressure
  // For pressure-fed: Pc + losses
  const isTankPressurized = Pc < 35e5; // pressure-fed threshold
  const tankPressure = isTankPressurized
    ? Pc * 1.2  // pressure-fed: tank > chamber pressure
    : randRange(2e5, 5e5); // pump-fed: modest tank pressure

  // Tank geometry: cylindrical with ellipsoidal domes
  const outerDia = fairingDia * randRange(0.90, 0.98); // some clearance
  const innerRadius = outerDia / 2 - 0.02; // wall thickness allowance

  function sizeOneTank(volume, density, pressure, label) {
    const r = innerRadius;
    // Dome volume (2 ellipsoidal caps with sqrt(2) aspect ratio)
    const domeAspect = randRange(1.0, 1.414); // sphere to sqrt2 ellipse
    const domeHeight = r / domeAspect;
    const domeVolume = (2 / 3) * Math.PI * r * r * domeHeight; // per dome
    const totalDomeVol = 2 * domeVolume;
    const cylVolume = Math.max(volume - totalDomeVol, 0);
    const cylLength = cylVolume / (Math.PI * r * r);
    const totalLength = cylLength + 2 * domeHeight;

    // Wall thickness: hoop stress for cylinder
    const hoopStress = mat.ultimateStrength / safetyFactor;
    const wallThickPressure = (pressure * r) / hoopStress;

    // Axial load from acceleration: compressive
    const axialLoad = (volume * density + 100) * maxAccel; // approximate
    const wallThickAxial = axialLoad / (2 * Math.PI * r * mat.yieldStrength / safetyFactor);

    // Buckling: simplified Euler column check
    const wallThickBuckling = 0.0005; // minimum gauge

    const wallThick = Math.max(wallThickPressure, wallThickAxial, wallThickBuckling, 0.0008);

    // Tank mass: cylinder + domes + stringers/stiffeners
    const cylArea = 2 * Math.PI * r * cylLength;
    const domeArea = 2 * Math.PI * r * domeHeight * 1.3; // per dome, with form factor
    const shellMass = (cylArea + 2 * domeArea) * wallThick * mat.density;
    const stiffenerMass = shellMass * 0.12; // 12% for stiffeners, baffles, etc.
    const insulation = prop.cryogenic !== "none" ? shellMass * 0.08 : 0;

    const totalMass = shellMass + stiffenerMass + insulation;

    return {
      label,
      volume: roundTo(volume, 3),
      innerRadius: roundTo(r, 4),
      outerDiameter: roundTo(outerDia, 3),
      cylinderLength: roundTo(cylLength, 3),
      domeHeight: roundTo(domeHeight, 3),
      totalLength: roundTo(totalLength, 3),
      wallThickness: roundTo(wallThick * 1000, 2), // mm
      tankPressure: roundTo(pressure, 0),
      shellMass: roundTo(shellMass, 1),
      totalMass: roundTo(totalMass, 1),
      material: materialName,
      safetyFactor: roundTo(safetyFactor, 2),
    };
  }

  const oxTank = sizeOneTank(oxVolumeTotal, oxDensity, tankPressure, "oxidizer");
  const fuelTank = sizeOneTank(fuelVolumeTotal, fuelDensity, tankPressure, "fuel");

  // Common bulkhead option (saves one dome worth of mass)
  const useCommonBulkhead = Math.random() > 0.5;
  let commonBulkheadSaving = 0;
  if (useCommonBulkhead) {
    // Save roughly one dome's shell mass
    const domeHeight = innerRadius / 1.2;
    const domeArea = 2 * Math.PI * innerRadius * domeHeight * 1.3;
    commonBulkheadSaving = domeArea * (oxTank.wallThickness / 1000) * mat.density * 0.5;
  }

  // Intertank or common-bulkhead structure
  const intertankMass = useCommonBulkhead
    ? 0
    : roundTo(Math.PI * outerDia * 0.5 * 0.003 * mat.density * 1.2, 1);  // short cylinder

  const totalStructuralMass = oxTank.totalMass + fuelTank.totalMass + intertankMass - commonBulkheadSaving;

  return {
    oxidizer: oxTank,
    fuel: fuelTank,
    oxidizerMass: roundTo(oxMass, 0),
    fuelMass: roundTo(fuelMass, 0),
    totalPropellantMass: roundTo(propMass, 0),
    commonBulkhead: useCommonBulkhead,
    intertankMass: roundTo(intertankMass, 1),
    totalStructuralMass: roundTo(totalStructuralMass, 1),
    commonBulkheadSaving: roundTo(commonBulkheadSaving, 1),
    totalLength: roundTo(oxTank.totalLength + fuelTank.totalLength + (useCommonBulkhead ? 0 : 0.5), 2),
    outerDiameter: roundTo(outerDia, 3),
    material: materialName,
    pressurization: isTankPressurized ? "autogenous_or_helium" : "helium_or_autogenous",
    tankPressure: roundTo(tankPressure / 1e5, 2), // bar
  };
}


// ============================================================================
// 10. STAGE GENERATION
// ============================================================================

/**
 * Generate a complete stage specification.
 *
 * @param {object} params
 *   .stageIndex    - 0 = first stage, 1 = second, etc.
 *   .totalStages   - total stage count
 *   .propellant    - propellant name
 *   .engineCycle   - cycle name
 *   .propMass      - propellant mass (kg)
 *   .numEngines    - number of engines
 *   .fairingDia    - vehicle diameter (m)
 *   .payloadAbove  - mass above this stage (kg)
 *   .maxAccelG     - max acceleration in g
 *   .tankMaterial  - material name
 * @returns {object} stage spec
 */
function generateStage(params) {
  const {
    stageIndex, totalStages, propellant, engineCycle,
    propMass, numEngines, fairingDia, payloadAbove,
    maxAccelG, tankMaterial,
  } = params;

  const isFirstStage = stageIndex === 0;
  const isUpperStage = stageIndex >= totalStages - 1;
  const role = isFirstStage ? "booster" : (isUpperStage ? "upper" : "sustainer");

  const prop = PROPELLANTS[propellant];

  // Target stage mass fraction (structural coefficient = dry / gross)
  // Lower stages: 0.05-0.08,  Upper stages: 0.07-0.12
  const structCoeffTarget = isFirstStage
    ? randRange(0.05, 0.08)
    : (isUpperStage ? randRange(0.07, 0.12) : randRange(0.06, 0.10));

  // Gross mass of this stage (prop + structure + engines + payload above)
  const grossTarget = propMass / (1 - structCoeffTarget);
  const dryTarget = grossTarget - propMass;

  // Desired burn time
  const burnTime = isFirstStage ? randRange(120, 200) : (isUpperStage ? randRange(300, 600) : randRange(150, 350));

  // Total thrust needed: lift (gross + payload)*g at ignition for first stage,
  // or provide needed delta-v for upper stages
  const totalMassAtIgnition = grossTarget + payloadAbove;
  const twrTarget = isFirstStage ? randRange(1.2, 1.6) : (isUpperStage ? randRange(0.5, 1.0) : randRange(0.9, 1.3));
  const totalThrust = totalMassAtIgnition * PHYS.g0 * twrTarget;
  const thrustPerEngine = totalThrust / numEngines;

  // Generate engines
  let engines;
  if (propellant === "SOLID") {
    const totalImpulse = totalThrust * burnTime;
    engines = generateSolidMotor(totalImpulse, role);
    // Override some fields for consistency
    engines.count = 1;  // solid stages are monolithic
  } else {
    engines = generateEngine(engineCycle, propellant, {
      thrustTarget: thrustPerEngine,
      role,
    });
  }

  // Actual thrust and Isp
  const actualTotalThrustVac = propellant === "SOLID"
    ? engines.thrustVac
    : engines.thrustVac * numEngines;
  const actualTotalThrustSL = propellant === "SOLID"
    ? engines.thrustSL
    : engines.thrustSL * numEngines;

  const ispVac = engines.ispVac;
  const ispSL = engines.ispSL;

  // Total engine mass
  const totalEngineMass = propellant === "SOLID"
    ? engines.dryMass
    : engines.dryMass * numEngines;

  // Size tanks (liquid stages only)
  let tanks = null;
  let tankStructMass = 0;
  if (propellant !== "SOLID") {
    const maxAccel = maxAccelG * PHYS.g0;
    tanks = sizeTanks(propMass, engines.mixtureRatio, prop, tankMaterial, maxAccel, engines.chamberPressure, fairingDia);
    tankStructMass = tanks.totalStructuralMass;
  }

  // Avionics, wiring, hydraulics, TVC, pressurant system
  const avionicsMass = isUpperStage ? randRange(80, 200) : randRange(150, 400);
  const tvsMass = engines.gimbalAngle > 0 ? numEngines * randRange(20, 60) : 0;

  // Pressurant (helium) mass: rough sizing
  // PV = nRT,  need to pressurize tanks throughout burn
  let pressurantMass = 0;
  if (propellant !== "SOLID" && tanks) {
    const totalTankVol = tanks.oxidizer.volume + tanks.fuel.volume;
    const pressurantPressure = tanks.tankPressure * 1e5; // convert back to Pa
    // Helium at 300 bar in COPV, expanded to tank pressure
    const copvPressure = 300e5;
    const R_He = 2077; // J/(kg*K)
    const T = 300;     // K (ambient temp helium)
    pressurantMass = pressurantPressure * totalTankVol / (R_He * T) * 1.3; // 30% margin
    const copvMass = pressurantMass * 1.5; // COPV mass
    pressurantMass += copvMass;
  }

  // Interstage: connects to stage above
  const interstageLength = fairingDia * randRange(0.15, 0.25);
  const interstageThick = 0.003; // 3mm skin
  const interstageMat = TANK_MATERIALS[tankMaterial];
  const interstageMass = stageIndex < totalStages - 1
    ? Math.PI * fairingDia * interstageLength * interstageThick * interstageMat.density * 1.3
    : 0;

  // Thrust structure
  const thrustStructMass = actualTotalThrustVac * 0.0008; // kg per N of thrust

  // Total dry mass
  const dryMass = totalEngineMass + tankStructMass + avionicsMass + tvsMass
    + pressurantMass + interstageMass + thrustStructMass;

  // Actual structural coefficient
  const grossMass = propMass + dryMass;
  const structuralCoefficient = dryMass / grossMass;

  // Mass fraction (propellant fraction)
  const massFraction = propMass / grossMass;

  // Stage delta-v (Tsiolkovsky)
  const ispForDv = isFirstStage ? lerp(ispSL, ispVac, 0.5) : ispVac;
  const deltaV_stage = ispForDv * PHYS.g0 * Math.log(
    (grossMass + payloadAbove) / (dryMass + payloadAbove)
  );

  // Actual burn time
  const avgThrust = isFirstStage ? (actualTotalThrustSL + actualTotalThrustVac) / 2 : actualTotalThrustVac;
  const avgIsp = isFirstStage ? (ispSL + ispVac) / 2 : ispVac;
  const actualBurnTime = propMass / (avgThrust / (avgIsp * PHYS.g0));

  // Max acceleration check
  const maxAccelActual = actualTotalThrustVac / (dryMass + payloadAbove);
  const maxAccelG_actual = maxAccelActual / PHYS.g0;

  // Engine-out capability
  const engineOutCapable = numEngines >= 2 && propellant !== "SOLID";
  const engineOutTWR = engineOutCapable
    ? (actualTotalThrustSL * (numEngines - 1) / numEngines) / (totalMassAtIgnition * PHYS.g0)
    : 0;

  // Thermal protection
  const thermalProtection = isFirstStage
    ? { type: "cork_or_spray_on_foam", mass: grossMass * 0.002 }
    : (isUpperStage ? { type: "MLI_blankets", mass: grossMass * 0.001 } : { type: "minimal", mass: 0 });

  return {
    stageIndex,
    role,
    designation: `Stage ${stageIndex + 1}`,

    // Propulsion
    engine: engines,
    engineCount: propellant === "SOLID" ? 1 : numEngines,
    propellant,
    engineCycle: propellant === "SOLID" ? "solid" : engineCycle,

    // Performance
    totalThrustSL: roundTo(actualTotalThrustSL, 0),
    totalThrustVac: roundTo(actualTotalThrustVac, 0),
    ispSL: roundTo(ispSL, 1),
    ispVac: roundTo(ispVac, 1),
    deltaV: roundTo(deltaV_stage, 1),
    burnTime: roundTo(actualBurnTime, 1),

    // Mass budget
    propellantMass: roundTo(propMass, 0),
    dryMass: roundTo(dryMass, 0),
    grossMass: roundTo(grossMass, 0),
    massBudget: {
      engines: roundTo(totalEngineMass, 0),
      tanks: roundTo(tankStructMass, 0),
      avionics: roundTo(avionicsMass, 0),
      tvc: roundTo(tvsMass, 0),
      pressurant: roundTo(pressurantMass, 0),
      interstage: roundTo(interstageMass, 0),
      thrustStructure: roundTo(thrustStructMass, 0),
      thermalProtection: roundTo(thermalProtection.mass, 0),
    },
    structuralCoefficient: roundTo(structuralCoefficient, 4),
    massFraction: roundTo(massFraction, 4),

    // Geometry
    tanks,
    diameter: roundTo(fairingDia, 2),
    stageLength: roundTo(
      (tanks ? tanks.totalLength : 0)
      + (engines.length || 2)
      + interstageLength,
      2
    ),

    // Dynamics
    twrIgnition: roundTo(actualTotalThrustSL / (totalMassAtIgnition * PHYS.g0), 3),
    twrBurnout: roundTo(actualTotalThrustVac / ((dryMass + payloadAbove) * PHYS.g0), 3),
    maxAccelG: roundTo(maxAccelG_actual, 2),

    // Capability
    engineOutCapable,
    engineOutTWR: roundTo(engineOutTWR, 3),
    gimbalAngle: engines.gimbalAngle,
    throttleable: engines.minThrottle < 1.0,
    minThrottle: engines.minThrottle,

    // Thermal
    thermalProtection,

    // Reliability
    stageReliability: roundTo(Math.pow(engines.reliability, propellant === "SOLID" ? 1 : numEngines), 5),
  };
}


// ============================================================================
// 11. FAIRING GENERATION
// ============================================================================

/**
 * Generate a payload fairing specification.
 *
 * @param {number} diameter   - outer diameter (m)
 * @param {number} payloadMass- payload mass for volume estimate (kg)
 * @returns {object}
 */
function generateFairing(diameter, payloadMass) {
  // Fairing length typically 1.5-3x diameter
  const lengthRatio = randRange(1.8, 3.0);
  const totalLength = diameter * lengthRatio;
  const noseLength = diameter * randRange(0.6, 1.2);
  const cylinderLength = totalLength - noseLength;

  // Usable volume: roughly 80% of geometric volume
  const geoVolume = Math.PI * (diameter / 2) ** 2 * cylinderLength
    + (1 / 3) * Math.PI * (diameter / 2) ** 2 * noseLength;
  const usableVolume = geoVolume * 0.80;

  // Fairing mass: composite sandwich construction
  // Approximately 30-50 kg/m^2 of surface area
  const surfaceArea = Math.PI * diameter * cylinderLength
    + Math.PI * (diameter / 2) * Math.sqrt((diameter / 2) ** 2 + noseLength ** 2); // cone
  const arealDensity = randRange(30, 50); // kg/m^2
  const fairingMass = surfaceArea * arealDensity / 2; // two halves, shared wall

  // Acoustic blankets
  const acousticBlanketMass = surfaceArea * 2.0; // ~2 kg/m^2

  return {
    diameter: roundTo(diameter, 2),
    totalLength: roundTo(totalLength, 2),
    noseLength: roundTo(noseLength, 2),
    cylinderLength: roundTo(cylinderLength, 2),
    usableVolume: roundTo(usableVolume, 1),
    mass: roundTo(fairingMass + acousticBlanketMass, 0),
    halfShellMass: roundTo((fairingMass + acousticBlanketMass) / 2, 0),
    construction: "composite_sandwich",
    noseShape: randChoice(["ogive", "bi-conic", "Von_Karman"]),
    separationSystem: randChoice(["pyrotechnic_linear", "pneumatic_push"]),
    jettisonAltitude: randRange(90e3, 130e3), // m
    jettisonDynamicPressure: 0, // jettisoned after max-q
    acousticEnvironment: {
      maxSPL: randRange(130, 140), // dB
      blankets: true,
    },
  };
}


// ============================================================================
// 12. FLIGHT PROFILE ESTIMATOR
// ============================================================================

/**
 * Estimate a simplified flight profile for trajectory simulation initialization.
 *
 * @param {Array} stages     - array of stage specs (ordered 0 = first)
 * @param {number} latitude  - launch latitude (degrees)
 * @param {object} orbit     - orbit class object
 * @returns {object}
 */
function estimateFlightProfile(stages, latitude, orbit, targetAlt) {
  const latRad = latitude * Math.PI / 180;
  const earthRotationBoost = PHYS.omega_earth * PHYS.R_earth * Math.cos(latRad);

  // Pitch program: gravity turn approximation
  // Pitch kick at ~10s, gravity turn until orbit insertion
  const pitchKickTime = randRange(8, 15);     // s
  const pitchKickAngle = randRange(2, 5);     // degrees from vertical

  // Max-Q estimate
  const firstStage = stages[0];
  const liftoffMass = stages.reduce((s, st) => s + st.grossMass, 0);
  // Very rough max-Q: occurs around Mach 1-1.5, altitude ~10-14 km
  const maxQAltitude = randRange(10e3, 14e3);
  const maxQVelocity = randRange(300, 450);   // m/s
  // q = 0.5 * rho * v^2,  rho at ~12km ~ 0.3 kg/m^3
  const rhoAtMaxQ = 0.3;
  const maxQ = 0.5 * rhoAtMaxQ * maxQVelocity * maxQVelocity;

  // MECO conditions (first stage burnout)
  const mecoTime = firstStage.burnTime;
  const mecoAltitude = randRange(50e3, 80e3);
  const mecoVelocity = firstStage.deltaV * 0.7 + earthRotationBoost;

  // Staging events
  const events = [];
  let tCum = 0;
  for (let i = 0; i < stages.length; i++) {
    events.push({
      event: i === 0 ? "liftoff" : `stage_${i}_ignition`,
      time: roundTo(tCum + (i > 0 ? 3 : 0), 1), // 3s coast between stages
      altitude: i === 0 ? 0 : roundTo(mecoAltitude + 20e3 * i, 0),
    });
    tCum += stages[i].burnTime + (i > 0 ? 3 : 0);
    if (i < stages.length - 1) {
      events.push({
        event: `stage_${i + 1}_separation`,
        time: roundTo(tCum, 1),
        altitude: roundTo(mecoAltitude + 20e3 * (i + 1), 0),
      });
    }
  }
  events.push({
    event: "orbit_insertion",
    time: roundTo(tCum, 1),
    altitude: roundTo(targetAlt, 0),
  });

  return {
    launchLatitude: latitude,
    launchAzimuth: roundTo(
      orbit.inclination != null
        ? Math.asin(Math.cos(orbit.inclination * Math.PI / 180) / Math.cos(latRad)) * 180 / Math.PI
        : 90, // due east
      1
    ),
    earthRotationBoost: roundTo(earthRotationBoost, 1),
    pitchProgram: {
      verticalRiseTime: pitchKickTime,
      pitchKickAngle,
      type: "gravity_turn",
    },
    maxQ: {
      value: roundTo(maxQ, 0),
      altitude: roundTo(maxQAltitude, 0),
      velocity: roundTo(maxQVelocity, 0),
    },
    mecoConditions: {
      time: roundTo(mecoTime, 1),
      altitude: roundTo(mecoAltitude, 0),
      velocity: roundTo(mecoVelocity, 0),
    },
    events,
    totalFlightTime: roundTo(tCum, 1),
  };
}


// ============================================================================
// 13. CONSTRAINT SATISFACTION & VALIDATION
// ============================================================================

/**
 * Validate and correct a full rocket specification for physical consistency.
 * Returns an object with the corrected spec and a list of warnings.
 *
 * @param {object} rocket - full rocket spec
 * @returns {{ rocket: object, warnings: string[], valid: boolean }}
 */
function validateRocket(rocket) {
  const warnings = [];
  let valid = true;

  // 1. Total delta-v check
  const totalDv = rocket.stages.reduce((s, st) => s + st.deltaV, 0);
  if (totalDv < rocket.mission.requiredDeltaV * 0.95) {
    warnings.push(
      `Insufficient delta-v: ${roundTo(totalDv, 0)} m/s vs required ${roundTo(rocket.mission.requiredDeltaV, 0)} m/s (${roundTo(totalDv / rocket.mission.requiredDeltaV * 100, 1)}%)`
    );
    valid = false;
  }
  if (totalDv > rocket.mission.requiredDeltaV * 1.30) {
    warnings.push(
      `Excessive delta-v margin: ${roundTo((totalDv / rocket.mission.requiredDeltaV - 1) * 100, 1)}% above required`
    );
  }

  // 2. First stage TWR > 1.0
  const s1 = rocket.stages[0];
  const liftoffMass = rocket.totalMass;
  const liftoffTWR = s1.totalThrustSL / (liftoffMass * PHYS.g0);
  if (liftoffTWR < 1.05) {
    warnings.push(`Liftoff TWR dangerously low: ${roundTo(liftoffTWR, 3)} (need > 1.05)`);
    valid = false;
  }
  if (liftoffTWR > 2.5) {
    warnings.push(`Liftoff TWR very high: ${roundTo(liftoffTWR, 3)} (structural concerns)`);
  }

  // 3. Max acceleration check on each stage
  for (const stage of rocket.stages) {
    if (stage.maxAccelG > 8.0) {
      warnings.push(`Stage ${stage.stageIndex + 1} max acceleration ${stage.maxAccelG}g exceeds 8g limit`);
      valid = false;
    }
  }

  // 4. Structural coefficient sanity
  for (const stage of rocket.stages) {
    if (stage.structuralCoefficient > 0.20) {
      warnings.push(`Stage ${stage.stageIndex + 1} structural coefficient ${stage.structuralCoefficient} is unrealistically high`);
    }
    if (stage.structuralCoefficient < 0.03) {
      warnings.push(`Stage ${stage.stageIndex + 1} structural coefficient ${stage.structuralCoefficient} is unrealistically low`);
    }
  }

  // 5. Propellant compatibility with engine cycle
  for (const stage of rocket.stages) {
    const cycle = ENGINE_CYCLES[stage.engineCycle];
    if (cycle && !cycle.compatiblePropellants.includes(stage.propellant)) {
      warnings.push(`Stage ${stage.stageIndex + 1}: ${stage.engineCycle} incompatible with ${stage.propellant}`);
      valid = false;
    }
  }

  // 6. Diameter consistency
  const diameters = rocket.stages.map(s => s.diameter);
  for (let i = 1; i < diameters.length; i++) {
    if (diameters[i] > diameters[i - 1] * 1.05) {
      warnings.push(`Stage ${i + 1} wider than stage ${i} (${diameters[i]}m > ${diameters[i - 1]}m)`);
    }
  }

  // 7. Overall reliability
  if (rocket.reliability.missionSuccess < 0.85) {
    warnings.push(`Low mission reliability: ${roundTo(rocket.reliability.missionSuccess * 100, 1)}%`);
  }

  // 8. Mass sanity: payload should be 1-5% of liftoff mass for most orbital rockets
  const payloadFraction = rocket.payload.mass / rocket.totalMass;
  if (payloadFraction < 0.005) {
    warnings.push(`Very low payload fraction: ${roundTo(payloadFraction * 100, 2)}%`);
  }
  if (payloadFraction > 0.08) {
    warnings.push(`Unusually high payload fraction: ${roundTo(payloadFraction * 100, 2)}% (check mass budget)`);
  }

  return { rocket, warnings, valid, totalDeltaV: roundTo(totalDv, 0) };
}


// ============================================================================
// 14. DESIGN STRATEGY SELECTION
// ============================================================================

/**
 * Choose a coherent design strategy (propellants, cycles, staging)
 * based on mission requirements and random architectural variation.
 *
 * @param {string} orbitClass   - orbit class key
 * @param {number} payloadMass  - desired payload (kg)
 * @param {number} latitude     - launch latitude (deg)
 * @returns {object} design strategy
 */
function selectDesignStrategy(orbitClass, payloadMass, latitude) {
  const orbit = ORBIT_CLASSES[orbitClass];
  const requiredDv = orbit.totalDeltaV
    ? orbit.totalDeltaV(orbit.defaultAltitude, latitude)
    : 9500;

  // Heavier payloads / higher orbits -> more stages, bigger vehicle
  const difficultyFactor = (requiredDv / 9400) * Math.sqrt(payloadMass / 5000);

  // Architecture families
  const architectures = [
    {
      name: "kerolox_workhorse",
      stages: [
        { propellant: "LOX/RP-1", cycle: "gas-generator" },
        { propellant: "LOX/RP-1", cycle: "gas-generator" },
      ],
      weight: difficultyFactor < 1.5 ? 3 : 1,
      stageCount: 2,
    },
    {
      name: "kerolox_staged_combustion",
      stages: [
        { propellant: "LOX/RP-1", cycle: "staged-combustion" },
        { propellant: "LOX/RP-1", cycle: "staged-combustion" },
      ],
      weight: 2,
      stageCount: 2,
    },
    {
      name: "methalox_modern",
      stages: [
        { propellant: "LOX/CH4", cycle: "staged-combustion" },
        { propellant: "LOX/CH4", cycle: "gas-generator" },
      ],
      weight: 3,
      stageCount: 2,
    },
    {
      name: "methalox_electric",
      stages: [
        { propellant: "LOX/CH4", cycle: "electric-pump-fed" },
        { propellant: "LOX/CH4", cycle: "electric-pump-fed" },
      ],
      weight: payloadMass < 2000 ? 3 : 1,
      stageCount: 2,
    },
    {
      name: "hydrolox_upper",
      stages: [
        { propellant: "LOX/RP-1", cycle: "gas-generator" },
        { propellant: "LOX/LH2", cycle: "expander" },
      ],
      weight: 2,
      stageCount: 2,
    },
    {
      name: "full_hydrolox",
      stages: [
        { propellant: "LOX/LH2", cycle: "staged-combustion" },
        { propellant: "LOX/LH2", cycle: "expander" },
      ],
      weight: difficultyFactor > 1.2 ? 2 : 1,
      stageCount: 2,
    },
    {
      name: "three_stage_heavy",
      stages: [
        { propellant: "LOX/RP-1", cycle: "gas-generator" },
        { propellant: "LOX/RP-1", cycle: "gas-generator" },
        { propellant: "LOX/LH2", cycle: "expander" },
      ],
      weight: difficultyFactor > 1.5 ? 3 : 0.5,
      stageCount: 3,
    },
    {
      name: "three_stage_methalox",
      stages: [
        { propellant: "LOX/CH4", cycle: "staged-combustion" },
        { propellant: "LOX/CH4", cycle: "gas-generator" },
        { propellant: "LOX/CH4", cycle: "gas-generator" },
      ],
      weight: difficultyFactor > 1.3 ? 2 : 0.5,
      stageCount: 3,
    },
    {
      name: "storable_hypergolic",
      stages: [
        { propellant: "N2O4/UDMH", cycle: "pressure-fed" },
        { propellant: "N2O4/UDMH", cycle: "pressure-fed" },
      ],
      weight: 1,
      stageCount: 2,
    },
    {
      name: "pressure_fed_small",
      stages: [
        { propellant: "LOX/RP-1", cycle: "pressure-fed" },
        { propellant: "LOX/RP-1", cycle: "pressure-fed" },
      ],
      weight: payloadMass < 500 ? 4 : 0.5,
      stageCount: 2,
    },
    {
      name: "four_stage_smallsat",
      stages: [
        { propellant: "SOLID", cycle: "solid" },
        { propellant: "SOLID", cycle: "solid" },
        { propellant: "SOLID", cycle: "solid" },
        { propellant: "LOX/RP-1", cycle: "pressure-fed" },
      ],
      weight: payloadMass < 300 ? 3 : 0.2,
      stageCount: 4,
    },
  ];

  const arch = weightedChoice(
    architectures,
    architectures.map(a => a.weight)
  );

  // Decide on strap-on boosters
  let boosters = null;
  const needsBoosters = difficultyFactor > 1.3 && Math.random() > 0.4;
  if (needsBoosters) {
    const boosterType = weightedChoice(
      ["SOLID", "LOX/RP-1", "LOX/CH4"],
      [4, 2, 1]
    );
    const boosterCount = weightedChoice([2, 4], [3, 1]);
    boosters = {
      propellant: boosterType,
      count: boosterCount,
      cycle: boosterType === "SOLID" ? "solid" : "gas-generator",
    };
  }

  // Fairing diameter: scales with payload mass
  const fairingDia = clamp(
    1.5 + Math.pow(payloadMass, 0.33) * 0.15,
    2.0, 10.0
  );

  // Tank material selection
  const materialCandidates = Object.keys(TANK_MATERIALS).filter(m => {
    const mat = TANK_MATERIALS[m];
    return arch.stages.every(s => mat.compatiblePropellants.includes(s.propellant) || s.propellant === "SOLID");
  });
  const tankMaterial = materialCandidates.length > 0
    ? randChoice(materialCandidates)
    : "Steel_304L";

  // Engine counts per stage
  const engineCounts = arch.stages.map((s, i) => {
    if (s.propellant === "SOLID") return 1;
    if (i === 0) {
      // First stage: more engines for larger vehicles
      const base = payloadMass > 10000 ? randRange(5, 33) :
        payloadMass > 2000 ? randRange(3, 9) :
          randRange(1, 5);
      return Math.round(base);
    }
    if (i === arch.stageCount - 1) {
      // Upper stage: fewer engines
      return weightedChoice([1, 2, 3], [5, 2, 1]);
    }
    return weightedChoice([1, 2, 3, 4, 5], [2, 3, 2, 1, 0.5]);
  });

  return {
    architecture: arch,
    requiredDv,
    difficultyFactor: roundTo(difficultyFactor, 3),
    boosters,
    fairingDia: roundTo(fairingDia, 2),
    tankMaterial,
    engineCounts,
    orbitClass,
    targetAltitude: orbit.defaultAltitude,
  };
}


// ============================================================================
// 15. PROPELLANT MASS ALLOCATION
// ============================================================================

/**
 * Allocate propellant mass to each stage using the ideal staging
 * (Lagrange multiplier) approach, then adjust for real-world constraints.
 *
 * @param {number} requiredDv    - total required delta-v (m/s)
 * @param {number} payloadMass   - payload mass (kg)
 * @param {Array}  stageConfigs  - array of { propellant, cycle, ispVac_est }
 * @param {number} numStages     - number of stages
 * @returns {Array} propellant masses per stage
 */
function allocatePropellant(requiredDv, payloadMass, stageConfigs, numStages) {
  // Estimate Isp for each stage based on propellant and cycle
  const ispEstimates = stageConfigs.map((cfg, i) => {
    const prop = PROPELLANTS[cfg.propellant];
    const cycle = ENGINE_CYCLES[cfg.cycle];
    const eff = (cycle.ispEfficiency[0] + cycle.ispEfficiency[1]) / 2;
    const ispVac = prop.ispVacTheoretical * eff;
    // First stage uses a blend of SL and vac
    return i === 0 ? lerp(prop.ispSlTheoretical * eff, ispVac, 0.45) : ispVac;
  });

  // Structural coefficient estimates
  const structCoeffs = stageConfigs.map((_, i) => {
    return i === 0 ? 0.07 : (i === numStages - 1 ? 0.10 : 0.08);
  });

  // Use iterative approach: start with equal delta-v split, then optimize
  let dvSplit = new Array(numStages);

  // Initial split: proportional to 1/Isp (lower Isp stages get less dv ideally,
  // but in practice we want to give more dv to higher Isp stages)
  const ispSum = ispEstimates.reduce((s, v) => s + v, 0);
  for (let i = 0; i < numStages; i++) {
    dvSplit[i] = requiredDv * (ispEstimates[i] / ispSum);
  }

  // Normalize
  const dvTotal = dvSplit.reduce((s, v) => s + v, 0);
  dvSplit = dvSplit.map(v => v * requiredDv / dvTotal);

  // Add 5% margin
  dvSplit = dvSplit.map(v => v * 1.05);

  // Convert delta-v to mass ratios, then to propellant masses
  // Work from top stage down
  const propMasses = new Array(numStages);
  let payloadAbove = payloadMass;

  for (let i = numStages - 1; i >= 0; i--) {
    const ve = ispEstimates[i] * PHYS.g0;
    const massRatio = Math.exp(dvSplit[i] / ve);
    const eps = structCoeffs[i];

    // m0/mf = massRatio,  m0 = mp + ms + payload,  mf = ms + payload
    // ms = eps * (mp + ms) => ms = eps/(1-eps) * mp
    // m0 = mp + eps/(1-eps)*mp + payload = mp*(1/(1-eps)) + payload
    // mf = eps/(1-eps)*mp + payload
    // massRatio = (mp/(1-eps) + payload) / (eps/(1-eps)*mp + payload)

    // Solve for mp:
    // massRatio * (eps*mp/(1-eps) + payload) = mp/(1-eps) + payload
    // massRatio * eps*mp/(1-eps) + massRatio*payload = mp/(1-eps) + payload
    // mp/(1-eps) * (1 - massRatio*eps) = payload*(massRatio - 1)
    // mp = payload*(massRatio - 1)*(1-eps) / (1 - massRatio*eps)

    const denom = 1 - massRatio * eps;
    if (denom <= 0) {
      // Mass ratio too aggressive for this structural coefficient
      // Fall back to a reasonable propellant mass
      propMasses[i] = payloadAbove * 4;
    } else {
      propMasses[i] = payloadAbove * (massRatio - 1) * (1 - eps) / denom;
    }

    // Minimum propellant mass sanity
    propMasses[i] = Math.max(propMasses[i], 500);

    // Add this stage's mass as payload for the stage below
    const stageDryMass = propMasses[i] * eps / (1 - eps);
    payloadAbove += propMasses[i] + stageDryMass;
  }

  return propMasses.map(m => roundTo(m, 0));
}


// ============================================================================
// 16. BOOSTER GENERATION
// ============================================================================

/**
 * Generate strap-on boosters.
 *
 * @param {object} boosterConfig - { propellant, count, cycle }
 * @param {number} firstStageMass - first stage gross mass (for sizing)
 * @param {number} fairingDia     - core vehicle diameter
 * @returns {object}
 */
function generateBoosters(boosterConfig, firstStageMass, fairingDia) {
  const { propellant, count, cycle } = boosterConfig;

  // Each booster provides ~20-40% of the first stage thrust
  const boosterThrustFraction = randRange(0.2, 0.4);
  const totalBoosterThrust = firstStageMass * PHYS.g0 * 1.3 * boosterThrustFraction;
  const thrustPerBooster = totalBoosterThrust / count;

  // Booster diameter: 20-60% of core diameter
  const boosterDia = fairingDia * randRange(0.2, 0.6);

  if (propellant === "SOLID") {
    // Total impulse: thrust * burn_time
    const burnTime = randRange(60, 120);
    const totalImpulsePerBooster = thrustPerBooster * burnTime;
    const motor = generateSolidMotor(totalImpulsePerBooster, "booster");

    return {
      type: "solid",
      count,
      motor,
      thrustPerBooster: motor.thrustVac,
      totalThrust: motor.thrustVac * count,
      totalThrustSL: motor.thrustSL * count,
      burnTime: motor.burnTime,
      propellantMassEach: motor.propellantMass,
      dryMassEach: motor.dryMass,
      totalMassEach: motor.totalMass,
      totalMassAll: motor.totalMass * count,
      diameter: roundTo(boosterDia, 2),
      length: roundTo(motor.grainGeometry.length * 1.3, 2),
      separationTime: motor.burnTime + randRange(1, 3),
      separationMethod: randChoice(["pyrotechnic", "pneumatic_push", "retro_rockets"]),
      noseCone: true,
    };
  } else {
    // Liquid booster
    const prop = PROPELLANTS[propellant];
    const engine = generateEngine(cycle, propellant, {
      thrustTarget: thrustPerBooster,
      role: "booster",
    });

    const burnTime = randRange(100, 180);
    const propMassEach = engine.massFlowRate * burnTime;
    const tankMat = randChoice(["Al-Li_2195", "Steel_304L"]);
    const tanks = sizeTanks(propMassEach, engine.mixtureRatio, prop, tankMat, 5 * PHYS.g0, engine.chamberPressure, boosterDia);

    const dryMassEach = engine.dryMass + tanks.totalStructuralMass + 200; // +200 for structure

    return {
      type: "liquid",
      count,
      engine,
      engineCount: 1,
      thrustPerBooster: engine.thrustVac,
      totalThrust: engine.thrustVac * count,
      totalThrustSL: engine.thrustSL * count,
      burnTime: roundTo(burnTime, 1),
      propellantMassEach: roundTo(propMassEach, 0),
      dryMassEach: roundTo(dryMassEach, 0),
      totalMassEach: roundTo(propMassEach + dryMassEach, 0),
      totalMassAll: roundTo((propMassEach + dryMassEach) * count, 0),
      tanks,
      diameter: roundTo(boosterDia, 2),
      length: roundTo(tanks.totalLength + engine.length + 1, 2),
      separationTime: roundTo(burnTime + randRange(1, 3), 1),
      separationMethod: randChoice(["pyrotechnic", "pneumatic_push"]),
      noseCone: true,
      propellant,
    };
  }
}


// ============================================================================
// 17. MASTER GENERATION FUNCTION
// ============================================================================

/**
 * Generate a complete, physically-consistent orbital rocket specification.
 *
 * @param {number} latitude           - launch site latitude in degrees (-90 to 90)
 * @param {string} targetOrbitClass   - key into ORBIT_CLASSES: "LEO","SSO","MEO","GTO","GEO","Escape"
 * @param {object} [options]          - optional overrides
 *   .payloadMass   {number}  - desired payload mass in kg (default: random 500-20000)
 *   .stageCount    {number}  - force stage count (1-4)
 *   .propellant    {string}  - force propellant for all liquid stages
 *   .engineCycle   {string}  - force engine cycle
 *   .fairingDia    {number}  - force fairing diameter (m)
 *   .tankMaterial  {string}  - force tank material
 *   .seed          {number}  - random seed (not implemented - placeholder)
 * @returns {object} complete rocket specification
 */
function generateRocket(latitude, targetOrbitClass, options = {}) {
  // ---- 0. Validate inputs ----
  latitude = clamp(latitude, -90, 90);
  if (!ORBIT_CLASSES[targetOrbitClass]) {
    throw new Error(`Unknown orbit class "${targetOrbitClass}". Valid: ${Object.keys(ORBIT_CLASSES).join(", ")}`);
  }

  // ---- 1. Mission parameters ----
  const payloadMass = options.payloadMass || Math.round(randRange(500, 20000));
  const orbit = ORBIT_CLASSES[targetOrbitClass];
  const targetAltitude = options.altitude || orbit.defaultAltitude;
  const requiredDeltaV = orbit.totalDeltaV(targetAltitude, latitude);

  // ---- 2. Design strategy ----
  const strategy = selectDesignStrategy(targetOrbitClass, payloadMass, latitude);

  // Apply overrides
  if (options.stageCount) {
    // Truncate or extend architecture
    while (strategy.architecture.stages.length > options.stageCount) strategy.architecture.stages.pop();
    while (strategy.architecture.stages.length < options.stageCount) {
      strategy.architecture.stages.push(
        strategy.architecture.stages[strategy.architecture.stages.length - 1]
      );
    }
    strategy.architecture.stageCount = options.stageCount;
  }
  if (options.propellant) {
    strategy.architecture.stages.forEach(s => {
      if (s.propellant !== "SOLID") s.propellant = options.propellant;
    });
  }
  if (options.engineCycle) {
    strategy.architecture.stages.forEach(s => {
      if (s.cycle !== "solid") s.cycle = options.engineCycle;
    });
  }
  if (options.fairingDia) strategy.fairingDia = options.fairingDia;
  if (options.tankMaterial) strategy.tankMaterial = options.tankMaterial;

  const numStages = strategy.architecture.stageCount;
  const stageConfigs = strategy.architecture.stages;
  const engineCounts = options.stageCount
    ? stageConfigs.map((s, i) => {
      if (s.propellant === "SOLID") return 1;
      return i === 0 ? Math.round(randRange(1, 9)) : weightedChoice([1, 2, 3], [5, 2, 1]);
    })
    : strategy.engineCounts;

  // ---- 3. Propellant allocation ----
  const propMasses = allocatePropellant(requiredDeltaV, payloadMass, stageConfigs, numStages);

  // ---- 4. Generate each stage ----
  const stages = [];
  let payloadAbove = payloadMass;

  // Generate from top to bottom first for payload stacking, then reverse
  const stageSpecs = [];
  for (let i = numStages - 1; i >= 0; i--) {
    const maxAccelG = i === 0 ? randRange(3, 6) : randRange(4, 8);
    const stage = generateStage({
      stageIndex: i,
      totalStages: numStages,
      propellant: stageConfigs[i].propellant,
      engineCycle: stageConfigs[i].cycle,
      propMass: propMasses[i],
      numEngines: engineCounts[i],
      fairingDia: strategy.fairingDia,
      payloadAbove,
      maxAccelG,
      tankMaterial: strategy.tankMaterial,
    });
    stageSpecs.unshift(stage);
    payloadAbove += stage.grossMass;
  }

  // ---- 5. Generate boosters (if any) ----
  let boosters = null;
  if (strategy.boosters) {
    const firstStageGross = stageSpecs[0].grossMass + stageSpecs.slice(1).reduce((s, st) => s + st.grossMass, 0) + payloadMass;
    boosters = generateBoosters(strategy.boosters, firstStageGross, strategy.fairingDia);
  }

  // ---- 6. Generate fairing ----
  const fairing = generateFairing(strategy.fairingDia, payloadMass);

  // ---- 7. Compute totals ----
  const totalDryMass = stageSpecs.reduce((s, st) => s + st.dryMass, 0);
  const totalPropMass = stageSpecs.reduce((s, st) => s + st.propellantMass, 0);
  const boosterMass = boosters ? boosters.totalMassAll : 0;
  const totalMass = totalDryMass + totalPropMass + payloadMass + fairing.mass + boosterMass;

  const totalDeltaV = stageSpecs.reduce((s, st) => s + st.deltaV, 0);

  // Total length
  const totalLength = stageSpecs.reduce((s, st) => s + st.stageLength, 0) + fairing.totalLength;

  // Reliability: product of all stage reliabilities
  let missionReliability = stageSpecs.reduce((p, st) => p * st.stageReliability, 1.0);
  if (boosters) {
    const boosterRel = boosters.motor
      ? Math.pow(boosters.motor.reliability || 0.996, boosters.count)
      : Math.pow(boosters.engine ? boosters.engine.reliability : 0.993, boosters.count);
    missionReliability *= boosterRel;
  }
  // Fairing separation reliability
  missionReliability *= 0.999;

  // ---- 8. Flight profile ----
  const flightProfile = estimateFlightProfile(stageSpecs, latitude, orbit, targetAltitude);

  // ---- 9. Assemble final rocket object ----
  const rocket = {
    // Identification
    id: `RKT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    generatedAt: new Date().toISOString(),

    // Mission
    mission: {
      orbitClass: targetOrbitClass,
      targetAltitude: roundTo(targetAltitude, 0),
      requiredDeltaV: roundTo(requiredDeltaV, 0),
      achievedDeltaV: roundTo(totalDeltaV, 0),
      deltaVMargin: roundTo((totalDeltaV / requiredDeltaV - 1) * 100, 1), // %
      launchLatitude: latitude,
      inclination: orbit.inclination != null
        ? orbit.inclination
        : Math.max(Math.abs(latitude), 0),
    },

    // Design
    designStrategy: {
      architecture: strategy.architecture.name,
      tankMaterial: strategy.tankMaterial,
      fairingDiameter: strategy.fairingDia,
      difficultyFactor: strategy.difficultyFactor,
    },

    // Payload
    payload: {
      mass: payloadMass,
      fairingDiameter: fairing.diameter,
      fairingUsableVolume: fairing.usableVolume,
    },

    // Stages
    stages: stageSpecs,
    stageCount: numStages,

    // Boosters
    boosters,

    // Fairing
    fairing,

    // Totals
    totalMass: roundTo(totalMass, 0),
    totalDryMass: roundTo(totalDryMass + fairing.mass + boosterMass, 0),
    totalPropellantMass: roundTo(totalPropMass + (boosters ? boosters.count * (boosters.propellantMassEach || 0) : 0), 0),
    totalLength: roundTo(totalLength, 1),
    maxDiameter: roundTo(strategy.fairingDia, 2),

    // Performance summary
    performance: {
      liftoffThrust: roundTo(
        stageSpecs[0].totalThrustSL + (boosters ? boosters.totalThrustSL : 0), 0
      ),
      liftoffTWR: roundTo(
        (stageSpecs[0].totalThrustSL + (boosters ? boosters.totalThrustSL : 0)) / (totalMass * PHYS.g0), 3
      ),
      payloadToOrbit: payloadMass,
      payloadFraction: roundTo(payloadMass / totalMass * 100, 2), // %
    },

    // Reliability
    reliability: {
      missionSuccess: roundTo(missionReliability, 5),
      stageReliabilities: stageSpecs.map(s => s.stageReliability),
    },

    // Flight profile
    flightProfile,

    // Simulation interface: provides everything a trajectory sim needs
    simulationParams: {
      // Initial conditions
      launchLatitude: latitude * Math.PI / 180,
      launchLongitude: 0, // user should set
      launchAzimuth: flightProfile.launchAzimuth * Math.PI / 180,
      initialMass: totalMass,

      // Per-stage data for simulation stepping
      stageSequence: stageSpecs.map((st, i) => ({
        stageIndex: i,
        ignitionTime: flightProfile.events.find(e => e.event.includes(`stage_${i}`) || (i === 0 && e.event === "liftoff"))?.time || 0,
        burnTime: st.burnTime,
        thrustVac: st.totalThrustVac,
        thrustSL: st.totalThrustSL,
        ispVac: st.ispVac,
        ispSL: st.ispSL,
        propellantMass: st.propellantMass,
        dryMass: st.dryMass,
        massFlowRate: st.propellantMass / st.burnTime,
        gimbalLimit: st.gimbalAngle * Math.PI / 180,
        throttleMin: st.minThrottle,
        throttleMax: 1.0,
        maxAccelG: st.maxAccelG,
      })),

      boosterSequence: boosters ? {
        count: boosters.count,
        ignitionTime: 0,
        burnTime: boosters.burnTime,
        thrustVacEach: boosters.thrustPerBooster,
        thrustSLEach: boosters.type === "solid" ? boosters.motor.thrustSL : boosters.engine.thrustSL,
        propellantMassEach: boosters.propellantMassEach,
        dryMassEach: boosters.dryMassEach,
        separationTime: boosters.separationTime,
      } : null,

      fairingJettisonAltitude: fairing.jettisonAltitude,
      fairingMass: fairing.mass,

      // Aerodynamic reference
      referenceArea: Math.PI * (strategy.fairingDia / 2) ** 2,
      dragCoefficient: {
        subsonic: 0.3,
        transonic: 0.5,
        supersonic: 0.25,
        hypersonic: 0.15,
      },
    },
  };

  // ---- 10. Validate ----
  const validation = validateRocket(rocket);
  rocket.validation = {
    valid: validation.valid,
    warnings: validation.warnings,
    totalDeltaV: validation.totalDeltaV,
  };

  return rocket;
}


// ============================================================================
// 18. DELTA-V CALCULATOR (standalone, for external use)
// ============================================================================

/**
 * Calculate delta-v for a given stage using the Tsiolkovsky rocket equation.
 *
 * @param {number} isp          - specific impulse (s)
 * @param {number} m0           - initial mass (kg) including payload
 * @param {number} mf           - final mass (kg) including payload (= m0 - propellant)
 * @returns {number} delta-v in m/s
 */
function tsiolkovsky(isp, m0, mf) {
  if (mf <= 0 || m0 <= mf) return 0;
  return isp * PHYS.g0 * Math.log(m0 / mf);
}

/**
 * Calculate total delta-v for a complete vehicle.
 *
 * @param {Array} stages - array of { ispVac, propellantMass, dryMass }
 * @param {number} payloadMass
 * @returns {{ perStage: number[], total: number }}
 */
function calculateTotalDeltaV(stages, payloadMass) {
  const perStage = [];
  let payloadAbove = payloadMass;

  for (let i = stages.length - 1; i >= 0; i--) {
    const st = stages[i];
    const m0 = st.propellantMass + st.dryMass + payloadAbove;
    const mf = st.dryMass + payloadAbove;
    const dv = tsiolkovsky(st.ispVac, m0, mf);
    perStage.unshift(roundTo(dv, 1));
    payloadAbove += st.propellantMass + st.dryMass;
  }

  return {
    perStage,
    total: roundTo(perStage.reduce((s, v) => s + v, 0), 1),
  };
}


// ============================================================================
// 19. ATMOSPHERE MODEL (for trajectory simulation)
// ============================================================================

/**
 * US Standard Atmosphere 1976 (simplified piecewise).
 * Returns density, pressure, temperature, speed of sound at altitude h (m).
 *
 * @param {number} h - geometric altitude (m)
 * @returns {{ rho: number, P: number, T: number, a: number }}
 */
function atmosphere(h) {
  h = Math.max(h, 0);

  let T, P, rho;

  if (h <= 11000) {
    // Troposphere
    const lapseRate = -0.0065; // K/m
    T = 288.15 + lapseRate * h;
    P = 101325 * Math.pow(T / 288.15, -PHYS.g0 / (lapseRate * PHYS.R_air));
  } else if (h <= 20000) {
    // Lower stratosphere (isothermal)
    T = 216.65;
    P = 22632.1 * Math.exp(-PHYS.g0 * (h - 11000) / (PHYS.R_air * T));
  } else if (h <= 32000) {
    const lapseRate = 0.001;
    T = 216.65 + lapseRate * (h - 20000);
    P = 5474.89 * Math.pow(T / 216.65, -PHYS.g0 / (lapseRate * PHYS.R_air));
  } else if (h <= 47000) {
    const lapseRate = 0.0028;
    T = 228.65 + lapseRate * (h - 32000);
    P = 868.019 * Math.pow(T / 228.65, -PHYS.g0 / (lapseRate * PHYS.R_air));
  } else if (h <= 51000) {
    T = 270.65;
    P = 110.906 * Math.exp(-PHYS.g0 * (h - 47000) / (PHYS.R_air * T));
  } else if (h <= 71000) {
    const lapseRate = -0.0028;
    T = 270.65 + lapseRate * (h - 51000);
    P = 66.9389 * Math.pow(T / 270.65, -PHYS.g0 / (lapseRate * PHYS.R_air));
  } else if (h <= 86000) {
    const lapseRate = -0.002;
    T = 214.65 + lapseRate * (h - 71000);
    P = 3.95642 * Math.pow(T / 214.65, -PHYS.g0 / (lapseRate * PHYS.R_air));
  } else {
    // Exosphere approximation
    T = 186.87;
    P = 0.3734 * Math.exp(-PHYS.g0 * (h - 86000) / (PHYS.R_air * T));
  }

  rho = P / (PHYS.R_air * T);
  const a = Math.sqrt(PHYS.gamma_air * PHYS.R_air * T);

  return { rho, P, T, a };
}


// ============================================================================
// 20. DRAG MODEL (for trajectory simulation)
// ============================================================================

/**
 * Compute aerodynamic drag force.
 *
 * @param {number} velocity  - m/s
 * @param {number} altitude  - m
 * @param {number} refArea   - reference area (m^2)
 * @param {object} cdProfile - { subsonic, transonic, supersonic, hypersonic }
 * @returns {{ drag: number, dynamicPressure: number, mach: number }}
 */
function computeDrag(velocity, altitude, refArea, cdProfile) {
  const atm = atmosphere(altitude);
  const mach = velocity / atm.a;
  const q = 0.5 * atm.rho * velocity * velocity;

  let cd;
  if (mach < 0.8) {
    cd = cdProfile.subsonic;
  } else if (mach < 1.2) {
    // Transonic interpolation
    const t = (mach - 0.8) / 0.4;
    cd = lerp(cdProfile.subsonic, cdProfile.transonic, t);
  } else if (mach < 5.0) {
    const t = (mach - 1.2) / 3.8;
    cd = lerp(cdProfile.transonic, cdProfile.supersonic, t);
  } else {
    const t = clamp((mach - 5) / 15, 0, 1);
    cd = lerp(cdProfile.supersonic, cdProfile.hypersonic, t);
  }

  return {
    drag: q * cd * refArea,
    dynamicPressure: q,
    mach,
    cd,
  };
}


// ============================================================================
// 21. EXPORTS
// ============================================================================

// Browser global exports
if (typeof window !== "undefined") {
  window.RocketGen = {
    generateRocket,
    generateEngine,
    generateSolidMotor,
    generateStage,
    generateBoosters,
    generateFairing,
    sizeTanks,
    selectDesignStrategy,
    allocatePropellant,
    tsiolkovsky,
    calculateTotalDeltaV,
    computeIsp,
    nozzleExitConditions,
    computeDrag,
    atmosphere,
    validateRocket,
    estimateFlightProfile,
    PHYS,
    PROPELLANTS,
    ENGINE_CYCLES,
    TANK_MATERIALS,
    ORBIT_CLASSES,
    clamp,
    lerp,
    randRange,
    randChoice,
    weightedChoice,
  };
}

// Node.js / CommonJS exports
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    generateRocket,
    generateEngine,
    generateSolidMotor,
    generateStage,
    generateBoosters,
    generateFairing,
    sizeTanks,
    selectDesignStrategy,
    allocatePropellant,
    tsiolkovsky,
    calculateTotalDeltaV,
    computeIsp,
    nozzleExitConditions,
    computeDrag,
    atmosphere,
    validateRocket,
    estimateFlightProfile,
    PHYS,
    PROPELLANTS,
    ENGINE_CYCLES,
    TANK_MATERIALS,
    ORBIT_CLASSES,
    clamp,
    lerp,
    randRange,
    randChoice,
    weightedChoice,
  };
}
