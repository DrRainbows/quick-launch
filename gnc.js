// ============================================================================
// ORBIT SIMULATOR — GNC SYSTEM & ATMOSPHERIC MODEL
// ============================================================================
// A complete Guidance, Navigation, and Control system with US Standard
// Atmosphere 1976 model for browser-based rocket launch simulation.
//
// Physical constants, equations of motion, and guidance algorithms are
// implemented to produce trajectories that converge on real target orbits.
// ============================================================================

"use strict";

// ---------------------------------------------------------------------------
// PHYSICAL CONSTANTS
// ---------------------------------------------------------------------------
const GNC_CONST = Object.freeze({
    GM:           3.986004418e14,   // Earth gravitational parameter [m^3/s^2]
    R_EARTH:      6371000,          // Mean Earth radius [m]
    g0:           9.80665,          // Standard gravity [m/s^2]
    R_AIR:        287.05287,        // Specific gas constant for dry air [J/(kg*K)]
    GAMMA:        1.4,              // Ratio of specific heats for air
    KARMAN:       100000,           // Karman line [m]
    OMEGA_EARTH:  7.2921159e-5,     // Earth rotation rate [rad/s]
    ATM_CEIL:     500000,           // Atmosphere model ceiling [m]
});


// ============================================================================
// SECTION 1 — US STANDARD ATMOSPHERE 1976 (Simplified, Layered)
// ============================================================================
//
// The atmosphere is modelled as a series of layers, each with a defined base
// altitude, base temperature, and temperature lapse rate. Pressure and density
// are computed analytically from hydrostatic balance.
//
// Layers:
//   0  Troposphere        0 – 11 000 m      lapse = -6.5  K/km
//   1  Tropopause        11 – 20 000 m      lapse =  0    K/km  (isothermal)
//   2  Stratosphere I    20 – 32 000 m      lapse = +1.0  K/km
//   3  Stratosphere II   32 – 47 000 m      lapse = +2.8  K/km
//   4  Stratopause       47 – 51 000 m      lapse =  0    K/km  (isothermal)
//   5  Mesosphere I      51 – 71 000 m      lapse = -2.8  K/km
//   6  Mesosphere II     71 – 86 000 m      lapse = -2.0  K/km
//   7  Thermosphere      86 – 500 000 m     exponential temperature rise
// ---------------------------------------------------------------------------

const ATM_LAYERS = [
    // { h_base [m], T_base [K], lapse [K/m], P_base [Pa] }
    // P_base values are precomputed from the 1976 standard.
    { h: 0,     T: 288.15,  lapse: -0.0065, P: 101325.0    },
    { h: 11000, T: 216.65,  lapse:  0.0,    P: 22632.1     },
    { h: 20000, T: 216.65,  lapse:  0.001,  P: 5474.89     },
    { h: 32000, T: 228.65,  lapse:  0.0028, P: 868.019     },
    { h: 47000, T: 270.65,  lapse:  0.0,    P: 110.906     },
    { h: 51000, T: 270.65,  lapse: -0.0028, P: 66.9389     },
    { h: 71000, T: 214.65,  lapse: -0.002,  P: 3.95642     },
    { h: 86000, T: 186.87,  lapse:  0.0,    P: 0.3734      },
];

/**
 * US Standard Atmosphere 1976 — temperature, pressure, density, speed of sound.
 *
 * @param {number} altitude  Geometric altitude above sea level [m]
 * @returns {{ T: number, P: number, rho: number, speedOfSound: number, molarMass: number }}
 */
function atmosphereModel(altitude) {
    const h = Math.max(0, Math.min(altitude, GNC_CONST.ATM_CEIL));

    // --- Thermosphere (above 86 km): exponential temperature model ----------
    if (h >= 86000) {
        // Simplified thermosphere: temperature rises asymptotically toward
        // ~800 K (solar minimum) using an exponential relaxation model.
        const T_inf = 800;           // Asymptotic exospheric temperature [K]
        const T_86  = 186.87;        // Temperature at 86 km base
        const sigma = 0.00015;       // Shape parameter [1/m]
        const dh    = h - 86000;

        const T = T_inf - (T_inf - T_86) * Math.exp(-sigma * dh);

        // Pressure: numerical integration of dp/p = -g/(R*T) dh
        // using multi-step midpoint rule for accuracy across the wide
        // altitude range of the thermosphere.
        const nSteps = 20;
        const stepSize = dh / nSteps;
        let lnP = Math.log(ATM_LAYERS[7].P);
        for (let i = 0; i < nSteps; i++) {
            const h_mid = 86000 + (i + 0.5) * stepSize;
            const T_step = T_inf - (T_inf - T_86) * Math.exp(-sigma * (h_mid - 86000));
            lnP -= GNC_CONST.g0 / (GNC_CONST.R_AIR * T_step) * stepSize;
        }
        const P = Math.exp(lnP);

        const rho = P / (GNC_CONST.R_AIR * T);
        const speedOfSound = Math.sqrt(GNC_CONST.GAMMA * GNC_CONST.R_AIR * T);

        return { T, P, rho, speedOfSound };
    }

    // --- Layers 0-6: standard lapse-rate model ------------------------------
    let layer = ATM_LAYERS[0];
    for (let i = ATM_LAYERS.length - 1; i >= 0; i--) {
        if (h >= ATM_LAYERS[i].h) {
            layer = ATM_LAYERS[i];
            break;
        }
    }

    const dh = h - layer.h;
    const T  = layer.T + layer.lapse * dh;

    let P;
    if (Math.abs(layer.lapse) < 1e-10) {
        // Isothermal layer: P = P_base * exp(-g * dh / (R * T))
        P = layer.P * Math.exp(-GNC_CONST.g0 * dh / (GNC_CONST.R_AIR * layer.T));
    } else {
        // Gradient layer:  P = P_base * (T / T_base)^(-g / (lapse * R))
        const exponent = -GNC_CONST.g0 / (layer.lapse * GNC_CONST.R_AIR);
        P = layer.P * Math.pow(T / layer.T, exponent);
    }

    const rho          = P / (GNC_CONST.R_AIR * T);
    const speedOfSound = Math.sqrt(GNC_CONST.GAMMA * GNC_CONST.R_AIR * T);

    return { T, P, rho, speedOfSound };
}


// ============================================================================
// SECTION 2 — AERODYNAMIC MODELS
// ============================================================================

/**
 * Mach-dependent drag coefficient.
 *
 * A piecewise model capturing subsonic, transonic, and supersonic regimes:
 *   Mach < 0.8   : Cd ~ 0.30  (subsonic, nearly constant)
 *   0.8 – 1.2    : Cd rises to ~0.50 (transonic drag rise / wave drag)
 *   1.2 – 5.0    : Cd decreases as ~1/sqrt(M^2 - 1) toward ~0.15
 *   > 5.0        : Cd ~ 0.15  (hypersonic, roughly constant)
 *
 * @param {number} mach  Mach number (non-negative)
 * @returns {number} Drag coefficient Cd
 */
function dragCoefficient(mach) {
    const M = Math.abs(mach);
    if (M < 0.8) {
        return 0.30;
    } else if (M < 1.0) {
        // Smooth ramp from 0.30 to 0.45 through transonic
        const t = (M - 0.8) / 0.2;
        return 0.30 + 0.15 * t * t * (3 - 2 * t);  // smoothstep
    } else if (M < 1.2) {
        // Peak drag near Mach 1.05
        const t = (M - 1.0) / 0.2;
        return 0.45 + 0.05 * Math.sin(Math.PI * t);  // gentle peak to 0.50
    } else if (M < 5.0) {
        // Supersonic decay: Prandtl-Glauert–style drop
        return 0.45 / Math.sqrt(M * M - 1.0) + 0.10;
    } else {
        return 0.15;
    }
}

/**
 * Dynamic pressure q = 0.5 * rho * v^2
 *
 * @param {number} velocity   Speed [m/s]
 * @param {number} altitude   Geometric altitude [m]
 * @returns {number} Dynamic pressure [Pa]
 */
function dynamicPressure(velocity, altitude) {
    const { rho } = atmosphereModel(altitude);
    return 0.5 * rho * velocity * velocity;
}

/**
 * Aerodynamic drag force vector (opposes velocity).
 *
 * D = 0.5 * rho * |v|^2 * Cd(M) * A_ref
 *
 * @param {{ x: number, y: number, z: number }} vel  Velocity vector [m/s]
 * @param {number} altitude       Geometric altitude [m]
 * @param {number} referenceArea  Aerodynamic reference area [m^2]
 * @param {number} [cdOverride]   Optional fixed Cd (if omitted, Mach-dependent)
 * @returns {{ x: number, y: number, z: number, magnitude: number, Cd: number, mach: number, q: number }}
 */
function dragForce(vel, altitude, referenceArea, cdOverride) {
    const atm   = atmosphereModel(altitude);
    const speed  = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    if (speed < 1e-6 || atm.rho < 1e-15) {
        return { x: 0, y: 0, z: 0, magnitude: 0, Cd: 0, mach: 0, q: 0 };
    }

    const mach = speed / atm.speedOfSound;
    const Cd   = (cdOverride !== undefined) ? cdOverride : dragCoefficient(mach);
    const q    = 0.5 * atm.rho * speed * speed;
    const D    = q * Cd * referenceArea;

    // Unit vector opposite to velocity
    const inv = -D / speed;
    return {
        x: inv * vel.x,
        y: inv * vel.y,
        z: inv * vel.z,
        magnitude: D,
        Cd,
        mach,
        q,
    };
}


// ============================================================================
// SECTION 3 — WIND MODEL
// ============================================================================

