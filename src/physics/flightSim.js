// ============================================================================
// FLIGHT SIM WRAPPER — Bridges GNC system (gnc.js) to main.js interface
// ============================================================================
// The GNC system (window.OrbitSim) uses {pos:{x,y,z}, vel:{x,y,z}} state.
// main.js expects flat state: {x, y, z, vx, vy, vz, mass, time}.
// This wrapper translates between the two and exposes the exact interface
// that main.js, missionFlow.js, telemetry.js, and trackingPanel.js expect.

import { GM, RE, G0, OMEGA } from '../constants.js';
import {
  GNCComputer, FlightSimulator, FlightPhase as GNCFlightPhase,
  Vec3, atmosphereModel, orbitalElements,
} from './gncAdapter.js';

// Re-export FlightPhase with the values main.js checks against.
// main.js compares sim.phase to string literals like 'ORBIT_ACHIEVED' and 'ABORT'.
// The GNC system has additional phases (STAGING, PRE_STAGING, COAST_TO_APOAPSIS, etc.)
// that we map to the phases main.js understands.
export const FlightPhase = {
  PRELAUNCH:      'PRELAUNCH',
  VERTICAL_RISE:  'VERTICAL_RISE',
  GRAVITY_TURN:   'GRAVITY_TURN',
  UPPER_STAGE:    'UPPER_STAGE',
  COAST:          'COAST',
  CIRCULARIZE:    'CIRCULARIZE',
  ORBIT_ACHIEVED: 'ORBIT_ACHIEVED',
  ABORT:          'ABORT',
};

// Map GNC phases to the phases main.js understands
const PHASE_MAP = {
  [GNCFlightPhase.PRELAUNCH]:         FlightPhase.PRELAUNCH,
  [GNCFlightPhase.IGNITION]:          FlightPhase.VERTICAL_RISE,
  [GNCFlightPhase.VERTICAL_RISE]:     FlightPhase.VERTICAL_RISE,
  [GNCFlightPhase.GRAVITY_TURN]:      FlightPhase.GRAVITY_TURN,
  [GNCFlightPhase.MAX_Q_THROTTLE]:    FlightPhase.GRAVITY_TURN,
  [GNCFlightPhase.PRE_STAGING]:       FlightPhase.GRAVITY_TURN,
  [GNCFlightPhase.STAGING]:           FlightPhase.UPPER_STAGE,
  [GNCFlightPhase.UPPER_STAGE]:       FlightPhase.UPPER_STAGE,
  [GNCFlightPhase.COAST_TO_APOAPSIS]: FlightPhase.COAST,
  [GNCFlightPhase.CIRCULARIZE]:       FlightPhase.CIRCULARIZE,
  [GNCFlightPhase.ORBIT_ACHIEVED]:    FlightPhase.ORBIT_ACHIEVED,
  [GNCFlightPhase.ABORT]:             FlightPhase.ABORT,
};

/**
 * Convert simStages (from stageConfig.js) into the format GNCComputer expects.
 *
 * stageConfig produces: { dryMass, propMass, thrustSL, thrustVac, ispSL, ispVac, refArea }
 * GNCComputer expects:  { dryMass, propellantMass, thrust, thrustVac, isp, ispVac, nEngines, ... }
 */
function convertStagesToGNCFormat(simStages) {
  return simStages.map(s => ({
    dryMass:        s.dryMass,
    propellantMass: s.propMass,
    thrust:         s.thrustSL || s.thrustVac,  // GNC uses "thrust" as primary
    thrustVac:      s.thrustVac,
    isp:            s.ispSL || s.ispVac,
    ispVac:         s.ispVac,
    nEngines:       s.nEngines || 1,
    burnTime:       s.burnTime || (s.propMass / ((s.thrustVac) / (s.ispVac * G0))),
  }));
}

