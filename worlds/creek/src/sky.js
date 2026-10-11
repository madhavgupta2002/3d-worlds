import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.75, 0.42, -0.3).normalize();
export const HORIZON = new THREE.Color().setRGB(0.62, 0.74, 0.86);

// Shared by the sky dome and the water reflection.
export const skyGLSL = /* glsl */`
uniform vec3 uSunDir;
uniform float uTime;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float cloudNoise(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}
vec3 skyColor(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(vec3(0.62, 0.74, 0.86), vec3(0.10, 0.30, 0.62), pow(h, 0.45));
  float s = max(dot(d, uSunDir), 0.0);
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.12) * 0.9 + vec2(uTime * 0.012, uTime * 0.005);
    float cl = smoothstep(0.52, 0.78, cloudNoise(cp)) * smoothstep(0.0, 0.18, d.y);
    c = mix(c, vec3(0.93, 0.94, 0.96) + vec3(1.0, 0.8, 0.5) * pow(s, 6.0) * 0.4, cl * 0.85);
  }
  c += vec3(1.0, 0.85, 0.6) * (pow(s, 8.0) * 0.25 + pow(s, 400.0) * 3.0);
  return c;
}`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSunDir: { value: SUN_DIR }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      ${skyGLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), mat);
  mesh.renderOrder = -1;
  return mesh;
}