/**
 * Simple wind model with jet stream and random gusts.
 *
 * Returns a wind velocity vector in the inertial frame. The jet stream is
 * modelled as a Gaussian bump in wind speed centered around 12 km altitude,
 * blowing predominantly eastward. Random gusts are added via a seeded PRNG
 * for deterministic replays.
 *
 * @param {number} altitude  Geometric altitude [m]
 * @param {number} time      Mission elapsed time [s]
 * @returns {{ x: number, y: number, z: number }}
 */
function windModel(altitude, time) {
    // Jet stream: centered at 12 km, FWHM ~4 km, max ~60 m/s eastward
    const h_jet   = 12000;
    const sigma    = 2000;  // std dev [m]
    const jet_max  = 60;    // peak wind speed [m/s]
    const gauss    = Math.exp(-0.5 * Math.pow((altitude - h_jet) / sigma, 2));
    const jet_speed = jet_max * gauss;

    // Gusts: small perturbations using sinusoidal pseudo-randomness
    // (deterministic, no need for external PRNG)
    const gustMag = 5 * gauss;  // gusts only significant near jet stream
    const gx = gustMag * Math.sin(time * 0.7 + altitude * 0.001);
    const gy = gustMag * Math.cos(time * 1.1 + altitude * 0.0013);
    const gz = gustMag * Math.sin(time * 0.3 + altitude * 0.0007) * 0.3;

    // Jet stream blows mostly in x (east), slight y component
    return {
        x: jet_speed * 0.95 + gx,
        y: jet_speed * 0.15 + gy,
        z: gz,
    };
}


// ============================================================================
// SECTION 4 — VECTOR & ORBITAL MECHANICS UTILITIES
// ============================================================================

const Vec3 = {
    create(x, y, z)   { return { x: x || 0, y: y || 0, z: z || 0 }; },
    add(a, b)          { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
    sub(a, b)          { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
    scale(v, s)        { return { x: v.x * s, y: v.y * s, z: v.z * s }; },
    dot(a, b)          { return a.x * b.x + a.y * b.y + a.z * b.z; },
    cross(a, b)        { return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    }; },
    mag(v)             { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); },
    norm(v) {
        const m = Vec3.mag(v);
        return m > 1e-12 ? Vec3.scale(v, 1 / m) : { x: 0, y: 0, z: 0 };
    },
    clone(v)           { return { x: v.x, y: v.y, z: v.z }; },
    zero()             { return { x: 0, y: 0, z: 0 }; },
};

/**
 * Compute Keplerian orbital elements from state vector.
 *
 * @param {{ x,y,z }} pos  Position in ECI [m]
 * @param {{ x,y,z }} vel  Velocity in ECI [m/s]
 * @returns {{ a, e, i, periapsis, apoapsis, vCircular, period, specificEnergy }}
 */
function orbitalElements(pos, vel) {
    const r     = Vec3.mag(pos);
    const v     = Vec3.mag(vel);
    const mu    = GNC_CONST.GM;

    // Specific orbital energy
    const energy = 0.5 * v * v - mu / r;

    // Semi-major axis
    const a = -mu / (2 * energy);

    // Specific angular momentum
    const h     = Vec3.cross(pos, vel);
    const h_mag = Vec3.mag(h);

    // Eccentricity vector
    const eVec = Vec3.sub(
        Vec3.scale(pos, (v * v - mu / r) / r),
        Vec3.scale(vel, Vec3.dot(pos, vel) / r)
    );
    // Correct eccentricity calculation: e = (1/mu) * (v x h - mu * r_hat)
    const vCrossH = Vec3.cross(vel, h);
    const rHat    = Vec3.norm(pos);
    const eVec2   = Vec3.sub(Vec3.scale(vCrossH, 1 / mu), rHat);
    const e       = Vec3.mag(eVec2);

    // Inclination
    const i = Math.acos(Math.max(-1, Math.min(1, h.z / h_mag)));

    // Periapsis and apoapsis (from center of Earth)
    const periapsis = a * (1 - e);
    const apoapsis  = a * (1 + e);

    // Circular velocity at current radius
    const vCircular = Math.sqrt(mu / r);

    // Orbital period
    const period = (a > 0) ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity;

    return {
        a,
        e,
        i: i * 180 / Math.PI,
        periapsis,
        apoapsis,
        periapsisAlt: periapsis - GNC_CONST.R_EARTH,
        apoapsisAlt:  apoapsis  - GNC_CONST.R_EARTH,
        vCircular,
        period,
        specificEnergy: energy,
        angularMomentum: h_mag,
    };
}


// ============================================================================
// SECTION 5 — PID CONTROLLER WITH ANTI-WINDUP
// ============================================================================

class PIDController {
    /**
     * @param {number} Kp  Proportional gain
     * @param {number} Ki  Integral gain
     * @param {number} Kd  Derivative gain
     * @param {number} [minOutput=-Infinity]
     * @param {number} [maxOutput=+Infinity]
     * @param {number} [maxIntegral=Infinity]  Anti-windup clamp on integrator
     */
    constructor(Kp, Ki, Kd, minOutput, maxOutput, maxIntegral) {
        this.Kp = Kp;
        this.Ki = Ki;
        this.Kd = Kd;
        this.minOutput    = (minOutput    !== undefined) ? minOutput    : -Infinity;
        this.maxOutput    = (maxOutput    !== undefined) ? maxOutput    :  Infinity;
        this.maxIntegral  = (maxIntegral  !== undefined) ? maxIntegral  :  Infinity;

        this.integral    = 0;
        this.prevError   = 0;
        this.initialized = false;
    }

    /**
     * Compute PID output.
     *
     * Uses discrete accumulation for the integral term with back-calculation
     * anti-windup. The derivative uses discrete differences without dt
     * division to prevent noise amplification at small timesteps.
     *
     * @param {number} error  Setpoint minus measured value
     * @param {number} dt     Timestep [s]
     * @returns {number} Control output
     */
    update(error, dt) {
        if (dt <= 0) return 0;

        // Proportional
        const P = this.Kp * error;

        // Integral: discrete accumulation with anti-windup
        this.integral += error;
        this.integral  = Math.max(-this.maxIntegral, Math.min(this.maxIntegral, this.integral));

        // Integral sign-change decay: when error crosses zero relative to
        // the accumulated integral, rapidly unwind to prevent overshoot.
        // This is a standard conditional anti-windup technique.
        if (error * this.integral < 0) {
            this.integral *= 0.5;
        }

        const I = this.Ki * this.integral;

        // Derivative (skip first call to avoid spike).
        // Uses discrete difference without dt division to prevent
        // noise amplification at small timesteps.
        let D = 0;
        if (this.initialized) {
            D = this.Kd * (error - this.prevError);
        }
        this.prevError   = error;
        this.initialized = true;

        const output = P + I + D;
        return Math.max(this.minOutput, Math.min(this.maxOutput, output));
    }

    /** Reset controller state (e.g. at staging). */
    reset() {
        this.integral    = 0;
        this.prevError   = 0;
        this.initialized = false;
    }
}


// ============================================================================
// SECTION 6 — NAVIGATION SYSTEM (Simplified)
// ============================================================================

class NavigationSystem {
    /**
     * @param {number} accelNoise  Standard deviation of accelerometer noise [m/s^2]
     * @param {number} gyroNoise   Standard deviation of gyro noise [rad/s]
     */
    constructor(accelNoise = 0.01, gyroNoise = 0.0001) {
        this.accelNoise = accelNoise;
        this.gyroNoise  = gyroNoise;
    }

    /**
     * Gaussian random (Box-Muller transform).
     * @returns {number}
     */
    _gauss() {
        let u, v, s;
        do {
            u = Math.random() * 2 - 1;
            v = Math.random() * 2 - 1;
            s = u * u + v * v;
        } while (s >= 1 || s === 0);
        return u * Math.sqrt(-2 * Math.log(s) / s);
    }

    /**
     * Add sensor noise to a state vector to simulate imperfect navigation.
     *
     * @param {object} trueState  The true simulation state
     * @returns {object} Noisy state (position and velocity perturbed)
     */
    observe(trueState) {
        return {
            pos: {
                x: trueState.pos.x + this._gauss() * 0.5,
                y: trueState.pos.y + this._gauss() * 0.5,
                z: trueState.pos.z + this._gauss() * 0.5,
            },
            vel: {
                x: trueState.vel.x + this._gauss() * this.accelNoise,
                y: trueState.vel.y + this._gauss() * this.accelNoise,
                z: trueState.vel.z + this._gauss() * this.accelNoise,
            },
            mass: trueState.mass,
            time: trueState.time,
        };
    }
}


// ============================================================================
// SECTION 7 — GNC COMPUTER
// ============================================================================
//
// Flight phases:
//   PRELAUNCH        T-10 .. T-0      Systems check, ignition sequence
//   VERTICAL_RISE    alt < 500 m      Clear the tower
//   GRAVITY_TURN     until staging     Pitch-over and gravity turn
//   STAGING          brief coast       Stage separation
//   UPPER_STAGE      PEG guidance      Steer to orbit
//   COAST_TO_APOAPSIS                  Ballistic coast to apoapsis
//   CIRCULARIZE      burn at apoapsis  Circularize orbit
//   ORBIT_ACHIEVED                     Mission complete
//   ABORT                              Off-nominal
// ---------------------------------------------------------------------------

const FlightPhase = Object.freeze({
    PRELAUNCH:         "PRELAUNCH",
    IGNITION:          "IGNITION",
    VERTICAL_RISE:     "VERTICAL_RISE",
    GRAVITY_TURN:      "GRAVITY_TURN",
    MAX_Q_THROTTLE:    "MAX_Q_THROTTLE",
    PRE_STAGING:       "PRE_STAGING",
    STAGING:           "STAGING",
    UPPER_STAGE:       "UPPER_STAGE",
    COAST_TO_APOAPSIS: "COAST_TO_APOAPSIS",
    CIRCULARIZE:       "CIRCULARIZE",
    ORBIT_ACHIEVED:    "ORBIT_ACHIEVED",
    ABORT:             "ABORT",
});

