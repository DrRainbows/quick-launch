// ============================================================================
// MAIN — Entry point: bootstrap scene, wire event bus, animation loop
// ============================================================================
// This is the only file that imports everything. It wires modules together
// through the event bus and runs the animation loop.

import { SCALE, DEG, RAD } from './constants.js';
import { getState, dispatch } from './store.js';
import { on, emit } from './eventBus.js';
import { latLonToScene, sceneToLatLon, eciToScene } from './coords/transforms.js';

// Render
import { initScene } from './render/sceneSetup.js';
import { createEarth } from './render/earth.js';
import { createStars } from './render/stars.js';
import {
  createRocketVisual, updateRocketVisual, resetTrail,
  getRocketGroup, updateOrbitRing, hideOrbitRing,
  showStageSep, setSpentStageFadeStart, setRocketModel
} from './render/rocketVisual.js';
import { updateCameraFollow, snapToLaunchSite } from './render/camera.js';
import {
  createOrbitalObject, updateOrbitalVisuals, handleImpact,
  createImpactMarker, cleanupOrbitalObject
} from './render/orbitalObjects.js';
import { initGroundTrack, addGroundTrack } from './render/groundTrack.js';

// Physics
import { propagateObject } from './physics/orbitalPropagator.js';

// UI
import { showPanel, hidePanel, hideAll } from './ui/panels.js';
import { updateTelemetryDisplay } from './ui/telemetry.js';
import { updateGncDisplay } from './ui/gncPanel.js';
import { updateTimeline, updateTimelineProgress } from './ui/timeline.js';
import { addLogEntry } from './ui/eventLog.js';
import { updateTrackingPanel } from './ui/trackingPanel.js';
import { updateTrajectoryPlot } from './ui/trajectoryPlot.js';
import { initControls, updateTrackButton } from './ui/controls.js';

// Mission
import { startDesignPhase, handleOrbitAchieved, handleMissionEnd } from './mission/missionFlow.js';
import { cancelMission } from './mission/cancelController.js';

// Audio
import {
  initAudio, updateAudio, triggerStaging, triggerOrbitAchieved,
  setMuted, isMuted, cleanup as cleanupAudio
} from './audio/engine.js';

// =========================================================================
// INIT
// =========================================================================
const { scene, camera, renderer, controls, sunLight } = initScene();
createStars(scene);
const { earthGroup, earthMesh, earthUniforms, launchMarker } = createEarth(scene, sunLight);
const { rocketGroup, orbitRing } = createRocketVisual(scene);

// Initialize controls
initControls(renderer.domElement);

// Initialize ground track system
initGroundTrack(earthGroup);

function toVector3(p) {
  return new THREE.Vector3(p.x, p.y, p.z);
}

// =========================================================================
// CLICK HANDLER — Site selection
// =========================================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

renderer.domElement.addEventListener('click', (e) => {
  // Initialize audio on first user gesture (browser requirement)
  initAudio();

  const state = getState();
  if (state.phase !== 'IDLE' && state.phase !== 'ORBIT_ACHIEVED') return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObject(earthMesh);
  if (intersects.length === 0) return;

  const point = intersects[0].point;
  const invRotation = new THREE.Quaternion().copy(earthGroup.quaternion).invert();
  const localPoint = point.clone().applyQuaternion(invRotation);
  const { lat, lon } = sceneToLatLon(localPoint);

  dispatch('SET_LAUNCH_SITE', { lat, lon });

  // Place marker
  launchMarker.position.copy(toVector3(latLonToScene(lat, lon, 0)));
  launchMarker.lookAt(new THREE.Vector3(0, 0, 0));
  launchMarker.visible = true;

  // Show site selection UI
  const latStr = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
  document.getElementById('site-coords').textContent = `${latStr}, ${lonStr}`;
  const minInc = Math.abs(lat).toFixed(1);
  const eastBoost = (465.1 * Math.cos(lat * Math.PI / 180)).toFixed(0);
  document.getElementById('site-orbit-info').textContent =
    `Min inclination: ${minInc}°  |  Eastward boost: ${eastBoost} m/s`;
  showPanel('site-selected');
  document.getElementById('subtitle').textContent = 'LAUNCH SITE SELECTED';

  if (state.phase === 'ORBIT_ACHIEVED') {
    dispatch('SET_PHASE', 'IDLE');
  }
});

// Generate vehicle button
document.getElementById('generate-btn')?.addEventListener('click', () => {
  initAudio(); // Ensure audio context is ready (user gesture)
  const state = getState();
  if (state.launchLat !== undefined) {
    hidePanel('site-selected');
    startDesignPhase(state.launchLat, state.launchLon);
  }
});

// Mute/unmute button
document.getElementById('audio-mute-btn')?.addEventListener('click', () => {
  initAudio(); // Ensure audio context exists
  const nowMuted = !isMuted();
  setMuted(nowMuted);
  const btn = document.getElementById('audio-mute-btn');
  if (btn) {
    btn.textContent = nowMuted ? 'UNMUTE' : 'MUTE';
    btn.title = nowMuted ? 'Unmute audio' : 'Mute audio';
    btn.classList.toggle('muted', nowMuted);
  }
});