export class FlightSim {
  /**
   * Constructor matches the interface missionFlow.js uses:
   *   const sim = new FlightSim(simConfig, targetOrbit)
   *
   * simConfig = { stages, payloadMass, fairingDiameter, launchLat, launchLon, earthRotationAngle }
   * targetOrbit = { altitude, inclination }
   *
   * @param {Object} rocketConfig - Vehicle configuration from buildStageConfigs + launch params
   * @param {Object} targetOrbit - { altitude: m, inclination: deg }
   */
  constructor(rocketConfig, targetOrbit) {
    this.rocketConfig = rocketConfig;
    this.target = targetOrbit;

    // Convert stage format for GNC
    const gncStages = convertStagesToGNCFormat(rocketConfig.stages);

    // Build the rocket config object the GNC system expects
    const gncRocketConfig = {
      name:               'Generated Vehicle',
      diameter:           rocketConfig.fairingDiameter || 3.7,
      referenceArea:      Math.PI * ((rocketConfig.fairingDiameter || 3.7) / 2) ** 2,
      payloadMass:        rocketConfig.payloadMass || 5000,
      launchLatitude:     rocketConfig.launchLat || 28.5,
      countdownTime:      0,  // No countdown; missionFlow handles that
      kickAngle:          5.0,
      kickAltitude:       300,
      maxQLimit:          35000,
      gimbalRateLimit:    5.0,
      stageSeparationDelay: 1.5,
      stages:             gncStages,
    };

    // Compute initial state in ECI (same as original FlightSim)
    const lat = (rocketConfig.launchLat || 28.5) * Math.PI / 180;
    const ecefLon = (rocketConfig.launchLon || -80.6) * Math.PI / 180;
    const earthRot = rocketConfig.earthRotationAngle || 0;
    const lon = ecefLon + earthRot;

    // Total mass
    let totalMass = rocketConfig.payloadMass || 5000;
    for (const s of rocketConfig.stages) {
      totalMass += (s.dryMass || 0) + (s.propMass || 0);
    }

    // Initial ECI state
    const initialState = {
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
      mass: totalMass,
      time: 0,
    };

    // Create GNC computer and flight simulator
    this._gnc = new GNCComputer(gncRocketConfig, {
      altitude: targetOrbit.altitude || 400000,
      inclination: targetOrbit.inclination || 28.5,
    });

    // Skip prelaunch/ignition — go straight to VERTICAL_RISE
    this._gnc.phase = GNCFlightPhase.VERTICAL_RISE;
    this._gnc.phaseTime = 0;
    this._gnc.throttle = 1.0;
    this._gnc.missionTime = 0;

    this._sim = new FlightSimulator(gncRocketConfig, this._gnc, initialState);

    // ------------------------------------------------------------------
    // Public interface properties (what main.js reads)
    // ------------------------------------------------------------------

    // Flat state: main.js accesses sim.state.x, sim.state.vx, etc.
    this.state = {
      x: initialState.pos.x,
      y: initialState.pos.y,
      z: initialState.pos.z,
      vx: initialState.vel.x,
      vy: initialState.vel.y,
      vz: initialState.vel.z,
      mass: initialState.mass,
      time: 0,
    };

    this.phase = FlightPhase.VERTICAL_RISE;
    this.currentStage = 0;
    this.stagePropUsed = 0;
    this.throttle = 1.0;
    this.pitchAngle = Math.PI / 2;  // Start vertical
    this.maxQ = 0;
    this.maxG = 0;
    this.running = true;
    this.events = [{ t: 0, msg: 'LIFTOFF' }];
    this.trajectory = [];

    // Internal tracking
    this._prevPhase = GNCFlightPhase.VERTICAL_RISE;
    this._prevStage = 0;
    this._maxQDeclining = false;
    this._totalPropByStage = rocketConfig.stages.map(s => s.propMass);
    this._initialMassByStage = this._computeInitialMassByStage(rocketConfig);
  }

  /**
   * Compute the initial mass at the start of each stage burn.
   * Used to derive how much propellant has been consumed.
   */
  _computeInitialMassByStage(config) {
    let mass = config.payloadMass || 5000;
    for (const s of config.stages) {
      mass += (s.dryMass || 0) + (s.propMass || 0);
    }
    const result = [mass];
    for (let i = 0; i < config.stages.length - 1; i++) {
      mass -= (config.stages[i].dryMass || 0) + (config.stages[i].propMass || 0);
      result.push(mass);
    }
    return result;
  }

