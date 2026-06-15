// ============================================================================
// MISSION FLOW — Orchestrator: click → generate → design → countdown → ascent → orbit
// ============================================================================
// Each step is a function. The flow dispatches state changes through the store
// and publishes events via the event bus. No direct DOM manipulation here
// except through UI module calls.

import { GM, RE, DEG, SCALE, EARTH_RADIUS_SCENE } from '../constants.js';
import { getState, dispatch } from '../store.js';
import { emit } from '../eventBus.js';
import { generateRocket } from '../rocket/generatorAdapter.js';
import { planMission } from '../rocket/mechanicsAdapter.js';
import { buildStageConfigs } from '../rocket/stageConfig.js';
import { FlightSim } from '../physics/flightSim.js';
import { showPanel, hidePanel, hideAll } from '../ui/panels.js';
import { buildDesignPanel } from '../ui/designPanel.js';
import { startCountdown as uiCountdown } from '../ui/countdown.js';
import { buildMissionTimeline } from '../ui/timeline.js';
import { buildEngineGrid } from '../ui/gncPanel.js';
import { addLogEntry, clearEventLog } from '../ui/eventLog.js';
import { updateTrackButton } from '../ui/controls.js';
import { setCountdownCancel } from './cancelController.js';

/**
 * Generate a rocket and mission plan for a given launch site.
 */
export function generateRocketForMission(lat, lon) {
  const absLat = Math.abs(lat);
  const orbitClass = (absLat > 60 || Math.random() < 0.35) ? 'SSO' : 'LEO';

  let rocket, mission;
  try {
    rocket = generateRocket(lat, orbitClass);
    mission = planMission({
      totalDeltaV: rocket.totalDeltaV || 9500,
      launchLatDeg: lat,
      launchLonDeg: lon,
      preferredOrbit: orbitClass,
    });
    // Clamp target altitude to LEO/SSO range
    if (mission.success && mission.selected) {
      if (mission.selected.altitude > 1200000) {
        mission.selected.altitude = 400000;
        mission.selected.altitudeKm = 400;
        mission.selected.name = 'LEO 400km';
        mission.selected.type = 'LEO';
      }
    }
  } catch (e) {
    console.warn('Generation failed, using fallback:', e);
    rocket = createFallbackRocket(orbitClass);
    const incDeg = orbitClass === 'SSO' ? 97.5 : Math.max(absLat, 28.5);
    const altKm = orbitClass === 'SSO' ? 600 : 400;
    mission = {
      success: true,
      selected: { type: orbitClass, name: orbitClass + ' Orbit', altitude: altKm * 1000, altitudeKm: altKm, inclinationDeg: incDeg, deltaVRequired: 9400 },
      budget: { gravityLoss: 1400, dragLoss: 200, steeringLoss: 150, total: 9400 },
      launch: { azimuthDeg: 90 },
    };
  }
  return { rocket, mission, orbitClass };
}

function createFallbackRocket(orbitClass) {
  const altitudes = { LEO: 400, SSO: 600, MEO: 20200, GTO: 250, GEO: 35786 };
  const dvs = { LEO: 9400, SSO: 9700, MEO: 12000, GTO: 11800, GEO: 13500 };
  return {
    name: 'Atlas-class Medium Lift',
    totalMass: 340000, payloadMass: 8000,
    totalDeltaV: dvs[orbitClass] || 9400,
    fairingDiameter: 4.2,
    stages: [
      { name: 'Stage 1', propellant: 'LOX/RP-1', engineCycle: 'gas-generator', engines: { count: 9, name: 'KE-1', thrustSL: 845000, thrustVac: 935000, ispSL: 282, ispVac: 311 }, propellantMass: 280000, dryMass: 22000, deltaV: 5800, burnTime: 162 },
      { name: 'Stage 2', propellant: 'LOX/RP-1', engineCycle: 'gas-generator', engines: { count: 1, name: 'VE-1', thrustSL: 0, thrustVac: 981000, ispSL: 0, ispVac: 348 }, propellantMass: 92000, dryMass: 4000, deltaV: 3600, burnTime: 397 },
    ],
    simulationParams: {
      stageSequence: [
        { thrustSL: 845000 * 9, thrustVac: 935000 * 9, ispSL: 282, ispVac: 311, propMass: 280000, dryMass: 22000, burnTime: 162, nEngines: 9, gimbalRange: 5 },
        { thrustSL: 0, thrustVac: 981000, ispSL: 348, ispVac: 348, propMass: 92000, dryMass: 4000, burnTime: 397, nEngines: 1, gimbalRange: 5 },
      ],
      cd: [0.3, 0.5, 0.2],
      fairingJettisonAlt: 110000,
      fairingMass: 1800,
      referenceArea: Math.PI * (4.2 / 2) ** 2,
    },
  };
}

