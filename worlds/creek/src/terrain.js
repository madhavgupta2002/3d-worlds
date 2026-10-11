// World maths shared with blender/make_creek.py — keep both in sync.
// River flows from the mountain head (z = -320) through a canyon and valley into a lake (z ≈ +250).
import * as THREE from 'three';

export const HALF_X = 240;
export const HALF_Z = 320;
export const STEP = 1;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const centerX = (z) => 40 * Math.sin(z * 0.012) + 15 * Math.sin(z * 0.031 + 1);
export const riverHalfWidth = (z) => 5 + 1.5 * Math.sin(z * 0.045 + 0.5) + 38 * lakeT(z);
export const lakeT = (z) => smoothstep(215, 275, z);
export const riverLevel = (z) => 6 + 34 * (1 - clamp01((z + 320) / 540));
export const canyon = (z) => smoothstep(-170, -130, z) * (1 - smoothstep(10, 50, z));

export function fbm(x, z, oct = 5, f0 = 0.05) {
  let s = 0, a = 1, f = f0;
  for (let i = 0; i < oct; i++) {
    s += a * Math.sin(x * f + i * 1.7 + Math.sin(z * f * 0.8 + i)) *
              Math.cos(z * f * 1.1 + i * 2.3 + Math.cos(x * f * 0.7));
    a *= 0.5;
    f *= 2.03;
  }
  return s;
}

export const forestField = (x, z) => smoothstep(-0.7, 0.25, fbm(x * 1.3 + 100, z * 1.3 - 50, 3));

export function height(x, z) {
  const W = riverLevel(z), d = Math.abs(x - centerX(z)), hw = riverHalfWidth(z);
  const depth = 1.6 + 6 * lakeT(z);
  const bed = W - depth + (depth - 0.4) * smoothstep(0, hw, d) + 0.08 * Math.sin(x * 1.3) * Math.sin(z * 1.1);
  const f1 = fbm(x, z);
  const ridge = smoothstep(0.15, 0.95, 1 - Math.min(1, Math.abs(fbm(x * 0.5 + 31, z * 0.5 + 17, 3)) / 1.2));
  const mask = Math.max(smoothstep(70, 190, d), smoothstep(-120, -300, z));
  const mountain = (0.6 * ridge + 0.4 * (f1 * 0.5 + 0.5)) * 130 * mask;
  const hills = f1 * 3.5 * smoothstep(hw + 4, hw + 40, d) * (1 - mask);
  const edge = Math.max(smoothstep(185, 235, Math.abs(x)), smoothstep(270, 315, z), smoothstep(-270, -315, z)) * 70;
  const land = W + 1.5 + 0.12 * Math.sin(x * 0.9 + z * 0.4) + hills + mountain + edge
             + canyon(z) * 30 * smoothstep(hw + 1, hw + 8, d);
  return bed + (land - bed) * smoothstep(hw * 0.8, hw + 2.5, d);
}

export function slope(x, z, e = 0.5) {
  const y = height(x, z);
  return Math.hypot(height(x + e, z) - y, height(x, z + e) - y) / e;
}

export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTerrainGeometry() {
  const nx = Math.round((2 * HALF_X) / STEP) + 1, nz = Math.round((2 * HALF_Z) / STEP) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = -HALF_X + i * STEP, z = -HALF_Z + j * STEP, k = (j * nx + i) * 3;
    pos[k] = x; pos[k + 1] = height(x, z); pos[k + 2] = z;
  }
  let t = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.set([a, c, b, b, c, d], t); t += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}