  /**
   * Advance the simulation by dt seconds.
   * Called from main.js: sim.step(SIM_DT)
   */
  step(dt) {
    if (!this.running) return;

    const prevGncPhase = this._gnc.phase;

    // Run the GNC simulator's step
    this._sim.step(dt);

    // Sync flat state from GNC's nested state
    const gncState = this._sim.state;
    this.state.x    = gncState.pos.x;
    this.state.y    = gncState.pos.y;
    this.state.z    = gncState.pos.z;
    this.state.vx   = gncState.vel.x;
    this.state.vy   = gncState.vel.y;
    this.state.vz   = gncState.vel.z;
    this.state.mass = gncState.mass;
    this.state.time = gncState.time;

    // Map GNC phase to main.js phase
    const gncPhase = this._gnc.phase;
    this.phase = PHASE_MAP[gncPhase] || gncPhase;

    // Sync other properties
    this.currentStage = this._gnc.currentStage;
    this.throttle = this._gnc.throttle;
    this.pitchAngle = this._gnc.commandedPitch;

    // Compute stagePropUsed from mass difference
    const stageIdx = this.currentStage;
    if (stageIdx < this._initialMassByStage.length) {
      const expectedMassAtStageStart = this._initialMassByStage[stageIdx];
      this.stagePropUsed = Math.max(0, expectedMassAtStageStart - gncState.mass);
      // Clamp to total propellant for this stage
      if (stageIdx < this._totalPropByStage.length) {
        this.stagePropUsed = Math.min(this.stagePropUsed, this._totalPropByStage[stageIdx]);
      }
    }

    // Track max-Q
    const r = Math.sqrt(this.state.x ** 2 + this.state.y ** 2 + this.state.z ** 2);
    const alt = r - RE;
    if (alt >= 0 && alt < 150000) {
      const atm = atmosphereModel(alt);
      const vEx = this.state.vx + OMEGA * this.state.y;
      const vEy = this.state.vy - OMEGA * this.state.x;
      const vEz = this.state.vz;
      const airspeed = Math.sqrt(vEx * vEx + vEy * vEy + vEz * vEz);
      const q = 0.5 * atm.rho * airspeed * airspeed;
      if (q > this.maxQ) {
        this.maxQ = q;
        this._maxQDeclining = false;
      } else if (!this._maxQDeclining && this.maxQ > 10000 && q < this.maxQ * 0.95) {
        this._maxQDeclining = true;
        this.events.push({ t: this.state.time, msg: 'MAX-Q' });
      }
    }

    // Track max-G
    const stage = this.rocketConfig.stages[stageIdx];
    if (stage && this.throttle > 0 && this.state.mass > 0) {
      const gForce = (stage.thrustVac * this.throttle) / (this.state.mass * G0);
      if (gForce > this.maxG) this.maxG = gForce;
    }

    // Generate events for phase transitions
    if (gncPhase !== prevGncPhase) {
      this._emitPhaseEvents(prevGncPhase, gncPhase);
    }

    // Staging events (stage number changed)
    if (this._gnc.currentStage !== this._prevStage) {
      const oldStage = this._prevStage;
      this._prevStage = this._gnc.currentStage;
      this.events.push({ t: this.state.time, msg: `STAGE ${oldStage + 1} SEP` });
      this.events.push({ t: this.state.time, msg: `STAGE ${this._gnc.currentStage + 1} IGNITION` });
    }

    // Terminal conditions
    if (this.phase === FlightPhase.ORBIT_ACHIEVED) {
      this.running = false;
    }
    if (!this._sim.running && this.phase !== FlightPhase.ORBIT_ACHIEVED) {
      // GNC sim stopped without achieving orbit -- impact or abort
      this.running = false;
      this.phase = FlightPhase.ABORT;
      this.events.push({ t: this.state.time, msg: 'IMPACT' });
    }

    // Timeout
    if (this.state.time > 3600) {
      this.running = false;
      this.phase = FlightPhase.ORBIT_ACHIEVED;
    }

    // Record trajectory
    if (this.trajectory.length === 0 || this.state.time - this.trajectory[this.trajectory.length - 1].t > 1) {
      this.trajectory.push({
        t: this.state.time,
        x: this.state.x, y: this.state.y, z: this.state.z,
        vx: this.state.vx, vy: this.state.vy, vz: this.state.vz,
        mass: this.state.mass, phase: this.phase,
      });
    }
  }

  /**
   * Emit user-facing events when GNC phase changes.
   */
  _emitPhaseEvents(prevPhase, newPhase) {
    const t = this.state.time;

    switch (newPhase) {
      case GNCFlightPhase.GRAVITY_TURN:
        this.events.push({ t, msg: 'PITCH PROGRAM' });
        break;
      case GNCFlightPhase.PRE_STAGING:
        // Will emit SEP when stage number actually changes
        break;
      case GNCFlightPhase.UPPER_STAGE:
        // Stage ignition handled by stage number check
        break;
      case GNCFlightPhase.COAST_TO_APOAPSIS:
        this.events.push({ t, msg: 'MECO' });
        break;
      case GNCFlightPhase.CIRCULARIZE:
        this.events.push({ t, msg: 'CIRC BURN START' });
        break;
      case GNCFlightPhase.ORBIT_ACHIEVED:
        this.events.push({ t, msg: 'ORBIT ACHIEVED' });
        break;
      case GNCFlightPhase.ABORT:
        this.events.push({ t, msg: 'ABORT' });
        break;
    }
  }