/**
 * Build target orbit ring geometry (Three.js points array).
 */
export function buildOrbitRingPoints(mission) {
  if (!mission || !mission.success) return null;
  const alt = mission.selected.altitude || 400000;
  const inc = (mission.selected.inclinationDeg || 28.5) * DEG;
  const r = EARTH_RADIUS_SCENE + alt * SCALE;
  const points = [];
  for (let i = 0; i <= 128; i++) {
    const angle = (i / 128) * Math.PI * 2;
    const xEci = r * Math.cos(angle);
    const yEci = r * Math.sin(angle) * Math.cos(inc);
    const zEci = r * Math.sin(angle) * Math.sin(inc);
    points.push({ x: xEci, y: zEci, z: -yEci });
  }
  return points;
}

/**
 * Start the design phase: generate rocket, show design panel.
 */
export function startDesignPhase(lat, lon) {
  dispatch('SET_PHASE', 'DESIGN');
  hideAll();
  document.getElementById('subtitle').textContent = 'GENERATING VEHICLE...';

  setTimeout(() => {
    const { rocket, mission, orbitClass } = generateRocketForMission(lat, lon);
    dispatch('SET_ROCKET', { rocket, mission });

    // Build orbit ring (caller wires this to the render system)
    const ringPoints = buildOrbitRingPoints(mission);
    emit('orbit:ring', { points: ringPoints });

    buildDesignPanel(rocket, mission, orbitClass, lat, lon, () => {
      startCountdownPhase();
    });
    showPanel('design-panel');
    document.getElementById('subtitle').textContent = 'REVIEW VEHICLE — PRESS LAUNCH WHEN READY';
  }, 500);
}

/**
 * Start the countdown phase.
 */
function startCountdownPhase() {
  dispatch('SET_PHASE', 'COUNTDOWN');
  hideAll();

  const cancelFn = uiCountdown(() => {
    startAscentPhase();
  });
  setCountdownCancel(cancelFn);
}

/**
 * Start the ascent phase: create FlightSim, wire telemetry.
 */
function startAscentPhase() {
  dispatch('RESET_SIM_STATE');
  dispatch('SET_PHASE', 'ASCENT');
  dispatch('SET_TRACKING', true);
  dispatch('SNAPSHOT_EARTH_ROTATION');
  const state = getState();
  hideAll();
  showPanel('telemetry-panel');
  showPanel('gnc-panel');
  showPanel('stage-log');
  showPanel('trajectory-plot');
  showPanel('met-display');
  showPanel('timeline-bar');
  if (state.showAdvanced) showPanel('adv-panel');
  if (state.orbitalObjects.length > 0) showPanel('tracking-panel');
  document.getElementById('subtitle').textContent = '';

  // Clear previous mission's event log
  clearEventLog();
  addLogEntry('LIFTOFF', true, 0, state.eventLog);

  const rocket = state.rocket;
  const mission = state.mission;
  const sel = mission?.selected || {};

  // Build stage configs
  const { stages: simStages, payloadMass, fairingDiameter } = buildStageConfigs(rocket, mission);

  const simConfig = {
    stages: simStages,
    payloadMass,
    fairingDiameter,
    launchLat: state.launchLat,
    launchLon: state.launchLon,
    earthRotationAngle: state.earthRotation,
  };

  const targetOrbit = {
    altitude: sel.altitude || 400000,
    inclination: sel.inclinationDeg || 28.5,
  };

  const sim = new FlightSim(simConfig, targetOrbit);
  dispatch('SET_SIMULATOR', sim);
  dispatch('UPDATE_SIM_TIME', 0);

  // Build engine grid
  const rocketStages = rocket.stages || [];
  const engineCounts = rocketStages.map(s => s.engineCount || s.engines?.count || 1);
  state.engineCounts = engineCounts;
  state.totalStages = simStages.length;
  buildEngineGrid(engineCounts[0] || 1);

  // Build mission timeline
  buildMissionTimeline(simStages.length, rocket);

  updateTrackButton();

  // Emit ascent started for rendering modules
  emit('ascent:started', { sim, simConfig, targetOrbit });
}

