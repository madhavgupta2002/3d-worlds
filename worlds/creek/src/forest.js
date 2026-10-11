import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  HALF_X, HALF_Z, centerX, riverHalfWidth, riverLevel, canyon, forestField,
  height, slope, smoothstep, mulberry32,
} from './terrain.js';

export const swayUniform = { value: 0 };

function withSway(mat, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = swayUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = position;
      float ph = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.8;
      transformed.x += sin(uTime * 1.6 + ph) * ${amp} * position.y * position.y;
      transformed.z += cos(uTime * 1.2 + ph * 1.3) * ${amp * 0.6} * position.y * position.y;`);
  };
  return mat;
}

// ---------- terrain colours ----------
export function paintTerrain(geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3), uv = new Float32Array(pos.count * 2);
  const rnd = mulberry32(11);
  const c = new THREE.Color(), t = new THREE.Color();
  const lerpHSL = (h, s, l, k) => c.lerp(t.setHSL(h, s, l), k);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), up = nrm.getY(i), n = rnd();
    const rel = y - riverLevel(z), d = Math.abs(x - centerX(z)) - riverHalfWidth(z), cn = canyon(z);
    c.setHSL(0.25 + 0.04 * n, 0.42, 0.22 + 0.07 * n);                                   // meadow
    lerpHSL(0.2, 0.3, 0.1 + 0.05 * n, forestField(x, z) * 0.7);                          // forest floor
    lerpHSL(0.17, 0.18, 0.3 + 0.08 * n, smoothstep(75, 105, y));                         // alpine tundra
    lerpHSL(0.08, 0.06, 0.3 + 0.1 * n, smoothstep(0.72, 0.5, up));                       // bare rock
    if (cn > 0 && rel > 1.5) {                                                           // canyon strata
      const band = 0.5 + 0.5 * Math.sin(y * 1.1 + n * 0.4);
      lerpHSL(0.04 + 0.03 * band, 0.55, 0.28 + 0.16 * band, cn * smoothstep(0.95, 0.78, up));
    }
    lerpHSL(0, 0, 0.95, smoothstep(105, 120, y + n * 6) * smoothstep(0.5, 0.78, up));    // snow caps
    if (rel < 3) lerpHSL(0.11, 0.3, 0.45 + 0.08 * n, 1 - smoothstep(0.1, 2.0, d + n * 0.4)); // shore sand
    lerpHSL(0.09, 0.12, 0.2 + 0.1 * n, 1 - smoothstep(-0.4, 0.15, rel));                 // wet gravel bed
    col.set([c.r, c.g, c.b], i * 3);
    uv.set([x / 3, z / 3], i * 2);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function paintRock(geo, seed) {
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const rnd = mulberry32(seed), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.setHSL(0.09, 0.07, 0.3 + 0.12 * Math.sin(pos.getX(i) * 5 + pos.getY(i) * 7) + rnd() * 0.06);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// ---------- rocks (fallback when no Blender GLB) ----------
export function proceduralRocks(rockMat) {
  const group = new THREE.Group();
  const rnd = mulberry32(5), bases = [];
  for (let k = 0; k < 5; k++) {
    let g = new THREE.IcosahedronGeometry(1, 3);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position, ph = rnd() * 10;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
      const r = 1 + 0.22 * Math.sin(v.x * 3 + ph) * Math.cos(v.z * 3.3 + ph) + 0.1 * Math.sin(v.y * 7 + v.x * 5 + ph) + 0.04 * Math.sin(v.x * 17 + v.z * 13);
      p.setXYZ(i, v.x * r, v.y * r * 0.62, v.z * r);
    }
    g.computeVertexNormals();
    paintRock(g, 20 + k);
    bases.push(g);
  }
  const per = 140;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
  bases.forEach((g) => {
    const mesh = new THREE.InstancedMesh(g, rockMat, per);
    for (let i = 0; i < per; i++) {
      const z = (rnd() * 2 - 1) * (HALF_Z - 30);
      const nearRiver = rnd() < 0.6;
      const x = nearRiver ? centerX(z) + (rnd() - 0.5) * 2 * (riverHalfWidth(z) + 4 + rnd() * 3) : centerX(z) + (rnd() - 0.5) * 300;
      const sc = nearRiver ? (rnd() < 0.1 ? 1 + rnd() * 1.5 : 0.15 + rnd() * rnd() * 0.8) : 0.6 + rnd() * rnd() * 3;
      e.set((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4);
      q.setFromEuler(e);
      s.set(sc * (0.8 + rnd() * 0.5), sc, sc * (0.8 + rnd() * 0.5));
      m.compose(new THREE.Vector3(x, height(x, z) - sc * 0.15, z), q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

// ---------- trees ----------
function tint(g, fn) {
  g.deleteAttribute('uv');
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(c, p.getX(i), p.getY(i), p.getZ(i));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const brown = (c) => c.setRGB(0.11, 0.065, 0.035);

function coniferGeometry() {
  const parts = [tint(new THREE.CylinderGeometry(0.02, 0.035, 0.3, 5).translate(0, 0.15, 0), brown)];
  [[0.34, 0.5, 0.14], [0.27, 0.44, 0.36], [0.19, 0.4, 0.58]].forEach(([r, h, y]) => {
    const cone = new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y + h / 2, 0);
    parts.push(tint(cone, (c, px, py) => {
      const k = (py - y) / h;
      c.setRGB(0.025 + 0.06 * k, 0.09 + 0.12 * k, 0.04 + 0.04 * k);
    }));
  });
  return mergeGeometries(parts);
}

function broadleafGeometry() {
  const parts = [tint(new THREE.CylinderGeometry(0.025, 0.045, 0.5, 5).translate(0, 0.25, 0), brown)];
  [[0, 0.68, 0, 0.3], [0.2, 0.56, 0.1, 0.22], [-0.17, 0.62, -0.14, 0.24], [0.02, 0.88, 0.04, 0.2]].forEach(([x, y, z, r]) => {
    const blob = new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
    parts.push(tint(blob, (c, px, py, pz) => {
      const k = Math.min(1, Math.max(0, (py - 0.45) / 0.55)), n = 0.5 + 0.5 * Math.sin(px * 40 + pz * 31);
      c.setRGB(0.05 + 0.1 * k + 0.02 * n, 0.15 + 0.17 * k + 0.04 * n, 0.03 + 0.04 * k);
    }));
  });
  return mergeGeometries(parts);
}

export function createForest() {
  const rnd = mulberry32(99);
  const kinds = { conifer: [], broadleaf: [] };
  const cell = 2.8;
  for (let gx = -HALF_X + 6; gx < HALF_X - 6; gx += cell) {
    for (let gz = -HALF_Z + 6; gz < HALF_Z - 6; gz += cell) {
      const x = gx + rnd() * cell, z = gz + rnd() * cell;
      const dens = forestField(x, z);
      if (rnd() > dens * 0.95) continue;
      const y = height(x, z), W = riverLevel(z), rel = y - W;
      const d = Math.abs(x - centerX(z)) - riverHalfWidth(z);
      if (d < 3 || rel < 0.9 || y > 100) continue;
      if (rnd() > 1 - smoothstep(75, 100, y)) continue;                // thin out toward the treeline
      if (slope(x, z) > 1.0) continue;
      const coniferP = 0.15 + 0.85 * smoothstep(8, 45, rel);
      const kind = rnd() < coniferP ? 'conifer' : 'broadleaf';
      const h = (kind === 'conifer' ? 8 + rnd() * 8 : 6 + rnd() * 5) * (1 - 0.4 * smoothstep(60, 100, y));
      kinds[kind].push({ x, y: y - 0.1, z, h, rot: rnd() * 6.28, r: rnd(), g: rnd(), b: rnd() });
    }
  }
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const [kind, list] of Object.entries(kinds)) {
    const geo = kind === 'conifer' ? coniferGeometry() : broadleafGeometry();
    const mat = withSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 0.012);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      const w = t.h * (kind === 'conifer' ? 0.9 + 0.3 * t.g : 0.9 + 0.5 * t.g);
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(w, t.h, w));
      mesh.setMatrixAt(i, m);
      if (kind === 'broadleaf' && t.b > 0.85) col.setRGB(1.9, 1.1, 0.35);       // autumn trees
      else col.setRGB(0.8 + 0.4 * t.r, 0.9 + 0.2 * t.g, 0.8 + 0.3 * t.b);
      mesh.setColorAt(i, col);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.layers.set(1);
    group.add(mesh);
  }
  group.userData.count = kinds.conifer.length + kinds.broadleaf.length;
  return group;
}

// ---------- grass / reeds along the river valley ----------
function bladeGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.03, 0, 0, 0.03, 0, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  return g;
}

function makeGrass(count, band, accept, hMin, hMax, hue, seed) {
  const mat = withSway(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), 0.18);
  const mesh = new THREE.InstancedMesh(bladeGeometry(), mat, count);
  const rnd = mulberry32(seed);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  for (let tries = 0; n < count && tries < count * 30; tries++) {
    const z = (rnd() * 2 - 1) * (HALF_Z - 20), x = centerX(z) + (rnd() * 2 - 1) * band;
    const y = height(x, z), rel = y - riverLevel(z), d = Math.abs(x - centerX(z)) - riverHalfWidth(z);
    if (!accept(rel, d, slope(x, z), rnd)) continue;
    q.setFromAxisAngle(up, rnd() * 6.28);
    m.compose(new THREE.Vector3(x, y - 0.02, z), q, new THREE.Vector3(1.4 + rnd(), hMin + rnd() * (hMax - hMin), 1));
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n, c.setHSL(hue + rnd() * 0.05, 0.5, 0.18 + rnd() * 0.12));
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  mesh.layers.set(1);
  return mesh;
}

export function createGrass() {
  const g = new THREE.Group();
  g.add(makeGrass(90000, 30, (rel, d, s, rnd) => rel > 1.0 && d > 1 && s < 0.6 && rnd() > 0.15, 0.25, 0.6, 0.25, 1));
  g.add(makeGrass(14000, 14, (rel, d, s, rnd) => rel > -0.1 && rel < 0.9 && d < 3.5 && s < 0.9, 0.7, 1.4, 0.2, 2)); // reeds
  return g;
}
