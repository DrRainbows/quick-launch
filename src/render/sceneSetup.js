// ============================================================================
// SCENE SETUP — Three.js scene, renderer, lights, controls, resize
// ============================================================================
// Exports the core rendering objects that all other render modules use.

import { EARTH_RADIUS_SCENE } from '../constants.js';

let scene, camera, renderer, controls, sunLight;

/** Initialize Three.js scene. Call once on startup. */
export function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 10000);
  camera.position.set(0, 30, 120);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  document.body.insertBefore(renderer.domElement, document.getElementById('ui-overlay'));

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = true;
  controls.minDistance = 0.5;
  controls.maxDistance = EARTH_RADIUS_SCENE * 30;

  // Sun light
  sunLight = new THREE.DirectionalLight(0xfff8f0, 1.6);
  sunLight.position.set(250, 80, 120);
  scene.add(sunLight);

  // Fill light from opposite side
  const fillLight = new THREE.DirectionalLight(0x4466aa, 0.15);
  fillLight.position.set(-200, -30, -80);
  scene.add(fillLight);

  // Dim ambient
  scene.add(new THREE.AmbientLight(0x101830, 0.2));

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, controls, sunLight };
}

export function getScene()    { return scene; }
export function getCamera()   { return camera; }
export function getRenderer() { return renderer; }
export function getControls() { return controls; }
export function getSunLight() { return sunLight; }
