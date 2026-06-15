// ============================================================================
// VEHICLE MODEL — Generator specs → low-poly Three.js wireframe geometry
// ============================================================================
// The rocket generator outputs physical dimensions for each stage:
//   - stage.diameter, stage.stageLength
//   - stage.engineCount, engine.exitDiameter
//   - fairing.diameter, fairing.noseLength, fairing.cylinderLength
//
// This module builds a proportionally accurate wireframe from those specs.
// Each stage is a cylinder, engines are small cones at the bottom,
// fairing is a nose cone on top. Fibonacci spiral layout for multi-engine stages.
//
// The wireframe aesthetic is intentional — clean engineering visualization.

import { SCALE } from '../constants.js';

const STAGE_COLORS = [
  0x00e5ff,   // Stage 1: cyan
  0x2196f3,   // Stage 2: blue
  0x00e676,   // Stage 3: green
  0xff6d00,   // Stage 4: orange
];

const FAIRING_COLOR = 0xffffff;

/**
 * Build a Three.js Group representing the rocket from generator specs.
 * The model is built at real-world scale in meters, then scaled to scene units.
 *
 * @param {Object} rocket - full rocket object from generator
 * @returns {THREE.Group} wireframe rocket model
 */
export function buildVehicleModel(rocket) {
  const group = new THREE.Group();

  const stages = rocket.stages || [];
  const fairing = rocket.fairing || {};

  // Extract dimensions (with sensible defaults)
  const stageSpecs = stages.map((s, i) => ({
    diameter: s.diameter || s.maxDiameter || 3.7,
    length: s.stageLength || s.length || estimateStageLength(s),
    engineCount: s.engineCount || s.engines?.count || 1,
    engineExitDiam: s.engine?.exitDiameter || s.engines?.exitDiameter || 0.8,
    color: STAGE_COLORS[i % STAGE_COLORS.length],
  }));

  const fairDiam = fairing.diameter || rocket.fairingDiameter || rocket.maxDiameter ||
    (stageSpecs.length > 0 ? stageSpecs[stageSpecs.length - 1].diameter : 3.7);
  const fairNoseLen = fairing.noseLength || fairDiam * 1.5;
  const fairCylLen = fairing.cylinderLength || fairDiam * 0.8;

  // Build bottom-up: stage 1 at the bottom
  let yOffset = 0;

  for (let i = 0; i < stageSpecs.length; i++) {
    const spec = stageSpecs[i];
    const stageGroup = buildStageGeometry(spec, yOffset);
    stageGroup.userData = { stageIndex: i };
    group.add(stageGroup);
    yOffset += spec.length;
  }

  // Fairing on top
  const fairingGroup = buildFairingGeometry(fairDiam, fairNoseLen, fairCylLen, yOffset);
  group.add(fairingGroup);

  // Total height for centering
  const totalHeight = yOffset + fairCylLen + fairNoseLen;
  group.userData.totalHeight = totalHeight;
  group.userData.maxDiameter = Math.max(...stageSpecs.map(s => s.diameter), fairDiam);

  return group;
}

function estimateStageLength(stage) {
  // Rough estimate from propellant mass and diameter
  const propMass = stage.propellantMass || stage.propMass || 50000;
  const diam = stage.diameter || 3.7;
  // Assume LOX/RP-1 density ~900 kg/m³, tanks fill ~70% of stage volume
  const volume = propMass / 900;
  const tankLength = volume / (Math.PI * (diam / 2) ** 2 * 0.7);
  return Math.max(3, tankLength + 2); // min 3m, add 2m for interstage
}