// Mouse move for coordinate display
renderer.domElement.addEventListener('mousemove', (e) => {
  const state = getState();
  if (state.phase !== 'IDLE' && state.phase !== 'ORBIT_ACHIEVED') return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(earthMesh);
  const coordEl = document.getElementById('coord-display');
  if (intersects.length > 0) {
    const invRotation = new THREE.Quaternion().copy(earthGroup.quaternion).invert();
    const localPoint = intersects[0].point.clone().applyQuaternion(invRotation);
    const { lat, lon } = sceneToLatLon(localPoint);
    coordEl.textContent = `${lat.toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
    renderer.domElement.classList.add('earth-hover');
  } else {
    coordEl.textContent = '';
    renderer.domElement.classList.remove('earth-hover');
  }
});

// =========================================================================
// EVENT BUS WIRING
// =========================================================================

// Free camera: reset controls target to Earth center for useful orbiting
on('camera:mode', ({ tracking }) => {
  if (!tracking) {
    controls.target.set(0, 0, 0);
  }
});

// Orbit ring from mission flow
on('orbit:ring', ({ points }) => {
  if (points) {
    const threePoints = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    updateOrbitRing(threePoints);
  }
});

// Orbital object creation
on('orbital:create', ({ type, eciState, color, name }) => {
  const state = getState();
  const obj = createOrbitalObject(scene, type, eciState, color, name, state.globalTime);
  dispatch('ADD_ORBITAL_OBJECT', obj);

  // Draw ground track for payloads that achieved orbit
  if (type === 'payload') {
    addGroundTrack(obj, state.earthRotation);
  }
});

// Hide rocket
on('rocket:hide', () => {
  rocketGroup.visible = false;
});

// Ascent started — show rocket, reset loop state, snap camera
on('ascent:started', ({ sim }) => {
  // Build vehicle model from generator specs
  const state = getState();
  if (state.rocket) {
    setRocketModel(state.rocket);
  }

  rocketGroup.visible = true;
  launchMarker.visible = false;
  resetTrail();
  dispatch('RESET_WARP');

  // Reset simulation loop state
  simAccumulator = 0;
  lastPhaseReported = '';
  eventCursor = sim.events.length; // Skip initial LIFTOFF (already logged by missionFlow)

  // Position rocket at launch site immediately (avoid 1-frame glitch at origin)
  updateRocketVisual(sim.state, camera, 0);

  // Snap camera to launch site
  snapToLaunchSite(camera, controls, sim.state);
});

// =========================================================================
// SIMULATION LOOP
// =========================================================================
const SIM_DT = 0.05;
let simAccumulator = 0;
let lastPhaseReported = '';
let eventCursor = 0;

function simulationStep(dtWall) {
  const state = getState();
  if (state.phase !== 'ASCENT' || !state.simulator) return;
  const sim = state.simulator;

  simAccumulator += dtWall * state.timeWarp;
  simAccumulator = Math.min(simAccumulator, 2.0);

  let stepsThisFrame = 0;
  while (simAccumulator >= SIM_DT) {
    simAccumulator -= SIM_DT;
    stepsThisFrame++;

    try {
      sim.step(SIM_DT);
      dispatch('UPDATE_SIM_TIME', sim.state.time);
    } catch (e) {
      console.warn('Sim step error:', e);
      handleOrbitAchieved();
      return;
    }

    // Check for new events
    while (eventCursor < sim.events.length) {
      const ev = sim.events[eventCursor];
      eventCursor++;
      addLogEntry(ev.msg, true, state.simTime, state.eventLog);
      updateTimeline(ev.msg, state.simTime);

      // Stage separation
      if (ev.msg.includes('SEP')) {
        triggerStaging();
        showPanel('tracking-panel');
        const s = sim.state;
        const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
        const sepKick = 5;
        const vScale = (speed - sepKick) / speed;

        const obj = createOrbitalObject(scene, 'stage', {
          x: s.x, y: s.y, z: s.z,
          vx: s.vx * vScale, vy: s.vy * vScale, vz: s.vz * vScale
        }, 0xff6d00, ev.msg, state.globalTime);
        dispatch('ADD_ORBITAL_OBJECT', obj);

        // Temporary visual
        const sepPos = toVector3(eciToScene(s.x, s.y, s.z));
        const sepVel = new THREE.Vector3(s.vx, s.vz, -s.vy).normalize();
        showStageSep(sepPos, sepVel.multiplyScalar(-0.3 * rocketGroup.scale.x));
        setSpentStageFadeStart(state.simTime);
      }
    }

    // Phase changes
    if (sim.phase !== lastPhaseReported) {
      if (lastPhaseReported !== '') addLogEntry(`Phase: ${sim.phase.replace(/_/g, ' ')}`, false, state.simTime, state.eventLog);
      lastPhaseReported = sim.phase;
    }

    // Flight diagnostics (every 10 sim-seconds)
    if (Math.floor(sim.state.time) % 10 === 0 && Math.floor(sim.state.time) !== Math.floor(sim.state.time - SIM_DT)) {
      const _r = Math.sqrt(sim.state.x ** 2 + sim.state.y ** 2 + sim.state.z ** 2);
      const _v = Math.sqrt(sim.state.vx ** 2 + sim.state.vy ** 2 + sim.state.vz ** 2);
      console.log(`[T+${Math.floor(sim.state.time)}] alt=${((_r - 6371000) / 1000).toFixed(1)}km v=${_v.toFixed(0)}m/s phase=${sim.phase} stage=${sim.currentStage + 1} pitch=${(sim.pitchAngle * 180 / Math.PI).toFixed(1)}° throttle=${sim.throttle.toFixed(2)}`);
    }

    // Check terminal conditions
    if (sim.phase === 'ORBIT_ACHIEVED') {
      triggerOrbitAchieved();
      handleOrbitAchieved();
      return;
    }
    if (sim.phase === 'ABORT' || !sim.running) {
      const _r = Math.sqrt(sim.state.x ** 2 + sim.state.y ** 2 + sim.state.z ** 2);
      const _v = Math.sqrt(sim.state.vx ** 2 + sim.state.vy ** 2 + sim.state.vz ** 2);
      console.warn(`FLIGHT ENDED: phase=${sim.phase} alt=${((_r - 6371000) / 1000).toFixed(1)}km v=${_v.toFixed(0)}m/s stage=${sim.currentStage + 1} T+${sim.state.time.toFixed(1)}s`);
      handleMissionEnd(sim.phase === 'ABORT' ? 'MISSION FAILED — VEHICLE LOST' : 'SIMULATION ENDED');
      return;
    }
  }

  // Update visuals
  updateRocketVisual(sim.state, camera, state.simTime);

  // Telemetry
  const telem = sim.getTelemetry();
  updateTelemetryDisplay(telem, state.simTime, sim.state, state.showAdvanced, state.trajectoryPoints, state.launchLat, state.launchLon, state.earthRotation);
  updateGncDisplay(telem, state.engineCounts);
  // Build event markers for trajectory plot from sim events
  const plotEvents = sim.events
    .filter(ev => /MAX-Q|MECO|SEP|ORBIT/.test(ev.msg))
    .map(ev => ({ time: ev.t, label: ev.msg.replace(/STAGE \d+ /, '') }));
  updateTrajectoryPlot(state.trajectoryPoints, plotEvents);
  updateTimelineProgress(state.simTime);

  // Audio — drive procedural sound from telemetry
  const stageIdx = telem.currentStage || 0;
  updateAudio({
    throttle: telem.throttle || 0,
    altitude: telem.altitude || 0,
    speed: telem.speed || 0,
    machNumber: telem.mach || 0,
    dynamicPressure: telem.dynamicPressure || 0,
    phase: telem.phase || '',
    currentStage: stageIdx,
    engineCount: (state.engineCounts && state.engineCounts[stageIdx]) || 1,
  });

  // Camera follow
  if (state.cameraTracking) {
    const dist = camera.position.distanceTo(rocketGroup.position);
    const rocketScale = Math.min(2.0, Math.max(0.15, dist * 0.003));
    updateCameraFollow(camera, controls, sim.state, rocketScale);
  }
}

// =========================================================================
// ANIMATION LOOP
// =========================================================================
let prevTime = performance.now();

function animate(time) {
  requestAnimationFrame(animate);
  const state = getState();

  const dt = Math.min((time - prevTime) / 1000, 0.1);
  prevTime = time;
  dispatch('UPDATE_GLOBAL_TIME', dt);

  // Earth rotation
  if (state.phase === 'ASCENT' || state.phase === 'ORBIT_ACHIEVED') {
    dispatch('SET_EARTH_ROTATION', state.launchEarthRotation + OMEGA * state.simTime);
  } else {
    dispatch('SET_EARTH_ROTATION', state.earthRotation + dt * (Math.PI * 2 / 1800));
  }
  earthGroup.rotation.y = state.earthRotation;

  // Update Earth shader
  if (earthUniforms) {
    earthUniforms.sunDirection.value.copy(sunLight.position).normalize();
  }

  // Run simulation
  if (state.phase === 'ASCENT') {
    simulationStep(dt);
  }

  // Propagate orbital objects
  const propagateDt = dt * (state.phase === 'ASCENT' ? state.timeWarp : 1);
  if (state.orbitalObjects.length > 0) {
    for (const obj of state.orbitalObjects) {
      if (obj.impacted) continue;
      const impacted = propagateObject(obj.state, propagateDt);
      if (impacted) {
        handleImpact(obj, earthGroup, state.earthRotation);
      }
    }
    updateOrbitalVisuals(state.orbitalObjects, camera, propagateDt);

    // Update tracking display periodically
    if (Math.floor(state.globalTime * 2) !== Math.floor((state.globalTime - dt) * 2)) {
      updateTrackingPanel(state.orbitalObjects, state.simulator, state.phase);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

// =========================================================================
// LAUNCH
// =========================================================================
animate(performance.now());
