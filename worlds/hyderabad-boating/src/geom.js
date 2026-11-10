import * as THREE from 'three';
import { mergeGeometries } from './utils.js';

/** Box with base at y=0 unless centred. */
export function box(w, h, d, { y = 0, x = 0, z = 0, centred = false } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + (centred ? 0 : h / 2), z);
  return g;
}

export function cylinder(rBottom, rTop, h, segs = 12, { y = 0, x = 0, z = 0, open = false } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segs, 1, open);
  g.translate(x, y + h / 2, z);
  return g;
}

/** A trunk that leans and bends, tapering as it goes up. Base at y=0. */
export function bentTrunk({
  height = 8,
  rBottom = 0.35,
  rTop = 0.16,
  bend = 0.25,
  bendDir = 0,
  radialSegs = 9,
  heightSegs = 10,
  taper = 1.5,
} = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radialSegs, heightSegs, true);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position;
  const dx = Math.cos(bendDir);
  const dz = Math.sin(bendDir);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp(y / height, 0, 1);
    // taper: squeeze radius with an exponential profile
    const shrink = Math.pow(1 - t, 0.35) * (1 - 1 / taper) + 1 / taper;
    pos.setX(i, pos.getX(i) * shrink + dx * bend * height * t * t);
    pos.setZ(i, pos.getZ(i) * shrink + dz * bend * height * t * t);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** A leaf/foliage card: a plane bowed along its length, pivot at the stem. */
export function leafCard(width = 2, length = 2.6, bow = 0.25, segs = 3) {
  const g = new THREE.PlaneGeometry(width, length, segs, segs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = x / (width / 2);
    const v = (y + length / 2) / length;
    pos.setZ(i, -bow * (u * u) * length * 0.35 - bow * v * length * 0.1);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.translate(0, length / 2, 0);
  return g;
}

/** Palm frond: long card that droops, pivot at the base of the rachis. */
export function frondCard(length = 3.2, width = 1.1, droop = 0.5) {
  const g = new THREE.PlaneGeometry(width, length, 2, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + length / 2; // 0..length
    const t = y / length;
    pos.setY(i, y - droop * length * t * t * 0.9);
    pos.setZ(i, Math.abs(pos.getX(i)) * -0.25 * t);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.rotateX(0);
  return g;
}

/** Stone/concrete steps descending to the water (ghats). Base of top step at y=0. */
export function steps({ width = 10, count = 8, rise = 0.35, run = 0.8 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push(
      box(width, rise, run * (count - i), {
        y: -rise * (i + 1),
        z: run * i + (run * (count - i)) / 2,
      })
    );
  }
  return mergeGeometries(parts);
}

/** Masonry wall pierced by semicircular arches — old Hyderabadi bridges. */
export function archedWall({
  spanCount = 7,
  spanWidth = 6,
  pierWidth = 1.8,
  archRise = 3,
  wallHeight = 7,
  thickness = 4,
  deckOverhang = 0.4,
} = {}) {
  const totalWidth = spanCount * spanWidth + (spanCount + 1) * pierWidth;
  const shape = new THREE.Shape();
  shape.moveTo(-totalWidth / 2, 0);
  shape.lineTo(totalWidth / 2, 0);
  shape.lineTo(totalWidth / 2, wallHeight);
  shape.lineTo(-totalWidth / 2, wallHeight);
  shape.lineTo(-totalWidth / 2, 0);

  for (let i = 0; i < spanCount; i++) {
    const cx = -totalWidth / 2 + pierWidth * (i + 1) + spanWidth * i + spanWidth / 2;
    const r = spanWidth / 2;
    const springing = Math.max(0.2, archRise - r);
    const hole = new THREE.Path();
    hole.moveTo(cx - r, 0);
    hole.lineTo(cx - r, springing);
    hole.absarc(cx, springing, r, Math.PI, 0, true);
    hole.lineTo(cx + r, 0);
    hole.lineTo(cx - r, 0);
    shape.holes.push(hole);
  }

  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 1,
    curveSegments: 14,
  });
  g.translate(0, 0, -thickness / 2);

  const deck = box(totalWidth, 0.6, thickness + deckOverhang * 2, { y: wallHeight });
  return { geometry: mergeGeometries([g, deck]), width: totalWidth, height: wallHeight };
}

/** Onion dome (Qutb Shahi style) as a lathe. */
export function onionDome(radius = 3, height = 4.4, segments = 24) {
  const pts = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // bulges out then tucks into a point
    const r = radius * Math.sin(Math.PI * t * 0.92) * (1 + 0.22 * Math.sin(Math.PI * t) - 0.3 * t * t);
    const y = height * t;
    pts.push(new THREE.Vector2(Math.max(0.01, r), y));
  }
  pts.push(new THREE.Vector2(0.05, height * 1.04));
  const g = new THREE.LatheGeometry(pts, segments);
  const finial = cylinder(0.12, 0.03, radius * 0.5, 8, { y: height * 1.02 });
  return mergeGeometries([g, finial]);
}