  /**
   * Get telemetry snapshot.
   * Called by main.js:          const telem = sim.getTelemetry()
   * Called by trackingPanel.js:  const telem = simulator.getTelemetry()
   *
   * Must return the same shape as the original FlightSim.getTelemetry().
   */
  getTelemetry() {
    const s = this.state;
    const r = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    const alt = r - RE;
    const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);

    // Earth-relative velocity (for airspeed, mach, dynamic pressure)
    const vRelX = s.vx + OMEGA * s.y;
    const vRelY = s.vy - OMEGA * s.x;
    const vRelZ = s.vz;
    const airspeed = Math.sqrt(vRelX * vRelX + vRelY * vRelY + vRelZ * vRelZ);

    const atm = atmosphereModel(Math.max(0, alt));
    const mach = atm.speedOfSound > 0 ? airspeed / atm.speedOfSound : 0;
    const q = 0.5 * atm.rho * airspeed * airspeed;

    // Radial and tangential velocity
    const rHat = { x: s.x / r, y: s.y / r, z: s.z / r };
    const vRadial = s.vx * rHat.x + s.vy * rHat.y + s.vz * rHat.z;
    const vTangSq = speed * speed - vRadial * vRadial;
    const vTang = Math.sqrt(Math.max(0, vTangSq));

    // Propellant remaining
    const stageIdx = this.currentStage;
    const totalProp = stageIdx < this._totalPropByStage.length ? this._totalPropByStage[stageIdx] : 1;
    const propRemaining = Math.max(0, 1 - this.stagePropUsed / Math.max(totalProp, 1));

    // Acceleration
    const stage = this.rocketConfig.stages[stageIdx];
    const acceleration = (stage && this.throttle > 0 && s.mass > 0)
      ? (stage.thrustVac * this.throttle) / s.mass
      : 0;

    // Orbital elements
    const pos = { x: s.x, y: s.y, z: s.z };
    const vel = { x: s.vx, y: s.vy, z: s.vz };
    const hVec = {
      x: pos.y * vel.z - pos.z * vel.y,
      y: pos.z * vel.x - pos.x * vel.z,
      z: pos.x * vel.y - pos.y * vel.x,
    };
    const hMag = Math.sqrt(hVec.x * hVec.x + hVec.y * hVec.y + hVec.z * hVec.z);
    const energy = 0.5 * speed * speed - GM / r;
    const a = energy < 0 ? -GM / (2 * energy) : Infinity;

    // Eccentricity via e = (1/mu)(v x h) - r_hat
    const vCrossH = {
      x: vel.y * hVec.z - vel.z * hVec.y,
      y: vel.z * hVec.x - vel.x * hVec.z,
      z: vel.x * hVec.y - vel.y * hVec.x,
    };
    const eVec = {
      x: vCrossH.x / GM - rHat.x,
      y: vCrossH.y / GM - rHat.y,
      z: vCrossH.z / GM - rHat.z,
    };
    const e = Math.sqrt(eVec.x * eVec.x + eVec.y * eVec.y + eVec.z * eVec.z);
    const inc = Math.acos(Math.max(-1, Math.min(1, hVec.z / hMag))) * 180 / Math.PI;
    const apoAlt = a < Infinity ? a * (1 + e) - RE : Infinity;
    const periAlt = a < Infinity ? a * (1 - e) - RE : -RE;
    const period = a > 0 && a < Infinity ? 2 * Math.PI * Math.sqrt(a * a * a / GM) : Infinity;

    return {
      altitude: alt,
      speed,
      airspeed,
      mach,
      dynamicPressure: q,
      acceleration,
      pitchAngle: this.pitchAngle * 180 / Math.PI,
      heading: 0,
      throttle: this.throttle,
      phase: this.phase,
      currentStage: this.currentStage,
      propellantRemaining: propRemaining,
      gimbalPitch: (this._gnc.gimbalPitch || 0) * 180 / Math.PI,
      gimbalYaw: (this._gnc.gimbalYaw || 0) * 180 / Math.PI,
      time: s.time,
      maxQ: this.maxQ,
      maxG: this.maxG,
      orbitalElements: { a, e, inc, apoAlt, periAlt, period },
    };
  }
}