class GNCComputer {
    /**
     * @param {object} rocket        Rocket configuration (see RocketConfig below)
     * @param {object} targetOrbit   { altitude: m, inclination: deg }
     */
    constructor(rocket, targetOrbit) {
        this.rocket      = rocket;
        this.targetOrbit = targetOrbit;

        // Target orbital parameters
        this.targetRadius   = GNC_CONST.R_EARTH + targetOrbit.altitude;
        this.targetVCirc    = Math.sqrt(GNC_CONST.GM / this.targetRadius);
        this.targetInclination = (targetOrbit.inclination || 0) * Math.PI / 180;

        // Current phase
        this.phase      = FlightPhase.PRELAUNCH;
        this.phaseTime  = 0;    // Time spent in current phase [s]
        this.missionTime = 0;

        // Stage tracking
        this.currentStage = 0;
        this.stagingTimer = 0;
        this.stagingDuration = rocket.stages.length > 1
            ? (rocket.stageSeparationDelay || 1.5)
            : 0;

        // Gravity turn parameters
        this.kickAngle       = (rocket.kickAngle || 2.0) * Math.PI / 180;  // Initial pitch-over [rad]
        this.kickAltitude    = rocket.kickAltitude || 500;                   // Altitude to start kick [m]
        this.kickCompleted   = false;
        this.gravityTurnRate = 0;  // rad/s, computed adaptively

        // Max-Q limit
        this.maxQLimit = rocket.maxQLimit || 35000;  // Pa (~35 kPa typical)

        // PID controllers for attitude tracking
        this.pitchPID = new PIDController(0.8, 0.05, 0.15, -0.15, 0.15, 1.5);
        this.yawPID   = new PIDController(0.8, 0.05, 0.15, -0.15, 0.15, 1.5);

        // Gimbal state
        this.gimbalPitch     = 0;     // Current gimbal deflection [rad]
        this.gimbalYaw       = 0;
        this.gimbalRateLimit = (rocket.gimbalRateLimit || 5.0) * Math.PI / 180;  // rad/s

        // Throttle
        this.throttle = 0;

        // PEG (Powered Explicit Guidance) state
        this.pegConverged    = false;
        this.pegLambda       = Vec3.create(0, 1, 0);  // Initial steering unit vector
        this.pegLambdaDot    = Vec3.create(0, 0, 0);
        this.pegTgo          = 0;                       // Time-to-go [s]
        this.pegIterations   = 0;
        this.pegLastUpdate   = 0;
        this.pegUpdateInterval = 1.0;  // seconds between PEG updates

        // Telemetry accumulator
        this.telemetry = this._initTelemetry();

        // Navigation system
        this.nav = new NavigationSystem();

        // Commanded attitude (direction the rocket should point)
        this.commandedPitch = Math.PI / 2;  // Start vertical (90 deg from horizontal)
        this.commandedYaw   = 0;

        // Pre-launch countdown
        this.countdownTime = rocket.countdownTime || 10;
    }

    // -----------------------------------------------------------------------
    // MAIN UPDATE — called every simulation timestep
    // -----------------------------------------------------------------------

    /**
     * Main GNC loop. Computes guidance commands based on current state.
     *
     * @param {object} state  { pos: {x,y,z}, vel: {x,y,z}, mass, time }
     * @param {number} dt     Timestep [s]
     * @returns {{ gimbalPitch, gimbalYaw, throttle, phase, staging, telemetry }}
     */
    update(state, dt) {
        this.missionTime += dt;
        this.phaseTime   += dt;

        // Navigation: observe state with sensor noise
        const observed = this.nav.observe(state);

        // Compute derived quantities
        const altitude = Vec3.mag(state.pos) - GNC_CONST.R_EARTH;
        const speed    = Vec3.mag(state.vel);
        const atm      = atmosphereModel(altitude);

        // Compute airspeed (relative to co-rotating atmosphere) for
        // dynamic pressure and Mach number. The atmosphere rotates with
        // Earth, so we subtract the rotational velocity.
        const omegaE = GNC_CONST.OMEGA_EARTH;
        const vEarthRot = Vec3.create(
            -omegaE * state.pos.y,
             omegaE * state.pos.x,
             0
        );
        const airspeed = Vec3.mag(Vec3.sub(state.vel, vEarthRot));
        const q        = 0.5 * atm.rho * airspeed * airspeed;
        const mach     = (atm.speedOfSound > 0) ? airspeed / atm.speedOfSound : 0;

        // Radial and tangential velocity components
        const rHat     = Vec3.norm(state.pos);
        const vRadial  = Vec3.dot(state.vel, rHat);
        const vTangVec = Vec3.sub(state.vel, Vec3.scale(rHat, vRadial));
        const vTang    = Vec3.mag(vTangVec);

        // Orbital elements
        const orbit = orbitalElements(state.pos, state.vel);

        // Current stage info
        const stage = this.rocket.stages[this.currentStage];

        // Store commonly used values
        this._cache = {
            altitude, speed, q, mach, atm, rHat,
            vRadial, vTang, vTangVec, orbit, stage,
            pos: state.pos, vel: state.vel, mass: state.mass,
        };

        // Phase state machine
        let stagingEvent = false;

        switch (this.phase) {
            case FlightPhase.PRELAUNCH:
                this._prelaunch(state, dt);
                break;

            case FlightPhase.IGNITION:
                this._ignition(state, dt);
                break;

            case FlightPhase.VERTICAL_RISE:
                this._verticalRise(state, dt);
                break;

            case FlightPhase.GRAVITY_TURN:
                this._gravityTurn(state, dt);
                break;

            case FlightPhase.PRE_STAGING:
                this._preStaging(state, dt);
                break;

            case FlightPhase.STAGING:
                stagingEvent = this._staging(state, dt);
                break;

            case FlightPhase.UPPER_STAGE:
                this._upperStageGuidance(state, dt);
                break;

            case FlightPhase.COAST_TO_APOAPSIS:
                this._coastToApoapsis(state, dt);
                break;

            case FlightPhase.CIRCULARIZE:
                this._circularize(state, dt);
                break;

            case FlightPhase.ORBIT_ACHIEVED:
                this.throttle = 0;
                break;

            case FlightPhase.ABORT:
                this.throttle = 0;
                break;
        }

        // Max-Q throttle override (first stage atmospheric flight only).
        // Do NOT throttle upper stage — if it's in atmosphere, it needs
        // full thrust to climb out, not less.
        const inAtmosphere = this._cache.altitude < GNC_CONST.KARMAN;
        if (this.phase === FlightPhase.GRAVITY_TURN && inAtmosphere && q > this.maxQLimit * 0.9) {
            this.throttle = Math.min(this.throttle, this.maxQLimit / Math.max(q, 1));
        }

        // Gimbal rate limiting
        this.gimbalPitch = this._rateLimitGimbal(this.gimbalPitch, this.pitchPID.prevError !== undefined ? this.gimbalPitch : 0, dt);
        this.gimbalYaw   = this._rateLimitGimbal(this.gimbalYaw,   this.yawPID.prevError   !== undefined ? this.gimbalYaw   : 0, dt);

        // Update telemetry
        this._updateTelemetry(state, altitude, speed, q, mach, orbit);

        return {
            gimbalPitch: this.gimbalPitch,
            gimbalYaw:   this.gimbalYaw,
            throttle:    this.throttle,
            phase:       this.phase,
            staging:     stagingEvent,
            telemetry:   this.telemetry,
        };
    }

    // -----------------------------------------------------------------------
    // PHASE: PRELAUNCH
    // -----------------------------------------------------------------------
    _prelaunch(state, dt) {
        this.throttle    = 0;
        this.gimbalPitch = 0;
        this.gimbalYaw   = 0;

        if (this.missionTime >= this.countdownTime - 3) {
            // T-3: Begin ignition sequence
            this._transitionTo(FlightPhase.IGNITION);
        }
    }

    // -----------------------------------------------------------------------
    // PHASE: IGNITION
    // -----------------------------------------------------------------------
    _ignition(state, dt) {
        // Ramp throttle from 0 to 1 over ~3 seconds
        const ignitionDuration = 3.0;
        const progress = Math.min(this.phaseTime / ignitionDuration, 1.0);
        this.throttle = progress;

        // Gimbal check: small oscillation
        if (this.phaseTime < 1.0) {
            this.gimbalPitch = 0.02 * Math.sin(this.phaseTime * 10);
            this.gimbalYaw   = 0.02 * Math.cos(this.phaseTime * 10);
        } else {
            this.gimbalPitch = 0;
            this.gimbalYaw   = 0;
        }

        // Release hold-downs when thrust exceeds weight
        if (this.missionTime >= this.countdownTime) {
            this._transitionTo(FlightPhase.VERTICAL_RISE);
            this.throttle = 1.0;
        }
    }

