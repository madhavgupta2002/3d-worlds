import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Deterministic PRNG so every scene rebuilds identically. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1337) {
    this.next = mulberry32(seed);
  }
  float(a = 0, b = 1) {
    return a + this.next() * (b - a);
  }
  int(a, b) {
    return Math.floor(this.float(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  /** Gaussian-ish, mean 0 stddev ~1 */
  gauss() {
    return (this.next() + this.next() + this.next() - 1.5) * 1.1547;
  }
}

const perlin = new ImprovedNoise();

/** 2D Perlin in [-1,1] */
export function noise2(x, y, z = 0.37) {
  return perlin.noise(x, y, z);
}

/** Fractal brownian motion, returns roughly [-1,1]. */
export function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5, seed = 0.37) {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin.noise(x * freq, y * freq, seed + i * 11.13);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise, nice for rocky Deccan outcrops. */
export function ridged(x, y, octaves = 4, seed = 2.1) {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(perlin.noise(x * freq, y * freq, seed + i * 7.7));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

/** Signed distance to a closed polyline (positive outside). */
export function distToPolyline(x, z, pts, closed = false) {
  let best = Infinity;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const apx = x - a[0];
    const apz = z - a[1];
    const t = clamp((apx * abx + apz * abz) / (abx * abx + abz * abz || 1e-6), 0, 1);
    const dx = apx - abx * t;
    const dz = apz - abz * t;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }
  return best;
}

/** Closest point + tangent on a polyline — used for river centre-lines. */
export function closestOnPolyline(x, z, pts) {
  let best = Infinity,
    px = 0,
    pz = 0,
    tx = 1,
    tz = 0,
    along = 0,
    acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const abx = b[0] - a[0],
      abz = b[1] - a[1];
    const segLen = Math.hypot(abx, abz) || 1e-6;
    const t = clamp(((x - a[0]) * abx + (z - a[1]) * abz) / (segLen * segLen), 0, 1);
    const cx = a[0] + abx * t,
      cz = a[1] + abz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) {
      best = d;
      px = cx;
      pz = cz;
      tx = abx / segLen;
      tz = abz / segLen;
      along = acc + t * segLen;
    }
    acc += segLen;
  }
  return { dist: best, x: px, z: pz, tx, tz, along, total: acc };
}

/** Catmull-rom resample of a coarse polyline, for smooth banks/roads. */
export function smoothPolyline(pts, subdivisions = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(p[0], 0, p[1])),
    closed,
    'catmullrom',
    0.5
  );
  const n = pts.length * subdivisions;
  return curve.getSpacedPoints(n).map((v) => [v.x, v.z]);
}

/** Draw into a 2D canvas and get a texture back. */
export function canvasTexture(size, draw, { srgb = true, repeat = 1, aniso = 4 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.setScalar(repeat);
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

/** Merge BufferGeometries (same attributes) without pulling in BufferGeometryUtils. */
export function mergeGeometries(geoms) {
  const nonIndexed = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  const attrNames = ['position', 'normal', 'uv'];
  let total = 0;
  for (const g of nonIndexed) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of attrNames) {
    const itemSize = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(total * itemSize);
    let offset = 0;
    for (const g of nonIndexed) {
      const src = g.attributes[name];
      if (src) {
        arr.set(src.array.subarray(0, src.count * itemSize), offset);
      }
      offset += g.attributes.position.count * itemSize;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  out.computeBoundingSphere();
  for (const g of nonIndexed) if (!geoms.includes(g)) g.dispose();
  return out;
}

/** Collapse a hierarchy of meshes that share one material into a single geometry. */
export function flattenToGeometry(object) {
  object.updateMatrixWorld(true);
  const geoms = [];
  object.traverse((child) => {
    if (child.isMesh) {
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrixWorld);
      if (!g.attributes.uv) {
        g.setAttribute(
          'uv',
          new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)
        );
      }
      geoms.push(g);
    }
  });
  return geoms.length ? mergeGeometries(geoms) : new THREE.BufferGeometry();
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture && v.userData.shared !== true) v.dispose();
      }
      m.dispose();
    }
  });
}

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/**
 * Compass bearing in degrees from a heading in radians.
 * World convention here: north is +Z, east is +X, and a boat's forward vector
 * is (sin h, 0, cos h) — so bearing is simply the heading.
 */
export function headingToBearing(heading) {
  const deg = (heading * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Bearing in degrees from one world point toward another. */
export function bearingTo(fromX, fromZ, toX, toZ) {
  const deg = (Math.atan2(toX - fromX, toZ - fromZ) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function bearingLabel(bearing) {
  return COMPASS_POINTS[Math.round(bearing / 45) % 8];
}