function buildStageGeometry(spec, yOffset) {
  const stageGroup = new THREE.Group();
  const r = spec.diameter / 2;
  const h = spec.length;
  const segments = 8; // low-poly octagonal

  // Stage cylinder (wireframe)
  const cylGeo = new THREE.CylinderGeometry(r, r, h, segments, 1, true);
  const edges = new THREE.EdgesGeometry(cylGeo);
  const mat = new THREE.LineBasicMaterial({ color: spec.color, linewidth: 1 });
  const wireframe = new THREE.LineSegments(edges, mat);
  wireframe.position.y = yOffset + h / 2;
  stageGroup.add(wireframe);

  // Top and bottom cap rings
  const topRing = createRing(r, segments, spec.color);
  topRing.position.y = yOffset + h;
  stageGroup.add(topRing);

  const botRing = createRing(r, segments, spec.color);
  botRing.position.y = yOffset;
  stageGroup.add(botRing);

  // Engines at the bottom
  if (spec.engineCount > 0) {
    const engineGroup = buildEngines(
      spec.engineCount,
      spec.engineExitDiam,
      r * 0.8, // engine layout radius (80% of stage radius)
      spec.color
    );
    engineGroup.position.y = yOffset;
    stageGroup.add(engineGroup);
  }

  return stageGroup;
}

function createRing(radius, segments, color) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(
      radius * Math.cos(angle),
      0,
      radius * Math.sin(angle)
    ));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
}

function buildEngines(count, exitDiam, layoutRadius, color) {
  const group = new THREE.Group();
  const bellHeight = exitDiam * 1.5;
  const bellRadius = exitDiam / 2;

  if (count === 1) {
    // Single center engine
    const bell = createEngineBell(bellRadius, bellHeight, color);
    bell.position.y = -bellHeight;
    group.add(bell);
  } else {
    // Fibonacci spiral layout for multi-engine
    const positions = fibonacciLayout(count, layoutRadius);
    for (const pos of positions) {
      const bell = createEngineBell(bellRadius, bellHeight, color);
      bell.position.set(pos.x, -bellHeight, pos.z);
      group.add(bell);
    }
  }

  return group;
}

function createEngineBell(radius, height, color) {
  // Truncated cone (bell nozzle)
  const geo = new THREE.ConeGeometry(radius, height, 6, 1, true);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 1 });
  const bell = new THREE.LineSegments(edges, mat);
  bell.position.y = height / 2; // cone tip at origin, bell opens downward
  bell.rotation.x = Math.PI; // flip so open end faces down
  return bell;
}

function buildFairingGeometry(diameter, noseLength, cylinderLength, yOffset) {
  const group = new THREE.Group();
  const r = diameter / 2;
  const segments = 8;

  // Cylinder portion
  if (cylinderLength > 0) {
    const cylGeo = new THREE.CylinderGeometry(r, r, cylinderLength, segments, 1, true);
    const edges = new THREE.EdgesGeometry(cylGeo);
    const mat = new THREE.LineBasicMaterial({ color: FAIRING_COLOR, linewidth: 1, transparent: true, opacity: 0.6 });
    const wireframe = new THREE.LineSegments(edges, mat);
    wireframe.position.y = yOffset + cylinderLength / 2;
    group.add(wireframe);
  }

  // Nose cone
  const coneGeo = new THREE.ConeGeometry(r, noseLength, segments, 1, true);
  const coneEdges = new THREE.EdgesGeometry(coneGeo);
  const coneMat = new THREE.LineBasicMaterial({ color: FAIRING_COLOR, linewidth: 1, transparent: true, opacity: 0.6 });
  const cone = new THREE.LineSegments(coneEdges, coneMat);
  cone.position.y = yOffset + cylinderLength + noseLength / 2;
  group.add(cone);

  return group;
}

/**
 * Fibonacci spiral layout for engine positions.
 * Distributes N points evenly within a circle of given radius.
 */
function fibonacciLayout(n, radius) {
  const points = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt(i / n);
    const theta = goldenAngle * i;
    points.push({
      x: r * Math.cos(theta),
      z: r * Math.sin(theta),
    });
  }
  return points;
}

/**
 * Scale a vehicle model group to fit within the scene's rocket display size.
 * @param {THREE.Group} model - from buildVehicleModel
 * @param {number} targetHeight - desired height in scene units
 */
export function scaleModelToScene(model, targetHeight) {
  const totalHeight = model.userData.totalHeight || 50;
  const scaleFactor = targetHeight / totalHeight;
  model.scale.setScalar(scaleFactor);
}
