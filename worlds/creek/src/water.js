import * as THREE from 'three';
import { HALF_Z, centerX, riverHalfWidth, riverLevel } from './terrain.js';
import { skyGLSL, SUN_DIR, HORIZON } from './sky.js';

export const FOG_DENSITY = 0.0022;

export function createWater(renderTarget, camera) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR },
      tColor: { value: renderTarget.texture },
      tDepth: { value: renderTarget.depthTexture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uFogColor: { value: HORIZON },
      uFogDensity: { value: FOG_DENSITY },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${skyGLSL}
      uniform float uNear, uFar, uFogDensity;
      uniform sampler2D tColor, tDepth;
      uniform vec2 uRes;
      uniform vec3 uFogColor;
      varying vec3 vWorld;

      // d(centerX)/dz — matches terrain.js (river flows toward +z)
      float centerSlope(float z) { return 0.48 * cos(z * 0.012) + 0.465 * cos(z * 0.031 + 1.0); }

      // ripple height in flow-aligned coords: a = along flow, c = across
      float ripples(float a, float c, float t) {
        return vnoise(vec2(a * 0.9 - t * 1.4, c * 2.2)) * 0.5
             + vnoise(vec2(a * 2.1 - t * 2.1, c * 4.7 + 3.1)) * 0.3
             + vnoise(vec2(a * 4.8 - t * 3.0, c * 9.0 + 8.0)) * 0.2;
      }
      float linearDepth(float d) {
        float z = d * 2.0 - 1.0;
        return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        float depth = linearDepth(texture2D(tDepth, uv).x) - linearDepth(gl_FragCoord.z);
        if (depth < 0.0) discard;

        vec2 f = normalize(vec2(centerSlope(vWorld.z), 1.0));
        vec2 p = vec2(dot(vWorld.xz, f), dot(vWorld.xz, vec2(-f.y, f.x)));
        float e = 0.04, h0 = ripples(p.x, p.y, uTime);
        vec2 grad = vec2(ripples(p.x + e, p.y, uTime) - h0, ripples(p.x, p.y + e, uTime) - h0) / e;
        grad *= 0.12 * (0.4 + clamp(depth * 2.0, 0.0, 0.6)) / (1.0 + 0.012 * length(cameraPosition - vWorld));
        vec3 N = normalize(vec3(-(f * grad.x + vec2(-f.y, f.x) * grad.y).x, 1.0, -(f * grad.x + vec2(-f.y, f.x) * grad.y).y));

        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 refl = skyColor(R);

        vec3 bed = texture2D(tColor, uv + N.xz * 0.05 * clamp(depth * 2.0, 0.0, 1.0)).rgb;
        vec3 absorb = exp(-vec3(1.1, 0.45, 0.3) * depth * 1.6);
        vec3 col = bed * absorb + vec3(0.03, 0.12, 0.10) * (1.0 - absorb);
        col = mix(col, refl, fres * 0.9);
        col += vec3(1.0, 0.9, 0.7) * pow(max(dot(R, uSunDir), 0.0), 600.0) * 4.0;

        float foamN = vnoise(p * vec2(3.0, 6.0) + vec2(-uTime * 0.8, 0.0));
        float foam = (1.0 - smoothstep(0.0, 0.16, depth)) * smoothstep(0.3, 0.7, foamN + 0.25);
        col = mix(col, vec3(0.9, 0.93, 0.95), foam * 0.75);

        float dist = length(cameraPosition - vWorld);
        col = mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * dist * dist));

        gl_FragColor = vec4(col, smoothstep(0.0, 0.05, depth));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // ribbon that follows the river centre line and its descending water level
  const rows = Math.round((2 * HALF_Z) / 2) + 1, pos = new Float32Array(rows * 6), idx = [];
  for (let j = 0; j < rows; j++) {
    const z = -HALF_Z + j * 2, c = centerX(z), r = riverHalfWidth(z) + 8, y = riverLevel(z);
    pos.set([c - r, y, z, c + r, y, z], j * 6);
    if (j < rows - 1) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, material);
}
