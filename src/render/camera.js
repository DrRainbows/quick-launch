// ============================================================================
// CAMERA — Tracking and free camera modes
// ============================================================================
// Smooth lerp follow when tracking is on. Subscribes to camera:mode events.

import { SCALE } from '../constants.js';

/**
 * Update camera to follow rocket position (smooth lerp).
 * Call each frame during ASCENT/ORBIT_ACHIEVED when tracking is on.
 */
export function updateCameraFollow(camera, controls, simState, rocketScale) {
  if (!simState) return;

  const pos = new THREE.Vector3(
    simState.x * SCALE,
    simState.z * SCALE,
    -simState.y * SCALE
  );

  const vel = new THREE.Vector3(simState.vx, simState.vz, -simState.vy).normalize();
  const radialUp = pos.clone().normalize();
  const velDir = vel.clone();
  if (velDir.length() < 0.001) velDir.set(0, 1, 0);
  velDir.normalize();

  const right = new THREE.Vector3().crossVectors(velDir, radialUp).normalize();
  const behind = new THREE.Vector3().crossVectors(radialUp, right).normalize();

  const targetPos = pos.clone()
    .add(behind.multiplyScalar(-rocketScale * 4))
    .add(radialUp.multiplyScalar(rocketScale * 2));

  camera.position.lerp(targetPos, 0.06);
  controls.target.lerp(pos, 0.1);
}

/**
 * Snap camera to launch site for dramatic liftoff view.
 */
export function snapToLaunchSite(camera, controls, simState) {
  if (!simState) return;

  const pos = new THREE.Vector3(
    simState.x * SCALE,
    simState.z * SCALE,
    -simState.y * SCALE
  );

  const up = pos.clone().normalize();
  const camDist = 3;
  camera.position.copy(pos.clone().add(up.multiplyScalar(camDist)));
  controls.target.copy(pos);
}