/** Lotus pedestal of overlapping petals — the Buddha statue's base. */
export function lotusPedestal({ radius = 6, petals = 16, rows = 2, height = 2.2 } = {}) {
  const parts = [cylinder(radius * 0.78, radius * 0.86, height * 0.55, 24)];
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0, 0);
  petalShape.quadraticCurveTo(0.7, 0.35, 0.95, 1.5);
  petalShape.quadraticCurveTo(0.4, 2.1, 0, 2.3);
  petalShape.quadraticCurveTo(-0.4, 2.1, -0.95, 1.5);
  petalShape.quadraticCurveTo(-0.7, 0.35, 0, 0);
  for (let row = 0; row < rows; row++) {
    const count = petals - row * 2;
    const rr = radius * (0.92 - row * 0.16);
    const yy = height * (0.25 + row * 0.33);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + row * 0.2;
      const g = new THREE.ExtrudeGeometry(petalShape, {
        depth: 0.22,
        bevelEnabled: true,
        bevelSize: 0.06,
        bevelThickness: 0.06,
        bevelSegments: 1,
        curveSegments: 5,
      });
      g.scale(radius * 0.16, radius * 0.16, 1);
      g.rotateX(-Math.PI / 2 + 0.75);
      g.rotateY(-a);
      g.translate(Math.cos(a) * rr * 0.72, yy, Math.sin(a) * rr * 0.72);
      parts.push(g);
    }
  }
  return mergeGeometries(parts);
}

/** Posts + two rails following a polyline. Returns geometry in world xz. */
export function railing(points, { height = 1.05, postEvery = 2.4, postSize = 0.09, railSize = 0.07, yFn } = {}) {
  const parts = [];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const y0 = yFn ? yFn(x0, z0) : 0;
    // rails
    for (const h of [height, height * 0.55]) {
      const g = box(len, railSize, railSize, { centred: true });
      g.rotateY(-ang);
      g.translate((x0 + x1) / 2, y0 + h, (z0 + z1) / 2);
      parts.push(g);
    }
    // posts
    acc += len;
    const n = Math.max(1, Math.floor(len / postEvery));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      const py = yFn ? yFn(px, pz) : 0;
      const g = box(postSize, height, postSize, { y: py });
      g.translate(px, 0, pz);
      parts.push(g);
    }
  }
  return parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
}

/** Catenary sag between two points — cables, laundry lines, festoon lights. */
export function catenaryPoints(from, to, sag = 1, segments = 16) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const y = from.y + (to.y - from.y) * t - sag * Math.sin(Math.PI * t);
    pts.push(new THREE.Vector3(x, y, z));
  }
  return pts;
}

export function tube(points, radius = 0.05, radialSegs = 5) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, radialSegs, false);
}

/** Simple Hindu temple gopuram / shikhara: stepped tower with a kalasha. */
export function shikhara({ base = 3, height = 7, tiers = 5 } = {}) {
  const parts = [];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const w = base * (1 - t * 0.72);
    const h = height / tiers;
    parts.push(box(w, h * 0.82, w, { y: i * h }));
    parts.push(box(w * 1.12, h * 0.18, w * 1.12, { y: i * h + h * 0.82 }));
  }
  const topY = height;
  parts.push(new THREE.SphereGeometry(base * 0.16, 10, 8).translate(0, topY + base * 0.1, 0));
  parts.push(cylinder(base * 0.05, 0.02, base * 0.3, 6, { y: topY + base * 0.2 }));
  return mergeGeometries(parts);
}

/** Minaret with balconies and a small dome — Charminar / Mecca Masjid. */
export function minaret({ height = 24, radius = 1.9, balconies = 3 } = {}) {
  const parts = [cylinder(radius, radius * 0.72, height, 16)];
  for (let i = 1; i <= balconies; i++) {
    const y = (height * i) / (balconies + 0.6);
    const r = radius * (1 - (0.28 * i) / balconies);
    parts.push(cylinder(r * 1.5, r * 1.5, 0.35, 16, { y }));
    parts.push(cylinder(r * 1.42, r * 1.42, 0.7, 16, { y: y + 0.35, open: true }));
  }
  const capY = height;
  parts.push(cylinder(radius * 0.8, radius * 0.8, 0.4, 16, { y: capY }));
  const dome = onionDome(radius * 0.82, radius * 1.5, 16);
  dome.translate(0, capY + 0.4, 0);
  parts.push(dome);
  return mergeGeometries(parts);
}

/** Flat slab following a polyline (roads, piers, embankment tops). */
export function ribbon(points, { width = 6, y = 0, yFn, uvScale = 0.1 } = {}) {
  const verts = [];
  const norms = [];
  const uvs = [];
  const idx = [];
  let dist = 0;
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz;
    const nz = tx;
    const yy = yFn ? yFn(x, z) : y;
    if (i > 0) dist += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    verts.push(x + nx * width * 0.5, yy, z + nz * width * 0.5);
    verts.push(x - nx * width * 0.5, yy, z - nz * width * 0.5);
    norms.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, dist * uvScale, 1, dist * uvScale);
    if (i < points.length - 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g.toNonIndexed();
}

/** Deform a geometry with low-frequency noise — makes primitives look natural. */
export function roughen(geometry, amount = 0.15, frequency = 0.6, noiseFn) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noiseFn(x * frequency, y * frequency, z * frequency);
    const l = Math.hypot(x, y, z) || 1;
    pos.setXYZ(i, x + (x / l) * n * amount, y + (y / l) * n * amount, z + (z / l) * n * amount);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export { mergeGeometries };