    // -----------------------------------------------------------------------
    // PHASE: VERTICAL RISE (clear the tower)
    // -----------------------------------------------------------------------
    _verticalRise(state, dt) {
        this.throttle = 1.0;

        // Pure vertical: commanded attitude is straight up (along position vector)
        this.commandedPitch = Math.PI / 2;
        this.commandedYaw   = 0;

        // Compute attitude error and drive gimbal via PID
        const { rHat } = this._cache;
        const bodyAxis = this._bodyAxisFromState(state);
        const pitchError = this._angleBetween(bodyAxis, rHat);

        this.gimbalPitch = this.pitchPID.update(pitchError, dt);
        this.gimbalYaw   = 0;

        // Transition when altitude exceeds kick altitude
        if (this._cache.altitude >= this.kickAltitude) {
            this._transitionTo(FlightPhase.GRAVITY_TURN);
            this.pitchPID.reset();

            // Compute pitchOverScale ONCE at gravity turn entry.
            // The scale depends on both burn time and TWR:
            // - Long burns can afford gentler turns (larger scale)
            // - Higher TWR means the rocket accelerates faster, so it
            //   can pitch gently and still build horizontal velocity.
            // - Low TWR (barely > 1) needs aggressive pitch-over because
            //   gravity eats most of the thrust during steep flight.
            const stage = this.rocket.stages[this.currentStage];
            const ve = (stage.ispVac || stage.isp) * GNC_CONST.g0;
            const mdot = (stage.thrustVac || stage.thrust) / ve;
            const propTotal = stage.propellantMass || 0;
            const burnTime = (mdot > 0) ? propTotal / mdot : 200;
            const burnTimeFactor = Math.min(burnTime / 160, 1.0);
            const totalMass = this._cache.mass;
            const twr0 = stage.thrust / (totalMass * GNC_CONST.g0);
            // twrFactor: 0 at TWR=1 (aggressive), 1 at TWR≥2 (gentle)
            const twrFactor = Math.max(0, Math.min(1, (twr0 - 1.0)));
            // Compact scale: pitch to horizontal by ~25-45km altitude.
            this._gravityTurnScale = 25 + twrFactor * 10 + burnTimeFactor * 10;
        }
    }

    // -----------------------------------------------------------------------
    // PHASE: GRAVITY TURN
    // -----------------------------------------------------------------------
    /**
     * The gravity turn is the core trajectory-shaping maneuver. After an
     * initial small pitch kick, the rocket follows its velocity vector,
     * allowing gravity to naturally bend the trajectory toward horizontal.
     *
     * The pitch command tracks the velocity vector direction (prograde).
     * This is aerodynamically optimal: zero angle of attack minimizes
     * structural loads and drag losses.
     */
    _gravityTurn(state, dt) {
        const { altitude, speed, q, rHat, vRadial, vTang } = this._cache;

        this.throttle = 1.0;

        // --- Pitch program: blend between scheduled profile and prograde ---
        // At low altitude, follow a predetermined pitch schedule.
        // At high altitude, follow velocity vector (prograde).
        // This prevents the instability of pure prograde tracking at low speed.

        // Scheduled pitch profile — uses pitchOverScale computed once at
        // gravity turn entry (stored in this._gravityTurnScale).
        // This avoids a positive feedback loop where decreasing propellant
        // mass shrinks the scale, causing premature horizontal flight.
        const altKm = Math.max(0, altitude / 1000);
        const pitchOverScale = this._gravityTurnScale || 70;
        const scheduledPitch = Math.max(0.02, (Math.PI / 2) * (1.0 - altKm / pitchOverScale));

        // Prograde pitch from relative velocity
        const omegaE = GNC_CONST.OMEGA_EARTH;
        const vRot = Vec3.create(
            -omegaE * state.pos.y,
             omegaE * state.pos.x,
             0
        );
        const vRel = Vec3.sub(state.vel, vRot);
        const vRelMag = Vec3.mag(vRel);
        let progradePitch = scheduledPitch;
        if (vRelMag > 5.0) {
            const prograde = Vec3.norm(vRel);
            progradePitch = Math.asin(Math.max(-1, Math.min(1,
                Vec3.dot(prograde, rHat))));
            // Clamp prograde pitch to never go below horizon during ascent
            progradePitch = Math.max(progradePitch, 0.0);
        }

        // Adaptive blend: transition from schedule to prograde over 10-40km,
        // BUT reduce the prograde influence when the velocity vector diverges
        // significantly from the schedule. This handles two regimes:
        //
        // High-TWR vehicles (e.g. GenericLEO): prograde naturally follows the
        // schedule (small divergence), so the blend works normally — the schedule
        // component prevents too-rapid pitch-over.
        //
        // Low-TWR vehicles: prograde stays steep because thrust barely overcomes
        // gravity. Large divergence → blend factor shrinks → schedule dominates,
        // forcing the trajectory horizontal even when the velocity vector is steep.
        const altBlend = Math.max(0, Math.min(1, (altKm - 10) / 30));
        const divergence = Math.max(0, progradePitch - scheduledPitch) / (Math.PI / 4);
        const effectiveBlend = altBlend * Math.max(0, 1 - divergence);
        this.commandedPitch = scheduledPitch * (1 - effectiveBlend) + progradePitch * effectiveBlend;

        // PID to track commanded pitch
        const bodyAxis   = this._bodyAxisFromState(state);
        const pitchAngle = Math.asin(Math.max(-1, Math.min(1,
            Vec3.dot(bodyAxis, rHat))));
        const pitchError = this.commandedPitch - pitchAngle;

        this.gimbalPitch = this.pitchPID.update(pitchError, dt);
        this.gimbalYaw   = this.yawPID.update(0, dt);  // Hold yaw at zero

        // Check for staging
        this._checkStaging(state, dt);
    }

    // -----------------------------------------------------------------------
    // PHASE: PRE-STAGING (engine cutoff, coast)
    // -----------------------------------------------------------------------
    _preStaging(state, dt) {
        this.throttle    = 0;  // MECO for current stage
        this.gimbalPitch = 0;
        this.gimbalYaw   = 0;

        // Brief coast before separation
        if (this.phaseTime >= 0.5) {
            this._transitionTo(FlightPhase.STAGING);
        }
    }

    // -----------------------------------------------------------------------
    // PHASE: STAGING (separation and upper stage ignition)
    // -----------------------------------------------------------------------
    _staging(state, dt) {
        this.stagingTimer += dt;

        if (this.stagingTimer < this.stagingDuration) {
            // Attitude hold during coast — no thrust
            this.throttle = 0;
            this.gimbalPitch = 0;
            this.gimbalYaw   = 0;
            return false;
        }

        // Stage separation complete — advance to next stage
        this.currentStage++;
        this.stagingTimer = 0;

        if (this.currentStage >= this.rocket.stages.length) {
            // No more stages — go to coast
            this._transitionTo(FlightPhase.COAST_TO_APOAPSIS);
            return false;
        }

        // Reset PIDs for new stage dynamics
        this.pitchPID.reset();
        this.yawPID.reset();

        // Reconfigure PID gains for upper stage (lighter, more responsive)
        this.pitchPID.Kp = 3.0;
        this.pitchPID.Ki = 0.05;
        this.pitchPID.Kd = 1.0;

        // Transition to upper stage guidance
        this._transitionTo(FlightPhase.UPPER_STAGE);
        this.throttle = 1.0;

        return true;  // Signal staging event to simulator (drop mass)
    }