/**
 * Handle orbit achieved — create orbital object, transition state.
 */
export function handleOrbitAchieved() {
  const state = getState();
  dispatch('SET_PHASE', 'ORBIT_ACHIEVED');
  dispatch('SET_TRACKING', false);
  updateTrackButton();

  if (state.simulator) {
    const s = state.simulator.state;
    const rocketName = state.rocket?.id || state.rocket?.name || 'Payload';
    const eciState = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };

    // Verify orbit stability
    const _r = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    const _v2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
    const _energy = 0.5 * _v2 - GM / _r;
    const _sma = _energy < 0 ? -GM / (2 * _energy) : Infinity;
    const _rDotV = s.x * s.vx + s.y * s.vy + s.z * s.vz;
    const _vRad = _rDotV / _r;
    const _vTang = Math.sqrt(Math.max(0, _v2 - _vRad * _vRad));
    const _h = _vTang * _r;
    const _ecc = _sma < Infinity ? Math.sqrt(Math.max(0, 1 - (_h * _h) / (GM * _sma))) : 1;
    const _peri = _sma < Infinity ? _sma * (1 - _ecc) : 0;

    const isStable = _peri > RE;
    emit('orbital:create', {
      type: isStable ? 'payload' : 'stage',
      eciState,
      color: isStable ? 0x00e676 : 0xffd600,
      name: isStable ? rocketName : rocketName + ' (suborbital)',
    });

    emit('rocket:hide');
  }

  showPanel('tracking-panel');
  addLogEntry('ORBIT INSERTION CONFIRMED', true, state.simTime, state.eventLog);

  const nObjects = state.orbitalObjects.filter(o => o.type === 'payload' && !o.impacted).length;
  document.getElementById('subtitle').textContent =
    `ORBIT ACHIEVED — ${nObjects} object${nObjects !== 1 ? 's' : ''} in orbit`;
  setTimeout(() => {
    if (getState().phase === 'ORBIT_ACHIEVED') {
      document.getElementById('subtitle').textContent = 'CLICK EARTH TO SELECT LAUNCH SITE';
    }
  }, 5000);

  dispatch('SET_SIMULATOR', null);
}

/**
 * Handle mission end (abort/crash) — show failure message.
 */
export function handleMissionEnd(message) {
  dispatch('SET_PHASE', 'ORBIT_ACHIEVED');
  dispatch('SET_TRACKING', false);
  updateTrackButton();
  emit('rocket:hide');
  dispatch('SET_SIMULATOR', null);

  const state = getState();
  addLogEntry(message, true, state.simTime, state.eventLog);
  document.getElementById('subtitle').textContent = message;
  showPanel('tracking-panel');

  setTimeout(() => {
    if (getState().phase === 'ORBIT_ACHIEVED') {
      document.getElementById('subtitle').textContent = 'CLICK EARTH TO SELECT LAUNCH SITE';
    }
  }, 5000);
}
