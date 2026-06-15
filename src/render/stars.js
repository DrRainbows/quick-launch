// ============================================================================
// STARS — Multi-layer star field
// ============================================================================

/** Create a star layer with randomized positions and colors. */
function makeStarLayer(count, rMin, rMax, sizeMin, sizeMax, color, opacity) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = rMin + Math.random() * (rMax - rMin);
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);

    const temp = Math.random();
    if (temp < 0.6) {
      colors[i * 3] = 0.9; colors[i * 3 + 1] = 0.92; colors[i * 3 + 2] = 1.0;
    } else if (temp < 0.8) {
      colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.95; colors[i * 3 + 2] = 0.85;
    } else if (temp < 0.92) {
      colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 0.6;
    } else {
      colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.7; colors[i * 3 + 2] = 0.5;
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: (sizeMin + sizeMax) / 2,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    vertexColors: true,
  });

  return new THREE.Points(geo, mat);
}

/** Add all star layers to the scene. */
export function createStars(scene) {
  scene.add(makeStarLayer(6000, 1800, 2500, 0.3, 1.0, 0xffffff, 0.7));
  scene.add(makeStarLayer(2000, 1500, 2200, 0.8, 2.0, 0xffffff, 0.9));
  scene.add(makeStarLayer(200, 1400, 2000, 2.0, 3.5, 0xffffff, 1.0));
}
