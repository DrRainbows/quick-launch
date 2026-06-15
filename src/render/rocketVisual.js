// ============================================================================
// ROCKET VISUAL — Rocket mesh, trail, spent stage animation
// ============================================================================
// Positions the rocket in ECI-to-scene space, draws trajectory trail,
// animates spent stage separation visual.

import { EARTH_RADIUS_SCENE, SCALE } from '../constants.js';
import { eciToScene } from '../coords/transforms.js';
import { buildVehicleModel, scaleModelToScene } from '../rocket/vehicleModel.js';

let rocketGroup, rocketModel;
let spentStageGroup, spentPyramid, spentStageVel, spentStageFadeStart;
let trailLine, trailGeo, trailPositions, trailColors, trailIndex;
let orbitRing;

const MAX_TRAIL_POINTS = 5000;

/** Create all rocket-related Three.js objects. Call once. */
export function createRocketVisual(scene) {
  // Active rocket
  rocketGroup = new THREE.Group();
  rocketGroup.visible = false;
  scene.add(rocketGroup);

  // Default placeholder — replaced by setRocketModel() before each launch
  const pyramidGeo = new THREE.ConeGeometry(0.5, 1.8, 4);
  rocketModel = new THREE.LineSegments(
    new THREE.EdgesGeometry(pyramidGeo),
    new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 })
  );
  rocketGroup.add(rocketModel);

  // Spent stage (temporary visual for stage sep)
  spentStageGroup = new THREE.Group();
  spentStageGroup.visible = false;
  scene.add(spentStageGroup);

  spentPyramid = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.ConeGeometry(0.5, 1.8, 4)),
    new THREE.LineBasicMaterial({ color: 0xff6d00, linewidth: 2 })
  );
  spentStageGroup.add(spentPyramid);
  spentStageVel = new THREE.Vector3();
  spentStageFadeStart = 0;

  // Trajectory trail
  trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3);
  trailColors = new Float32Array(MAX_TRAIL_POINTS * 3);
  trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 });
  trailLine = new THREE.Line(trailGeo, trailMat);
  trailLine.frustumCulled = false;
  scene.add(trailLine);
  trailIndex = 0;

  // Target orbit ring
  orbitRing = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0x00e5ff, dashSize: 2, gapSize: 1, transparent: true, opacity: 0.5 })
  );
  orbitRing.visible = false;
  scene.add(orbitRing);

  return { rocketGroup, orbitRing };
}

/**
 * Replace the rocket model with a proper wireframe built from generator specs.
 * Call before each launch with the full rocket object.
 * @param {Object} rocket - full rocket from generator
 */
export function setRocketModel(rocket) {
  if (!rocketGroup) return;
  // Remove old model
  if (rocketModel) {
    rocketGroup.remove(rocketModel);
    rocketModel.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  try {
    rocketModel = buildVehicleModel(rocket);
    scaleModelToScene(rocketModel, 1.8); // fit canonical display size
    rocketGroup.add(rocketModel);
  } catch (e) {
    console.warn('Vehicle model build failed, using fallback cone:', e);
    const geo = new THREE.ConeGeometry(0.5, 1.8, 4);
    rocketModel = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 })
    );
    rocketGroup.add(rocketModel);
  }
}

/** Reset trail for a new mission. */
export function resetTrail() {
  trailIndex = 0;
  trailGeo.setDrawRange(0, 0);
}

/** Update rocket position, orientation, trail, and spent stage. */
export function updateRocketVisual(simState, camera, simTime) {
  if (!simState) return;

  const pos = new THREE.Vector3(
    simState.x * SCALE,
    simState.z * SCALE,
    -simState.y * SCALE
  );
  rocketGroup.position.copy(pos);

  // Orient along velocity
  const vel = new THREE.Vector3(simState.vx, simState.vz, -simState.vy).normalize();
  if (vel.length() > 0.001) {
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, vel);
    rocketGroup.quaternion.copy(quat);
  }

  // Scale by camera distance
  const dist = camera.position.distanceTo(pos);
  const scale = Math.min(2.0, Math.max(0.15, dist * 0.003));
  rocketGroup.scale.setScalar(scale);

  // Update trail
  if (trailIndex < MAX_TRAIL_POINTS) {
    trailPositions[trailIndex * 3]     = pos.x;
    trailPositions[trailIndex * 3 + 1] = pos.y;
    trailPositions[trailIndex * 3 + 2] = pos.z;

    const alt = (pos.length() - EARTH_RADIUS_SCENE) / (EARTH_RADIUS_SCENE * 0.1);
    const t = Math.min(1, Math.max(0, alt));
    if (t < 0.5) {
      const tt = t * 2;
      trailColors[trailIndex * 3]     = tt;
      trailColors[trailIndex * 3 + 1] = tt;
      trailColors[trailIndex * 3 + 2] = 1;
    } else {
      const tt = (t - 0.5) * 2;
      trailColors[trailIndex * 3]     = 1;
      trailColors[trailIndex * 3 + 1] = 1 - tt * 0.6;
      trailColors[trailIndex * 3 + 2] = 1 - tt;
    }

    trailIndex++;
    trailGeo.setDrawRange(0, trailIndex);
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
  }

  // Spent stage animation
  if (spentStageGroup.visible) {
    const elapsed = simTime - spentStageFadeStart;
    spentStageGroup.position.add(spentStageVel.clone().multiplyScalar(0.016));
    spentStageGroup.rotation.x += 0.02;
    spentStageGroup.rotation.z += 0.015;
    const opacity = Math.max(0, 1 - elapsed / 8);
    spentPyramid.material.opacity = opacity;
    spentPyramid.material.transparent = true;
    if (opacity <= 0) spentStageGroup.visible = false;
  }
}

/** Trigger spent stage separation visual at current rocket position. */
export function showStageSep(sepPos, sepVel) {
  spentStageGroup.position.copy(sepPos);
  spentStageGroup.rotation.set(0, 0, 0);
  spentStageGroup.scale.copy(rocketGroup.scale);
  spentStageGroup.visible = true;
  spentStageFadeStart = 0; // Will be set by caller via setSpentStageFadeStart
  spentStageVel.copy(sepVel);
}

export function setSpentStageFadeStart(t) {
  spentStageFadeStart = t;
}

/** Update target orbit ring geometry. */
export function updateOrbitRing(points) {
  orbitRing.geometry.dispose();
  orbitRing.geometry = new THREE.BufferGeometry().setFromPoints(points);
  orbitRing.computeLineDistances();
  orbitRing.visible = true;
}

export function hideOrbitRing() { orbitRing.visible = false; }

export function getRocketGroup()    { return rocketGroup; }
export function getSpentStageGroup() { return spentStageGroup; }
export function getOrbitRing()      { return orbitRing; }