    // -----------------------------------------------------------------------
    // PHASE: UPPER STAGE — Powered Explicit Guidance (PEG-like)
    // -----------------------------------------------------------------------
    /**
     * Powered Explicit Guidance steers the upper stage to achieve the target
     * orbital velocity vector at burnout. The algorithm:
     *
     * 1. Compute the desired velocity at the target orbit (circular, at
     *    target altitude, in the correct direction).
     * 2. Compute the velocity deficit: dv_needed = v_target - v_current.
     * 3. Estimate time-to-go from remaining delta-v capability and current
     *    acceleration.
     * 4. Compute a linear steering law: lambda(t) = lambda_0 + lambdaDot * t
     *    where lambda is the thrust direction unit vector.
     * 5. The thrust direction is biased to account for gravity losses during
     *    the remaining burn.
     *
     * This is a simplified but functional PEG implementation that converges
     * reliably for typical LEO insertion trajectories.
     */
    _upperStageGuidance(state, dt) {
        const { altitude, speed, rHat, vRadial, vTang, orbit, stage } = this._cache;

        this.throttle = 1.0;

        // --- Prograde-following guidance with altitude maintenance ---
        // Most expendable launch vehicles use prograde-following during
        // upper stage burn: thrust aligned with velocity minimizes
        // gravity losses and structural loads.
        //
        // Small upward bias when below target altitude to prevent
        // the trajectory from dropping too low during the burn.

        // Compute prograde direction (relative to atmosphere/Earth rotation)
        const omegaE = GNC_CONST.OMEGA_EARTH;
        const vRot   = Vec3.create(-omegaE * state.pos.y, omegaE * state.pos.x, 0);
        const vRel   = Vec3.sub(state.vel, vRot);
        const vRelMag = Vec3.mag(vRel);

        let progradePitch = 0;
        if (vRelMag > 10) {
            const prograde = Vec3.norm(vRel);
            progradePitch = Math.asin(Math.max(-1, Math.min(1,
                Vec3.dot(prograde, rHat))));
        }

        // Altitude maintenance bias: if altitude is below target and/or
        // the vehicle is falling, bias pitch upward to maintain altitude.
        // This is critical for low-TWR upper stages that can't maintain
        // altitude while flying purely prograde.
        const altDeficit = this.targetOrbit.altitude - altitude;
        let altBias = 0;

        if (altDeficit > 0) {
            // Below target altitude: gentle upward bias proportional to deficit
            altBias = Math.min(0.12, altDeficit / (this.targetOrbit.altitude * 5));
        }

        // If falling (vRadial < 0), add stronger upward bias to arrest descent
        if (vRadial < 0) {
            const fallBias = Math.min(0.5, Math.abs(vRadial) / 200);
            altBias = Math.max(altBias, fallBias);
        }

        // Below Karman line: aggressive altitude maintenance — the upper stage
        // MUST climb out of the atmosphere or the mission is lost.
        if (altitude < GNC_CONST.KARMAN) {
            const karmanBias = (1 - altitude / GNC_CONST.KARMAN) * 0.6;
            altBias = Math.max(altBias, karmanBias);
        }

        // Commanded pitch: prograde + altitude bias, never below horizon
        this.commandedPitch = Math.max(0, progradePitch + altBias);

        // PID tracking
        const bodyAxis   = this._bodyAxisFromState(state);
        const pitchAngle = Math.asin(Math.max(-1, Math.min(1,
            Vec3.dot(bodyAxis, rHat))));
        const pitchError = this.commandedPitch - pitchAngle;

        this.gimbalPitch = this.pitchPID.update(pitchError, dt);
        this.gimbalYaw   = this.yawPID.update(0, dt);

        // --- MECO: apoapsis-based cutoff ---
        // Cut engine when apoapsis reaches target altitude.
        // This leaves remaining propellant for circularization at apoapsis.
        if (orbit.apoapsisAlt >= this.targetOrbit.altitude * 0.95 && vRadial > -10) {
            this._transitionTo(FlightPhase.COAST_TO_APOAPSIS);
            this.throttle = 0;
            return;
        }

        // Direct orbit achievement (both apo and peri near target)
        if (orbit.periapsisAlt > this.targetOrbit.altitude * 0.85 &&
            orbit.apoapsisAlt > this.targetOrbit.altitude * 0.85 &&
            orbit.e < 0.02) {
            this._transitionTo(FlightPhase.ORBIT_ACHIEVED);
            this.throttle = 0;
            return;
        }

        // Check staging — but only if there IS a next stage.
        // For the last stage, we want to burn until MECO (apoapsis target),
        // NOT until propellant depletion, so we can circularize later.
        const isLastStage = (this.currentStage >= this.rocket.stages.length - 1);
        if (!isLastStage) {
            this._checkStaging(state, dt);
        } else {
            // Last stage: reserve propellant for circularization at apoapsis.
            // Estimate the circularization dV needed and ensure enough remains.
            const stg = this.rocket.stages[this.currentStage];
            if (stg) {
                const ve = (stg.ispVac || stg.isp) * GNC_CONST.g0;
                const emptyMass = this._emptyMass();
                const remainingProp = state.mass - emptyMass;
                const remainingDV = (remainingProp > 0) ? ve * Math.log(state.mass / emptyMass) : 0;

                // Estimate circularization dV: deficit between current tangential
                // velocity and circular velocity at estimated apoapsis altitude.
                const vCircAtApo = Math.sqrt(GNC_CONST.GM / (GNC_CONST.R_EARTH + Math.max(altitude, orbit.apoapsisAlt)));
                const circDV = Math.max(0, vCircAtApo - speed);
                // Add margin for gravity losses during coast and circ burn
                const circReserve = circDV + 100;

                if (remainingDV <= circReserve && altitude > GNC_CONST.KARMAN * 0.8) {
                    // Reserve reached — MECO for coast + circularize
                    this._transitionTo(FlightPhase.COAST_TO_APOAPSIS);
                    this.throttle = 0;
                    return;
                }

                // Absolute fuel check: out of fuel
                const mdot = (stg.thrustVac || stg.thrust) / ve;
                if (remainingProp < mdot * 0.5) {
                    this._transitionTo(FlightPhase.COAST_TO_APOAPSIS);
                    this.throttle = 0;
                    return;
                }
            }
        }
    }

    /**
     * PEG parameter update — compute steering direction and time-to-go.
     */
    _updatePEG(state, rMag, rTarget, tangUnit) {
        const rHat = this._cache.rHat;

        // Current acceleration magnitude
        const stage = this.rocket.stages[this.currentStage];
        if (!stage) { this.pegConverged = false; return; }

        // Use vacuum values for upper stage (operating above atmosphere)
        const altFrac   = Math.min(1, this._cache.altitude / 80000);
        const thrust = ((1 - altFrac) * stage.thrust + altFrac * (stage.thrustVac || stage.thrust)) * this.throttle;
        const Isp    = (1 - altFrac) * stage.isp + altFrac * (stage.ispVac || stage.isp);
        const m      = state.mass;
        const a0     = thrust / m;  // Current acceleration [m/s^2]

        if (a0 < 0.1) { this.pegConverged = false; return; }

        // Exhaust velocity
        const ve = Isp * GNC_CONST.g0;

        // Velocity needed: compute target velocity at current position
        // For an orbit with apoapsis at rTarget, perigee at rMag:
        // v = sqrt(2*mu * rTarget / (rMag * (rMag + rTarget)))  ... transfer orbit
        // But if rMag is already near rTarget, target circular velocity.
        let vNeeded;
        if (rMag >= rTarget * 0.95) {
            // Near target altitude — aim for circular
            vNeeded = Math.sqrt(GNC_CONST.GM / rMag);
        } else {
            // Below target — aim for Hohmann-like transfer
            vNeeded = Math.sqrt(2 * GNC_CONST.GM * rTarget / (rMag * (rMag + rTarget)));
        }

        // Velocity deficit
        const vCurrent  = Vec3.mag(state.vel);
        const vRadial   = this._cache.vRadial;
        const vTang     = this._cache.vTang;

        // Desired velocity: mostly tangential, with small radial component
        // to reach target altitude. The radial velocity should be just enough
        // to raise/maintain altitude during the burn, not a large fraction
        // of the total velocity budget.
        const altDeficit = (rTarget - rMag);
        const tgo = this.pegTgo || 100;
        // Target a gentle climb: reach target altitude over the remaining burn time
        // but cap at a small fraction of orbital velocity to avoid wasting delta-V
        const vRadialNeeded = Math.max(0, Math.min(
            altDeficit / Math.max(tgo, 60),  // Gentle: reach target over burn time
            vNeeded * 0.05                    // Cap at 5% of needed velocity
        ));
        const vTangNeeded = Math.sqrt(Math.max(0, vNeeded * vNeeded - vRadialNeeded * vRadialNeeded));

        // Desired velocity vector
        const vDesired = Vec3.add(
            Vec3.scale(tangUnit, vTangNeeded),
            Vec3.scale(rHat, vRadialNeeded)
        );

        // Velocity-to-go
        const dvVec  = Vec3.sub(vDesired, state.vel);
        const dvMag  = Vec3.mag(dvVec);

        // Time-to-go estimate (Tsiolkovsky)
        // dv = ve * ln(m0/mf) => tgo = (m/mdot) * (1 - exp(-dv/ve))
        const mdot = thrust / ve;
        this.pegTgo = (mdot > 0) ? (m / mdot) * (1 - Math.exp(-dvMag / ve)) : Infinity;

        if (this.pegTgo < 0 || this.pegTgo > 10000) {
            this.pegConverged = false;
            // Fallback: steer prograde
            this.pegLambda    = Vec3.norm(state.vel);
            this.pegLambdaDot = Vec3.zero();
            return;
        }

        // Steering direction: toward velocity-to-go, with gravity compensation
        // Add partial gravity impulse during the burn (gravity loss compensation).
        // Cap the compensation time to prevent excessive pitch-up during long burns.
        const gVec = Vec3.scale(rHat, -GNC_CONST.GM / (rMag * rMag));
        const gravCompTime = Math.min(this.pegTgo * 0.5, 60);  // Cap at 60s worth
        const gravLoss = Vec3.scale(gVec, gravCompTime);

        // lambda = normalize(dv_needed - gravity_compensation)
        const steer = Vec3.sub(dvVec, gravLoss);
        this.pegLambda = Vec3.norm(steer);

        // Lambda-dot: rate of change of steering direction
        // Estimated from the angular rate needed to rotate from current to final
        if (this.pegTgo > 1) {
            // Final direction should be nearly tangential
            const lambdaFinal = Vec3.norm(vDesired);
            const dLambda     = Vec3.sub(lambdaFinal, this.pegLambda);
            this.pegLambdaDot = Vec3.scale(dLambda, 1 / this.pegTgo);
        } else {
            this.pegLambdaDot = Vec3.zero();
        }

        this.pegConverged  = true;
        this.pegIterations++;
    }

    // -----------------------------------------------------------------------
    // PHASE: COAST TO APOAPSIS
    // -----------------------------------------------------------------------
    _coastToApoapsis(state, dt) {
        this.throttle    = 0;
        this.gimbalPitch = 0;
        this.gimbalYaw   = 0;

        const { orbit, vRadial, altitude, rHat } = this._cache;

        // Detect apoapsis: radial velocity crosses zero (going from + to -)
        // We must be above the atmosphere to circularize.
        const nearApoapsis = Math.abs(vRadial) < 10 && altitude > GNC_CONST.KARMAN;

        // Also check if we've passed apoapsis (vRadial went negative)
        const pastApoapsis = vRadial < -1 && altitude > GNC_CONST.KARMAN;

        if (nearApoapsis || pastApoapsis) {
            // Check if circularization is needed
            const vCirc = Math.sqrt(GNC_CONST.GM / Vec3.mag(state.pos));
            const vDef  = vCirc - Vec3.mag(state.vel);

            if (Math.abs(vDef) < 5 && orbit.e < 0.005 && orbit.periapsisAlt > GNC_CONST.KARMAN) {
                // Already circular enough with periapsis above Karman line
                this._transitionTo(FlightPhase.ORBIT_ACHIEVED);
            } else if (this.currentStage < this.rocket.stages.length) {
                // Has a valid stage — check if it has propellant
                const remainingProp = state.mass - this._emptyMass();
                if (remainingProp > 1) {
                    // Has fuel for circularization burn
                    this._transitionTo(FlightPhase.CIRCULARIZE);
                } else if (orbit.periapsisAlt > GNC_CONST.KARMAN && orbit.apoapsisAlt > GNC_CONST.KARMAN) {
                    // No fuel but orbit is stable
                    this._transitionTo(FlightPhase.ORBIT_ACHIEVED);
                }
            } else if (orbit.periapsisAlt > GNC_CONST.KARMAN && orbit.apoapsisAlt > GNC_CONST.KARMAN) {
                // No stages left but orbit is stable (above atmosphere)
                this._transitionTo(FlightPhase.ORBIT_ACHIEVED);
            }
        }
    }

