// ============================================================================
// EARTH — Mesh, equirectangular shader, atmosphere, launch marker
// ============================================================================
// Texture UVs are derived from object-space position (lat/lon), not from
// SphereGeometry's built-in UVs. This keeps click-to-launch coordinates aligned
// with the map regardless of mesh parameterization — same approach as
// Deep-Time-Earth's ECEF→equirectangular mapping, adapted to our scene frame:
//   scene x = ECEF x, scene y = ECEF z (north), scene z = -ECEF y (east)

import { EARTH_RADIUS_SCENE } from '../constants.js';

let earthGroup, earthMesh, earthUniforms, launchMarker;

/** Create Earth and all associated objects. */
export function createEarth(scene, sunLight) {
  earthGroup = new THREE.Group();
  scene.add(earthGroup);

  earthUniforms = {
    dayMap: { value: null },
    nightMap: { value: null },
    sunDirection: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
  };

  const earthMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    vertexShader: `
      varying vec3 vObjPos;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vObjPos = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D dayMap;
      uniform sampler2D nightMap;
      uniform vec3 sunDirection;
      varying vec3 vObjPos;
      varying vec3 vNormal;
      varying vec3 vViewPos;

      const float PI = 3.141592653589793;

      // Object-space direction → equirectangular UV (matches sceneToLatLon in transforms.js)
      vec2 dirToUv(vec3 dir) {
        float lat = asin(clamp(dir.y, -1.0, 1.0));
        float lon = atan(-dir.z, dir.x);
        return vec2(0.5 + lon / (2.0 * PI), 0.5 - lat / PI);
      }

      void main() {
        vec3 dir = normalize(vObjPos);
        vec2 uv = dirToUv(dir);

        vec3 norm = normalize(vNormal);
        float NdotL = dot(norm, sunDirection);
        vec4 dayColor = texture2D(dayMap, uv);
        vec4 nightColor = texture2D(nightMap, uv);
        float dayFactor = smoothstep(-0.1, 0.2, NdotL);

        vec3 ambient = dayColor.rgb * 0.08;
        vec3 lit = dayColor.rgb * (0.2 + 0.8 * max(0.0, NdotL));
        vec3 night = nightColor.rgb * 1.5;
        vec3 color = mix(ambient + night, lit, dayFactor);

        float waterMask = 1.0 - smoothstep(0.05, 0.15, dot(dayColor.rgb, vec3(0.2, 0.5, 0.3)));
        vec3 viewDir = normalize(-vViewPos);
        vec3 halfDir = normalize(sunDirection + viewDir);
        float spec = pow(max(0.0, dot(norm, halfDir)), 80.0) * waterMask * dayFactor * 0.4;
        color += vec3(spec);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS_SCENE, 96, 48),
    earthMat
  );

  const texLoader = new THREE.TextureLoader();
  texLoader.load('earth_texture.jpg', (tex) => {
    tex.anisotropy = 8;
    earthUniforms.dayMap.value = tex;
  }, undefined, () => {
    console.warn('[earth] earth_texture.jpg missing — using flat ocean fallback');
    const c = document.createElement('canvas');
    c.width = 4; c.height = 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0a2a4a';
    ctx.fillRect(0, 0, 4, 2);
    ctx.fillStyle = '#1a4a2a';
    ctx.fillRect(1, 0, 2, 1);
    const fallback = new THREE.CanvasTexture(c);
    fallback.anisotropy = 4;
    earthUniforms.dayMap.value = fallback;
  });

  texLoader.load('earth_night.jpg', (tex) => {
    tex.anisotropy = 8;
    earthUniforms.nightMap.value = tex;
  }, undefined, () => {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    earthUniforms.nightMap.value = new THREE.CanvasTexture(c);
  });

  earthGroup.add(earthMesh);

  // Atmosphere inner glow
  const atmosGeo = new THREE.SphereGeometry(EARTH_RADIUS_SCENE * 1.015, 64, 32);
  const atmosMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal; varying vec3 vPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * vec4(vPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal; varying vec3 vPosition;
      void main() {
        vec3 viewDir = normalize(-vPosition);
        float rim = 1.0 - dot(viewDir, vNormal);
        float inner = pow(rim, 4.0) * 0.9;
        float outer = pow(rim, 2.0) * 0.25;
        float alpha = inner + outer;
        vec3 col = mix(vec3(0.4, 0.7, 1.0), vec3(0.2, 0.5, 1.0), rim);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true, side: THREE.FrontSide, depthWrite: false,
  });
  earthGroup.add(new THREE.Mesh(atmosGeo, atmosMat));

  // Outer atmosphere haze
  const outerAtmosGeo = new THREE.SphereGeometry(EARTH_RADIUS_SCENE * 1.06, 48, 24);
  const outerAtmosMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal; varying vec3 vPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * vec4(vPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal; varying vec3 vPosition;
      void main() {
        vec3 viewDir = normalize(-vPosition);
        float rim = 1.0 - dot(viewDir, vNormal);
        float alpha = pow(rim, 5.0) * 0.35;
        gl_FragColor = vec4(0.3, 0.55, 1.0, alpha);
      }
    `,
    transparent: true, side: THREE.BackSide, depthWrite: false,
  });
  earthGroup.add(new THREE.Mesh(outerAtmosGeo, outerAtmosMat));

  // Launch marker
  launchMarker = new THREE.Group();
  const markerOuter = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.65, 32),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
  );
  const markerInner = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.25, 4),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
  );
  const markerDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 16),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide })
  );
  launchMarker.add(markerOuter, markerInner, markerDot);
  launchMarker.visible = false;
  earthGroup.add(launchMarker);

  return { earthGroup, earthMesh, earthUniforms, launchMarker };
}

export function getEarthGroup()    { return earthGroup; }
export function getEarthMesh()     { return earthMesh; }
export function getEarthUniforms() { return earthUniforms; }
export function getLaunchMarker()  { return launchMarker; }
