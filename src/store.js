// ============================================================================
// STATE STORE — Central state with named actions
// ============================================================================
// Read via getState(). Write via dispatch(action, payload).
// Phase changes emit 'phase:changed' on the event bus.

import { emit } from './eventBus.js';

const WARP_LEVELS = [1, 2, 4, 10, 25, 50, 100];

const state = {
  // Phase
  phase: 'IDLE',  // IDLE | DESIGN | COUNTDOWN | ASCENT | ORBIT_ACHIEVED

  // Vehicle & mission
  rocket: null,
  mission: null,
  simulator: null,

  // Launch site
  launchLat: 0,
  launchLon: 0,

  // Time
  simTime: 0,
  globalTime: 0,
  earthRotation: 0,
  launchEarthRotation: 0,

  // Camera
  cameraTracking: true,

  // Persistent orbital objects
  orbitalObjects: [],

  // UI toggles
  showAdvanced: false,

  // Time warp
  warpIndex: 0,
  timeWarp: 1,

  // Countdown
  countdown: 10,

  // Data
  trajectoryPoints: [],
  eventLog: [],

  // Dynamic (set during ascent)
  engineCounts: [],
  totalStages: 0,
  timelineReached: new Set(),
  timelineEventTimes: {},
  timelineMilestones: [],
};

/** Read state (treat as read-only outside dispatch) */
export function getState() {
  return state;
}

/** Named state mutations */
export function dispatch(action, payload) {
  switch (action) {
    case 'SET_PHASE': {
      const from = state.phase;
      state.phase = payload;
      emit('phase:changed', { from, to: payload });
      break;
    }
    case 'SET_ROCKET':
      state.rocket = payload.rocket;
      state.mission = payload.mission;
      emit('vehicle:generated', payload);
      break;
    case 'SET_SIMULATOR':
      state.simulator = payload;
      break;
    case 'SET_LAUNCH_SITE':
      state.launchLat = payload.lat;
      state.launchLon = payload.lon;
      break;
    case 'UPDATE_SIM_TIME':
      state.simTime = payload;
      break;
    case 'UPDATE_GLOBAL_TIME':
      state.globalTime += payload;
      break;
    case 'SET_EARTH_ROTATION':
      state.earthRotation = payload;
      break;
    case 'SNAPSHOT_EARTH_ROTATION':
      state.launchEarthRotation = state.earthRotation;
      break;
    case 'ADD_ORBITAL_OBJECT':
      state.orbitalObjects.push(payload);
      break;
    case 'TOGGLE_TRACKING':
      state.cameraTracking = !state.cameraTracking;
      emit('camera:mode', { tracking: state.cameraTracking });
      break;
    case 'SET_TRACKING':
      state.cameraTracking = payload;
      emit('camera:mode', { tracking: payload });
      break;
    case 'CYCLE_WARP': {
      const dir = payload; // +1 or -1
      state.warpIndex = Math.max(0, Math.min(WARP_LEVELS.length - 1, state.warpIndex + dir));
      state.timeWarp = WARP_LEVELS[state.warpIndex];
      emit('warp:changed', { level: state.timeWarp, index: state.warpIndex });
      break;
    }
    case 'TOGGLE_ADVANCED':
      state.showAdvanced = !state.showAdvanced;
      break;
    case 'RESET_MISSION':
      state.rocket = null;
      state.mission = null;
      state.simulator = null;
      state.simTime = 0;
      state.trajectoryPoints = [];
      state.eventLog = [];
      state.engineCounts = [];
      state.totalStages = 0;
      state.timelineReached = new Set();
      state.timelineEventTimes = {};
      state.timelineMilestones = [];
      break;
    case 'RESET_SIM_STATE':
      // Light reset: clear sim-loop data but keep rocket/mission
      state.simulator = null;
      state.simTime = 0;
      state.trajectoryPoints = [];
      state.eventLog = [];
      state.engineCounts = [];
      state.totalStages = 0;
      state.timelineReached = new Set();
      state.timelineEventTimes = {};
      state.timelineMilestones = [];
      break;
    case 'RESET_WARP':
      state.warpIndex = 0;
      state.timeWarp = 1;
      break;
    default:
      console.warn('Unknown action:', action);
  }
}

export { WARP_LEVELS };
