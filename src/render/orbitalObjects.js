// ============================================================================
// ORBITAL OBJECTS — Visual management for satellites, stages, debris
// ============================================================================
// Creates meshes, orbit rings, impact markers. Updates positions each frame.
// Physics propagation is in physics/orbitalPropagator.js — this is rendering only.

import { SCALE, RE } from '../constants.js';
import { eciToScene, eciToEcef, ecefToScene } from '../coords/transforms.js';
import { computeOrbitRing } from '../physics/orbitalPropagator.js';

/**
 * Create a new orbital object with mesh and orbit ring.
 * @param {THREE.Scene} scene - The scene to add meshes to
 * @param {string} type - 'payload' or 'stage'
 * @param {Object} eciState - { x, y, z, vx, vy, vz }
 * @param {number} color - hex color
 * @param {string} name - display name
 * @param {number} globalTime - current global time
 * @returns {Object} orbital object descriptor
 */
export function createOrbitalObject(scene, type, eciState, color, name, globalTime) {
  const geo = new THREE.ConeGeometry(0.3, 1.0, 4);
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true });
  const mesh = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat);
  scene.add(mesh);

  // Orbit ring
  const orbitGeo = new THREE.BufferGeometry();
  const orbitMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 });
  const orbitLine = new THREE.Line(orbitGeo, orbitMat);
  orbitLine.frustumCulled = false;
  scene.add(orbitLine);

  const obj = {
    type, name,
    state: { ...eciState },
    color, mesh, orbitLine,
    birthTime: globalTime,
    impacted: false,
  };

  // Pre-compute orbit ring for payloads
  if (type === 'payload') {
    updateOrbitRing(obj);
  }

  return obj;
}

/** Recompute orbit ring for an object from its current state. */
export function updateOrbitRing(obj) {
  const ringData = computeOrbitRing(obj.state);
  if (ringData) {
    obj.orbitLine.geometry.dispose();
    obj.orbitLine.geometry = new THREE.BufferGeometry();
    obj.orbitLine.geometry.setAttribute('position', new THREE.BufferAttribute(ringData, 3));
  }
}

/**
 * Update visual positions for all orbital objects.
 * Call each frame after physics propagation.
 */
export function updateOrbitalVisuals(objects, camera, dtTotal) {
  for (const obj of objects) {
    if (obj.impacted) continue;

    const s = obj.state;
    const pos = new THREE.Vector3(s.x * SCALE, s.z * SCALE, -s.y * SCALE);
    obj.mesh.position.copy(pos);

    const dist = camera.position.distanceTo(pos);
    const scale = Math.min(1.5, Math.max(0.1, dist * 0.002));
    obj.mesh.scale.setScalar(scale);

    const vel = new THREE.Vector3(s.vx, s.vz, -s.vy).normalize();
    if (vel.length() > 0.001) {
      const up = new THREE.Vector3(0, 1, 0);
      obj.mesh.quaternion.setFromUnitVectors(up, vel);
    }

    // Spent stages tumble
    if (obj.type === 'stage') {
      obj.mesh.rotation.x += dtTotal * 1.5;
      obj.mesh.rotation.z += dtTotal * 0.8;
    }
  }
}

/**
 * Handle impact: hide mesh, create impact marker on Earth surface.
 */
export function handleImpact(obj, earthGroup, earthRotation) {
  obj.impacted = true;
  obj.mesh.visible = false;
  obj.orbitLine.visible = false;
  createImpactMarker(obj.state.x, obj.state.y, obj.state.z, earthGroup, earthRotation);
}

/**
 * Create a red ring marker on Earth's surface at ECI position.
 * Converts ECI→ECEF and parents to earthGroup so it rotates with Earth.
 */
export function createImpactMarker(x, y, z, earthGroup, earthRotation) {
  const theta = -earthRotation;
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const xEcef = x * cosT + y * sinT;
  const yEcef = -x * sinT + y * cosT;
  const zEcef = z;

  const r = Math.sqrt(xEcef * xEcef + yEcef * yEcef + zEcef * zEcef);
  const norm = RE / r;
  const surfPos = new THREE.Vector3(xEcef * norm * SCALE, zEcef * norm * SCALE, -yEcef * norm * SCALE);

  const geo = new THREE.RingGeometry(0.2, 0.4, 4);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3d00, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
  const marker = new THREE.Mesh(geo, mat);
  marker.position.copy(surfPos);
  marker.lookAt(new THREE.Vector3(0, 0, 0));
  earthGroup.add(marker);
}

/**
 * Clean up an orbital object's Three.js resources.
 */
export function cleanupOrbitalObject(scene, obj) {
  scene.remove(obj.mesh);
  obj.mesh.geometry.dispose();
  obj.mesh.material.dispose();
  scene.remove(obj.orbitLine);
  obj.orbitLine.geometry.dispose();
  obj.orbitLine.material.dispose();
}