    // -----------------------------------------------------------------------
    // PHASE: CIRCULARIZATION BURN
    // -----------------------------------------------------------------------
    _circularize(state, dt) {
        const { rHat, vRadial, vTang, orbit, altitude } = this._cache;
        const rMag = Vec3.mag(state.pos);

        // Bail out if we're clearly suborbital — no point circularizing
        // at 50km altitude with periapsis at Earth's center.
        if (altitude < GNC_CONST.KARMAN * 0.5) {
            this._transitionTo(FlightPhase.ABORT);
            return;
        }

        // Check remaining propellant
        const remainingProp = state.mass - this._emptyMass();
        if (remainingProp < 1) {
            // Out of fuel — check if orbit is stable
            if (orbit.periapsisAlt > GNC_CONST.KARMAN && orbit.apoapsisAlt > GNC_CONST.KARMAN) {
                this._transitionTo(FlightPhase.ORBIT_ACHIEVED);
            } else {
                this._transitionTo(FlightPhase.ABORT);
            }
            this.throttle = 0;
            return;
        }

        // Desired: circular velocity at current radius, purely tangential
        const vCirc = Math.sqrt(GNC_CONST.GM / rMag);
        const vTangDir = Vec3.norm(Vec3.sub(state.vel, Vec3.scale(rHat, vRadial)));

        // Velocity deficit
        const dvTang = vCirc - vTang;
        const dvRad  = -vRadial;  // Kill radial velocity

        // Steering direction
        const steerDir = Vec3.norm(Vec3.add(
            Vec3.scale(vTangDir, dvTang),
            Vec3.scale(rHat, dvRad)
        ));

        // Set throttle proportional to velocity deficit (fine control)
        const dvMag = Math.sqrt(dvTang * dvTang + dvRad * dvRad);
        this.throttle = Math.min(1.0, dvMag / 50);  // Taper as we converge

        if ((dvMag < 2.0 || orbit.e < 0.002) && orbit.periapsisAlt > GNC_CONST.KARMAN) {
            // Close enough and periapsis above atmosphere — orbit achieved
            this._transitionTo(FlightPhase.ORBIT_ACHIEVED);
            this.throttle = 0;
            return;
        }

        // PID tracking to steering direction
        const pitchFromHoriz = Math.asin(Math.max(-1, Math.min(1,
            Vec3.dot(steerDir, rHat))));
        this.commandedPitch = pitchFromHoriz;

        const bodyAxis   = this._bodyAxisFromState(state);
        const pitchAngle = Math.asin(Math.max(-1, Math.min(1,
            Vec3.dot(bodyAxis, rHat))));
        const pitchError = this.commandedPitch - pitchAngle;

        this.gimbalPitch = this.pitchPID.update(pitchError, dt);
        this.gimbalYaw   = this.yawPID.update(0, dt);
    }

    // -----------------------------------------------------------------------
    // STAGING CHECK
    // -----------------------------------------------------------------------
    _checkStaging(state, dt) {
        const stage = this.rocket.stages[this.currentStage];
        if (!stage) return;

        // Compute remaining propellant
        const dryMass = this._dryMassFromStage(this.currentStage);
        if (state.mass <= dryMass + 1) {
            // Stage depleted — initiate staging sequence
            this._transitionTo(FlightPhase.PRE_STAGING);
        }
    }

    /**
     * Compute the total dry mass from the current stage onward (structure +
     * payload + all upper stages).
     */
    _dryMassFromStage(stageIndex) {
        let dryMass = this.rocket.payloadMass || 0;
        for (let i = stageIndex; i < this.rocket.stages.length; i++) {
            dryMass += this.rocket.stages[i].dryMass;
            if (i > stageIndex) {
                dryMass += this.rocket.stages[i].propellantMass;
            }
        }
        return dryMass;
    }

    /**
     * Total vehicle mass when current stage propellant is fully depleted.
     * Used for propellant-remaining checks.
     */
    _emptyMass() {
        return this._dryMassFromStage(this.currentStage);
    }

    // -----------------------------------------------------------------------
    // HELPER METHODS
    // -----------------------------------------------------------------------

    /**
     * Transition to a new flight phase, resetting phase timer.
     */
    _transitionTo(newPhase) {
        this.phase     = newPhase;
        this.phaseTime = 0;
    }

    /**
     * Rate-limit a gimbal command.
     */
    _rateLimitGimbal(commanded, current, dt) {
        const maxDelta = this.gimbalRateLimit * dt;
        const delta    = commanded - current;
        if (Math.abs(delta) <= maxDelta) return commanded;
        return current + Math.sign(delta) * maxDelta;
    }

    /**
     * Approximate body axis direction from velocity (assumes rocket points prograde
     * or in commanded direction).
     */
    _bodyAxisFromState(state) {
        // Use velocity relative to Earth rotation for body axis
        const omegaE = GNC_CONST.OMEGA_EARTH;
        const vRot = Vec3.create(
            -omegaE * state.pos.y,
             omegaE * state.pos.x,
             0
        );
        const vRel = Vec3.sub(state.vel, vRot);
        const speed = Vec3.mag(vRel);
        if (speed > 10) {
            return Vec3.norm(vRel);
        }
        // At low speed, assume vertical
        return Vec3.norm(state.pos);
    }

    /**
     * Angle between two unit vectors.
     */
    _angleBetween(a, b) {
        const d = Vec3.dot(Vec3.norm(a), Vec3.norm(b));
        return Math.acos(Math.max(-1, Math.min(1, d)));
    }

    /**
     * Compute an initial tangential direction when velocity is too small.
     */
    _initialTangentDirection(state) {
        const rHat = Vec3.norm(state.pos);
        // Cross with z-axis to get a tangential direction in the orbital plane
        let tang = Vec3.cross(Vec3.create(0, 0, 1), rHat);
        if (Vec3.mag(tang) < 0.01) {
            tang = Vec3.cross(Vec3.create(0, 1, 0), rHat);
        }
        return Vec3.norm(tang);
    }

    /**
     * Compute the required velocity at radius r for a transfer orbit with
     * apoapsis at rTarget.
     */
    _velocityForOrbit(r, rTarget) {
        // Vis-viva: v^2 = GM * (2/r - 1/a)
        // For transfer orbit with perigee at r and apogee at rTarget:
        // a = (r + rTarget) / 2
        const a = (r + rTarget) / 2;
        return Math.sqrt(GNC_CONST.GM * (2 / r - 1 / a));
    }

    // -----------------------------------------------------------------------
    // TELEMETRY
    // -----------------------------------------------------------------------

    _initTelemetry() {
        return {
            missionTime:   0,
            altitude:      0,
            speed:         0,
            downrangeDistance: 0,
            dynamicPressure: 0,
            mach:          0,
            mass:          0,
            throttle:      0,
            phase:         FlightPhase.PRELAUNCH,
            gimbalPitch:   0,
            gimbalYaw:     0,
            commandedPitch: 0,
            currentStage:  0,
            gForce:        0,
            orbitalElements: {
                a: 0, e: 0, i: 0,
                periapsisAlt: 0,
                apoapsisAlt: 0,
            },
            pegTgo:        0,
            pegConverged:  false,
            vRadial:       0,
            vTangential:   0,
            temperature:   0,
            pressure:      0,
            density:       0,
        };
    }

    _updateTelemetry(state, altitude, speed, q, mach, orbit) {
        const stage = this.rocket.stages[this.currentStage];
        const thrust = stage ? stage.thrust * this.throttle : 0;
        const gForce = (state.mass > 0) ? thrust / (state.mass * GNC_CONST.g0) : 0;

        this.telemetry = {
            missionTime:     this.missionTime,
            altitude:        altitude,
            speed:           speed,
            downrangeDistance: this._downrangeDistance(state.pos),
            dynamicPressure: q,
            mach:            mach,
            mass:            state.mass,
            throttle:        this.throttle,
            phase:           this.phase,
            gimbalPitch:     this.gimbalPitch * 180 / Math.PI,
            gimbalYaw:       this.gimbalYaw * 180 / Math.PI,
            commandedPitch:  this.commandedPitch * 180 / Math.PI,
            currentStage:    this.currentStage,
            gForce:          gForce,
            orbitalElements: {
                a:            orbit.a,
                e:            orbit.e,
                i:            orbit.i,
                periapsisAlt: orbit.periapsisAlt,
                apoapsisAlt:  orbit.apoapsisAlt,
                period:       orbit.period,
            },
            pegTgo:          this.pegTgo,
            pegConverged:    this.pegConverged,
            vRadial:         this._cache ? this._cache.vRadial : 0,
            vTangential:     this._cache ? this._cache.vTang : 0,
            temperature:     this._cache ? this._cache.atm.T : 0,
            pressure:        this._cache ? this._cache.atm.P : 0,
            density:         this._cache ? this._cache.atm.rho : 0,
        };
    }

    /**
     * Downrange distance: arc length along Earth's surface from launch site.
     */
    _downrangeDistance(pos) {
        // Assuming launch at (R_EARTH, 0, 0), downrange is the great-circle
        // arc from the launch position to the ground track.
        const r = Vec3.mag(pos);
        if (r < 1) return 0;
        const cosAngle = pos.x / r;  // Assuming launch on x-axis
        const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
        return GNC_CONST.R_EARTH * angle;
    }

    /**
     * Public accessor for full telemetry snapshot.
     */
    getTelemetry() {
        return { ...this.telemetry };
    }
}


