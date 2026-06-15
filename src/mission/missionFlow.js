// ============================================================================
// MISSION FLOW — Orchestrator: click → generate → design → countdown → ascent → orbit
// ============================================================================

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
 * Uses generateViableRocket — no fallbacks, no hardcoded vehicles.
 */
export function generateRocketForMission(lat, lon) {
  const absLat = Math.abs(lat);
  const orbitClass = (absLat > 60 || Math.random() < 0.35) ? 'SSO' : 'LEO';

  for (let attempt = 0; attempt < 40; attempt++) {
    const payloadMass = Math.round(3000 + Math.random() * 7000);
    const rocket = generateRocket(lat, orbitClass, { payloadMass });
    if (!rocket.validation.valid) continue;

    const mission = planMission({
      totalDeltaV: rocket.validation.totalDeltaV,
      launchLatDeg: lat,
      launchLonDeg: lon,
      preferredOrbit: orbitClass,
    });

    if (!mission.success || !mission.selected) continue;

    if (mission.selected.altitude > 1200000) {
      mission.selected.altitude = 400000;
      mission.selected.altitudeKm = 400;
      mission.selected.name = 'LEO 400km';
      mission.selected.type = 'LEO';
    }

    try {
      buildStageConfigs(rocket, mission);
      return { rocket, mission, orbitClass };
    } catch (e) {
      continue;
    }
  }

  throw new Error(`No valid vehicle in 40 attempts at ${lat}° for ${orbitClass}`);
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
    try {
      const { rocket, mission, orbitClass } = generateRocketForMission(lat, lon);
      dispatch('SET_ROCKET', { rocket, mission });

      const ringPoints = buildOrbitRingPoints(mission);
      emit('orbit:ring', { points: ringPoints });

      buildDesignPanel(rocket, mission, orbitClass, lat, lon, () => {
        startCountdownPhase();
      });
      showPanel('design-panel');
      document.getElementById('subtitle').textContent = 'REVIEW VEHICLE — PRESS LAUNCH WHEN READY';
    } catch (e) {
      console.error('[Launch Grammar] Generation failed:', e);
      document.getElementById('subtitle').textContent = 'GENERATION FAILED — CLICK ANOTHER SITE';
      dispatch('SET_PHASE', 'IDLE');
    }
  }, 500);
}

function startCountdownPhase() {
  dispatch('SET_PHASE', 'COUNTDOWN');
  hideAll();

  const cancelFn = uiCountdown(() => {
    startAscentPhase();
  });
  setCountdownCancel(cancelFn);
}

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

  clearEventLog();
  addLogEntry('LIFTOFF', true, 0, state.eventLog);

  const rocket = state.rocket;
  const mission = state.mission;
  const sel = mission?.selected || {};

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

  const rocketStages = rocket.stages || [];
  const engineCounts = rocketStages.map(s => s.engineCount || s.engines?.count || 1);
  state.engineCounts = engineCounts;
  state.totalStages = simStages.length;
  buildEngineGrid(engineCounts[0] || 1);

  buildMissionTimeline(simStages.length, rocket);

  updateTrackButton();
  emit('ascent:started', { sim, simConfig, targetOrbit });
}

export function handleOrbitAchieved() {
  const state = getState();
  dispatch('SET_PHASE', 'ORBIT_ACHIEVED');
  dispatch('SET_TRACKING', false);
  updateTrackButton();

  if (state.simulator) {
    const s = state.simulator.state;
    const rocketName = state.rocket?.id || state.rocket?.name || 'Payload';
    const eciState = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };

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