// ============================================================================
// SECTION 8 — FLIGHT SIMULATOR (RK4 Integration)
// ============================================================================

class FlightSimulator {
    /**
     * @param {object} rocket       Rocket configuration
     * @param {GNCComputer} gnc     GNC computer instance
     * @param {object} [initialState]  Override initial state
     */
    constructor(rocket, gnc, initialState) {
        this.rocket = rocket;
        this.gnc    = gnc;

        // Default initial state: on the pad at latitude 28.5 N (Cape Canaveral)
        // In ECI coordinates, launch site is on the equatorial plane rotated
        // by latitude. For simplicity, place on the x-axis at Earth's surface.
        const launchLat = (rocket.launchLatitude || 28.5) * Math.PI / 180;
        const R0 = GNC_CONST.R_EARTH;

        this.state = initialState || {
            pos: {
                x: R0 * Math.cos(launchLat),
                y: 0,
                z: R0 * Math.sin(launchLat),
            },
            vel: {
                // Initial velocity from Earth's rotation
                x: 0,
                y: GNC_CONST.OMEGA_EARTH * R0 * Math.cos(launchLat),
                z: 0,
            },
            mass: this._totalMass(),
            time: 0,
        };

        // Trajectory recording
        this.trajectory = [];
        this.trajectoryInterval = 0.5;  // Record every 0.5s
        this._lastRecordTime = 0;

        // Adaptive timestep parameters
        this.minDt = 0.001;   // Minimum timestep [s]
        this.maxDt = 1.0;     // Maximum timestep [s]

        // Simulation status
        this.running  = true;
        this.aborted  = false;

        // Reference area for aerodynamics
        this.referenceArea = rocket.referenceArea || (Math.PI * Math.pow(rocket.diameter / 2, 2));

        // Track the last GNC output for the integrator
        this._lastGNC = {
            gimbalPitch: 0,
            gimbalYaw: 0,
            throttle: 0,
            phase: FlightPhase.PRELAUNCH,
            staging: false,
        };
    }

    /**
     * Total initial mass (all stages + payload).
     */
    _totalMass() {
        let mass = this.rocket.payloadMass || 0;
        for (const stage of this.rocket.stages) {
            mass += stage.dryMass + stage.propellantMass;
        }
        return mass;
    }

    /**
     * Compute the derivative of the state vector (equations of motion).
     *
     * @param {object} state  { pos, vel, mass, time }
     * @param {object} gncCmd { gimbalPitch, gimbalYaw, throttle }
     * @returns {object} { dpos, dvel, dmass }
     */
    _derivatives(state, gncCmd) {
        const pos  = state.pos;
        const vel  = state.vel;
        const mass = state.mass;
        const r    = Vec3.mag(pos);
        const alt  = r - GNC_CONST.R_EARTH;

        // --- Gravity: -GM * r_hat / r^2 ---
        const grav = Vec3.scale(pos, -GNC_CONST.GM / (r * r * r));

        // --- Thrust ---
        const stageIdx = this.gnc.currentStage;
        const stage    = this.rocket.stages[stageIdx];
        let thrustVec  = Vec3.zero();
        let dmass      = 0;

        if (stage && gncCmd.throttle > 0 && mass > 0) {
            // Interpolate thrust and Isp between sea-level and vacuum values
            const altFrac   = Math.min(1, alt / 80000);
            const thrustMag = ((1 - altFrac) * stage.thrust + altFrac * (stage.thrustVac || stage.thrust)) * gncCmd.throttle;
            const Isp       = (1 - altFrac) * stage.isp + altFrac * (stage.ispVac || stage.isp);

            // Compute thrust direction from the GNC commanded attitude.
            // The GNC computes the desired pitch (angle from horizontal)
            // and the gimbal provides small corrections.
            //
            // We construct the thrust direction in the local orbital frame:
            //   - radial: along position vector (up)
            //   - along-track: perpendicular to radial, in velocity direction
            //   - cross-track: completes the right-hand frame
            //
            // This approach correctly handles Earth's rotational velocity
            // by working in the local vertical / local horizontal frame.
            const rHat = Vec3.norm(pos);

            // Compute the inertial velocity minus Earth rotation
            // to get the "flight" velocity relative to the atmosphere
            const omegaE = GNC_CONST.OMEGA_EARTH;
            const vRotation = Vec3.create(
                -omegaE * pos.y,
                 omegaE * pos.x,
                 0
            );
            const vRelative = Vec3.sub(vel, vRotation);
            const vRelSpeed = Vec3.mag(vRelative);

            // Along-track direction (from relative velocity, projected horizontal)
            let hVel = Vec3.sub(vRelative, Vec3.scale(rHat, Vec3.dot(vRelative, rHat)));
            let hDir;
            if (Vec3.mag(hVel) > 1.0) {
                hDir = Vec3.norm(hVel);
            } else {
                // Default along-track from launch azimuth (eastward)
                const east = Vec3.norm(Vec3.cross(Vec3.create(0, 0, 1), rHat));
                hDir = Vec3.mag(east) > 0.01 ? east : Vec3.create(0, 1, 0);
            }

            // Cross-track
            const crossTrack = Vec3.norm(Vec3.cross(rHat, hDir));

            // Use the GNC commanded pitch to set thrust direction
            // commandedPitch = PI/2 means vertical, 0 means horizontal
            const pitch = this.gnc.commandedPitch;
            const gimbalP = gncCmd.gimbalPitch;
            const gimbalY = gncCmd.gimbalYaw;

            // Total pitch = commanded + gimbal correction
            const totalPitch = pitch + gimbalP;

            // Thrust direction in local orbital frame
            const thrustDir = Vec3.norm(Vec3.add(
                Vec3.add(
                    Vec3.scale(rHat,  Math.sin(totalPitch)),
                    Vec3.scale(hDir,  Math.cos(totalPitch) * Math.cos(gimbalY))
                ),
                Vec3.scale(crossTrack, Math.cos(totalPitch) * Math.sin(gimbalY))
            ));

            thrustVec = Vec3.scale(thrustDir, thrustMag);
            dmass     = -thrustMag / (Isp * GNC_CONST.g0);
        }

        // --- Aerodynamic drag ---
        // The atmosphere co-rotates with Earth, so we must subtract
        // Earth's rotational velocity to get airspeed.
        // Also subtract any wind perturbations.
        const omegaDrag = GNC_CONST.OMEGA_EARTH;
        const vEarthRot = Vec3.create(
            -omegaDrag * pos.y,
             omegaDrag * pos.x,
             0
        );
        const wind    = (alt > 0 && alt < 100000) ? windModel(alt, state.time) : Vec3.zero();
        const velRel  = Vec3.sub(Vec3.sub(vel, vEarthRot), wind);
        const drag    = dragForce(velRel, alt, this.referenceArea);

        // --- Total acceleration ---
        const accel = Vec3.add(
            Vec3.add(grav, Vec3.scale(thrustVec, 1 / mass)),
            Vec3.scale(drag, 1 / mass)
        );

        return {
            dpos:  vel,
            dvel:  accel,
            dmass: dmass,
        };
    }

    /**
     * Advance the simulation by dt seconds using 4th-order Runge-Kutta.
     *
     * @param {number} dt  Timestep [s]
     */
    step(dt) {
        if (!this.running) return;

        // Adaptive timestep: use smaller dt during high-dynamic phases
        const adaptiveDt = this._adaptiveTimestep(dt);
        let timeRemaining = dt;

        while (timeRemaining > 1e-6) {
            const h = Math.min(adaptiveDt, timeRemaining);
            this._rk4Step(h);
            timeRemaining -= h;
        }

        // Record trajectory
        if (this.state.time - this._lastRecordTime >= this.trajectoryInterval) {
            this.trajectory.push({
                pos:  Vec3.clone(this.state.pos),
                vel:  Vec3.clone(this.state.vel),
                mass: this.state.mass,
                time: this.state.time,
                phase: this.gnc.phase,
                alt:  Vec3.mag(this.state.pos) - GNC_CONST.R_EARTH,
            });
            this._lastRecordTime = this.state.time;
        }

        // Check for ground impact
        const alt = Vec3.mag(this.state.pos) - GNC_CONST.R_EARTH;
        if (alt < -100 && this.state.time > 10) {
            this.running = false;
            this.aborted = true;
        }
    }

    /**
     * Single RK4 integration step.
     */
    _rk4Step(h) {
        const s = this.state;

        // First, run GNC to get current commands
        const gncCmd = this.gnc.update(s, h);
        this._lastGNC = gncCmd;

        // Handle staging: remove depleted stage mass
        if (gncCmd.staging) {
            const depletedStage = this.rocket.stages[this.gnc.currentStage - 1];
            if (depletedStage) {
                this.state.mass -= depletedStage.dryMass;
                // Clamp mass to prevent going negative
                this.state.mass = Math.max(this.state.mass, this.rocket.payloadMass || 100);
            }
        }

        // Hold-down: don't move during pre-launch / ignition
        if (gncCmd.phase === FlightPhase.PRELAUNCH || gncCmd.phase === FlightPhase.IGNITION) {
            this.state.time += h;
            return;
        }

        // --- RK4 ---
        const k1 = this._derivatives(s, gncCmd);

        const s2 = {
            pos:  Vec3.add(s.pos,  Vec3.scale(k1.dpos,  h / 2)),
            vel:  Vec3.add(s.vel,  Vec3.scale(k1.dvel,  h / 2)),
            mass: s.mass + k1.dmass * h / 2,
            time: s.time + h / 2,
        };
        const k2 = this._derivatives(s2, gncCmd);

        const s3 = {
            pos:  Vec3.add(s.pos,  Vec3.scale(k2.dpos,  h / 2)),
            vel:  Vec3.add(s.vel,  Vec3.scale(k2.dvel,  h / 2)),
            mass: s.mass + k2.dmass * h / 2,
            time: s.time + h / 2,
        };
        const k3 = this._derivatives(s3, gncCmd);

        const s4 = {
            pos:  Vec3.add(s.pos,  Vec3.scale(k3.dpos,  h)),
            vel:  Vec3.add(s.vel,  Vec3.scale(k3.dvel,  h)),
            mass: s.mass + k3.dmass * h,
            time: s.time + h,
        };
        const k4 = this._derivatives(s4, gncCmd);

        // Combine: y_{n+1} = y_n + (h/6)(k1 + 2*k2 + 2*k3 + k4)
        this.state.pos = Vec3.add(s.pos, Vec3.scale(
            Vec3.add(Vec3.add(k1.dpos, Vec3.scale(k2.dpos, 2)),
                     Vec3.add(Vec3.scale(k3.dpos, 2), k4.dpos)),
            h / 6
        ));

        this.state.vel = Vec3.add(s.vel, Vec3.scale(
            Vec3.add(Vec3.add(k1.dvel, Vec3.scale(k2.dvel, 2)),
                     Vec3.add(Vec3.scale(k3.dvel, 2), k4.dvel)),
            h / 6
        ));

        this.state.mass = s.mass + (h / 6) * (k1.dmass + 2 * k2.dmass + 2 * k3.dmass + k4.dmass);
        this.state.time += h;

        // Clamp mass: never go below dry mass
        const minMass = this.gnc._dryMassFromStage(this.gnc.currentStage);
        this.state.mass = Math.max(this.state.mass, minMass);
    }

    /**
     * Determine adaptive timestep based on current flight phase.
     */
    _adaptiveTimestep(nominalDt) {
        const phase = this.gnc.phase;
        const alt   = Vec3.mag(this.state.pos) - GNC_CONST.R_EARTH;
        const speed = Vec3.mag(this.state.vel);

        // Use smaller timesteps during dynamic phases
        if (phase === FlightPhase.STAGING || phase === FlightPhase.PRE_STAGING) {
            return Math.max(this.minDt, Math.min(0.01, nominalDt));
        }
        if (phase === FlightPhase.VERTICAL_RISE) {
            return Math.max(this.minDt, Math.min(0.05, nominalDt));
        }
        if (phase === FlightPhase.GRAVITY_TURN && alt < 20000) {
            return Math.max(this.minDt, Math.min(0.05, nominalDt));
        }
        if (phase === FlightPhase.CIRCULARIZE) {
            return Math.max(this.minDt, Math.min(0.1, nominalDt));
        }
        // Coast phases can use larger timesteps
        if (phase === FlightPhase.COAST_TO_APOAPSIS) {
            return Math.min(1.0, nominalDt);
        }
        // Default
        return Math.max(this.minDt, Math.min(0.2, nominalDt));
    }

    /**
     * Get current state vector.
     */
    getState() {
        const alt = Vec3.mag(this.state.pos) - GNC_CONST.R_EARTH;
        return {
            ...this.state,
            altitude: alt,
            speed: Vec3.mag(this.state.vel),
            phase: this.gnc.phase,
        };
    }

    /**
     * Get recorded trajectory.
     */
    getTrajectory() {
        return this.trajectory;
    }

    /**
     * Get complete simulation snapshot (state + telemetry + trajectory).
     */
    getSnapshot() {
        return {
            state:      this.getState(),
            telemetry:  this.gnc.getTelemetry(),
            trajectory: this.trajectory,
            running:    this.running,
            aborted:    this.aborted,
        };
    }
}


// ============================================================================
// SECTION 9 — ROCKET CONFIGURATION PRESETS
// ============================================================================

/**
 * Example rocket configuration — a generic two-stage orbital launcher
 * loosely inspired by Falcon 9 / Atlas V class vehicles.
 *
 * All masses in kg, thrusts in N, Isp in s.
 */
const RocketConfigs = {
    /**
     * Generic medium-lift two-stage rocket to LEO.
     */
    GenericLEO: {
        name:           "Generic LEO Launcher",
        diameter:       3.7,                      // [m] — determines reference area
        referenceArea:  Math.PI * (3.7 / 2) ** 2, // ~10.75 m^2
        payloadMass:    5000,                      // [kg] payload to LEO
        launchLatitude: 28.5,                      // Cape Canaveral
        countdownTime:  10,                        // [s] pre-launch countdown
        kickAngle:      2.0,                       // [deg] initial pitch-over
        kickAltitude:   500,                       // [m] altitude to start gravity turn
        maxQLimit:      35000,                     // [Pa] max dynamic pressure limit
        gimbalRateLimit: 5.0,                      // [deg/s]
        stageSeparationDelay: 2.0,                 // [s] coast between stages

        stages: [
            {
                name:          "Stage 1",
                dryMass:       22000,       // [kg] stage structure
                propellantMass: 395000,     // [kg] propellant
                thrust:        7600000,     // [N] ~7.6 MN (sea level)
                thrustVac:     8200000,     // [N] vacuum thrust
                isp:           282,         // [s] sea level Isp
                ispVac:        311,         // [s] vacuum Isp
                burnTime:      162,         // [s] approximate
                nEngines:      9,
            },
            {
                name:          "Stage 2",
                dryMass:       4000,        // [kg]
                propellantMass: 92000,      // [kg]
                thrust:        981000,      // [N] ~981 kN vacuum
                thrustVac:     981000,
                isp:           348,         // [s] vacuum Isp
                ispVac:        348,
                burnTime:      397,         // [s] approximate
                nEngines:      1,
            },
        ],
    },

    /**
     * Small launcher — single stage to demonstrate suborbital.
     */
    Sounding: {
        name:           "Sounding Rocket",
        diameter:       0.5,
        referenceArea:  Math.PI * (0.5 / 2) ** 2,
        payloadMass:    50,
        launchLatitude: 28.5,
        countdownTime:  5,
        kickAngle:      1.0,
        kickAltitude:   300,
        maxQLimit:      50000,
        gimbalRateLimit: 10.0,
        stageSeparationDelay: 0,

        stages: [
            {
                name:          "Stage 1",
                dryMass:       500,
                propellantMass: 4500,
                thrust:        100000,
                thrustVac:     100000,
                isp:           240,
                ispVac:        260,
                burnTime:      60,
                nEngines:      1,
            },
        ],
    },
};


// ============================================================================
// SECTION 10 — FACTORY / CONVENIENCE API
// ============================================================================

/**
 * Create a complete simulation ready to run.
 *
 * @param {string|object} rocketConfig  Name from RocketConfigs or a config object
 * @param {{ altitude: number, inclination?: number }} targetOrbit  Target orbit
 * @returns {{ simulator: FlightSimulator, gnc: GNCComputer, rocket: object }}
 */
function createSimulation(rocketConfig, targetOrbit) {
    const rocket = (typeof rocketConfig === "string")
        ? RocketConfigs[rocketConfig]
        : rocketConfig;

    if (!rocket) {
        throw new Error(`Unknown rocket configuration: ${rocketConfig}`);
    }

    const target = targetOrbit || { altitude: 200000, inclination: 28.5 };
    const gnc    = new GNCComputer(rocket, target);
    const sim    = new FlightSimulator(rocket, gnc);

    return { simulator: sim, gnc, rocket };
}

/**
 * Run a complete simulation to orbit (or abort), returning the full trajectory.
 *
 * @param {string|object} rocketConfig
 * @param {{ altitude: number, inclination?: number }} targetOrbit
 * @param {{ maxTime?: number, dt?: number, onStep?: function }} options
 * @returns {{ trajectory, telemetry, finalState, success }}
 */
function runSimulation(rocketConfig, targetOrbit, options = {}) {
    const { simulator, gnc } = createSimulation(rocketConfig, targetOrbit);

    const maxTime   = options.maxTime || 3600;  // 1 hour max
    const dt        = options.dt || 0.1;        // 100ms nominal timestep
    const onStep    = options.onStep || null;

    let stepCount = 0;
    while (simulator.running && simulator.state.time < maxTime) {
        simulator.step(dt);
        stepCount++;

        if (onStep && stepCount % 10 === 0) {
            onStep(simulator.getSnapshot());
        }

        // Check for orbit achieved
        if (gnc.phase === FlightPhase.ORBIT_ACHIEVED) {
            break;
        }
    }

    const finalSnapshot = simulator.getSnapshot();
    return {
        trajectory:  simulator.getTrajectory(),
        telemetry:   gnc.getTelemetry(),
        finalState:  finalSnapshot.state,
        success:     gnc.phase === FlightPhase.ORBIT_ACHIEVED,
        totalTime:   simulator.state.time,
        stepCount,
    };
}


// ============================================================================
// EXPORTS — for use as a module or in browser
// ============================================================================

// Browser global
if (typeof window !== "undefined") {
    window.OrbitSim = {
        // Constants
        CONST: GNC_CONST,
        FlightPhase,

        // Atmosphere & aero
        atmosphereModel,
        dragCoefficient,
        dynamicPressure,
        dragForce,
        windModel,

        // Utilities
        Vec3,
        orbitalElements,

        // Classes
        PIDController,
        NavigationSystem,
        GNCComputer,
        FlightSimulator,

        // Configs
        RocketConfigs,

        // Factory
        createSimulation,
        runSimulation,
    };
}

// Node.js / ES module
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        CONST: GNC_CONST,
        FlightPhase,
        atmosphereModel,
        dragCoefficient,
        dynamicPressure,
        dragForce,
        windModel,
        Vec3,
        orbitalElements,
        PIDController,
        NavigationSystem,
        GNCComputer,
        FlightSimulator,
        RocketConfigs,
        createSimulation,
        runSimulation,
    };
}
