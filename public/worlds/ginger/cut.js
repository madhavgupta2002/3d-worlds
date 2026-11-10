// Mesh model: { pos:[x,y,z...], nrm:[x,y,z...], tris:[a,b,c,cap ...], capN:[[x,y,z]...] }
// cap = 0 for skin, otherwise 1-based index into capN (flat normal of that cut face).
// Every mesh is a closed manifold with shared vertices, so plane cuts always yield closed loops.
(function (root) {

  function makeGinger(THREE, rnd) {
    const src = new THREE.IcosahedronGeometry(1, 36).attributes.position.array;
    const lobes = [
      { c: [1, 0.05, 0.1], a: 1.0, k: 5 },
      { c: [-1, -0.05, -0.15], a: 0.8, k: 5 }
    ];
    const extra = 4 + Math.floor(rnd() * 2), t0 = rnd() * 6.28;
    for (let i = 0; i < extra; i++) {
      const t = t0 + (i + (rnd() - 0.5) * 0.9) * Math.PI * 2 / extra; // knobs spread around the body
      lobes.push({ c: [Math.cos(t), (rnd() - 0.3) * 0.9, Math.sin(t)], a: 0.45 + rnd() * 0.85, k: 8 + rnd() * 8 });
    }
    for (const l of lobes) { const n = Math.hypot(...l.c); l.c = l.c.map(v => v / n); }
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6];

    const index = new Map(), pos = [], tris = [];
    const nT = src.length / 9;
    for (let t = 0; t < nT; t++) {
      const id = [];
      for (let k = 0; k < 3; k++) {
        const x = src[t * 9 + k * 3], y = src[t * 9 + k * 3 + 1], z = src[t * 9 + k * 3 + 2];
        const key = Math.round(x * 1e5) + ',' + Math.round(y * 1e5) + ',' + Math.round(z * 1e5);
        let i = index.get(key);
        if (i === undefined) {
          i = pos.length / 3; index.set(key, i);
          let r = 1;
          for (const l of lobes) r += l.a * Math.exp(-l.k * (1 - (x * l.c[0] + y * l.c[1] + z * l.c[2])));
          r *= 1 + 0.035 * Math.sin(7 * x + ph[0]) * Math.sin(6 * z + ph[1]) + 0.02 * Math.sin(11 * y + 13 * x + ph[2]);
          r *= 0.7;
          pos.push(x * r * 1.45, y * r * 0.82, z * r * 0.9);
        }
        id.push(i);
      }
      if (id[0] !== id[1] && id[1] !== id[2] && id[0] !== id[2]) tris.push(id[0], id[1], id[2], 0);
    }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], pos[i]); hi[i % 3] = Math.max(hi[i % 3], pos[i]); }
    const shift = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]; // centre on the board, rest on y = 0
    for (let i = 0; i < pos.length; i++) pos[i] -= shift[i % 3];

    const nrm = new Array(pos.length).fill(0);
    for (let t = 0; t < tris.length; t += 4) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const i of [a, b, c]) { nrm[i] += nx; nrm[i + 1] += ny; nrm[i + 2] += nz; }
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    return { pos, nrm, tris, capN: [] };
  }

  // Split by plane through (px,py,pz) with unit normal (nx,ny,nz).
  // Returns [positiveSide, negativeSide] or null if the plane misses the mesh.
  function splitMesh(THREE, m, px, py, pz, nx, ny, nz) {
    const P = m.pos, N = m.nrm, T = m.tris, V = P.length / 3;
    const d = new Float32Array(V);
    let np = 0, nn = 0;
    for (let i = 0; i < V; i++) {
      let v = (P[i * 3] - px) * nx + (P[i * 3 + 1] - py) * ny + (P[i * 3 + 2] - pz) * nz;
      if (Math.abs(v) < 1e-5) v = 1e-5;
      d[i] = v; if (v > 0) np++; else nn++;
    }
    if (!np || !nn) return null;

    const capId = m.capN.length + 1;
    const out = [
      { pos: [], nrm: [], tris: [], capN: m.capN.concat([[-nx, -ny, -nz]]) },
      { pos: [], nrm: [], tris: [], capN: m.capN.concat([[nx, ny, nz]]) }
    ];
    const map = [new Int32Array(V).fill(-1), new Int32Array(V).fill(-1)];
    const emap = new Map();

    function vert(s, i) {
      let j = map[s][i];
      if (j < 0) {
        j = out[s].pos.length / 3;
        out[s].pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        out[s].nrm.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        map[s][i] = j;
      }
      return j;
    }
    function cutv(a, b) {
      const key = a < b ? a * V + b : b * V + a;
      let e = emap.get(key);
      if (!e) {
        const t = d[a] / (d[a] - d[b]), A = a * 3, B = b * 3;
        const x = P[A] + (P[B] - P[A]) * t, y = P[A + 1] + (P[B + 1] - P[A + 1]) * t, z = P[A + 2] + (P[B + 2] - P[A + 2]) * t;
        let mx = N[A] + (N[B] - N[A]) * t, my = N[A + 1] + (N[B + 1] - N[A + 1]) * t, mz = N[A + 2] + (N[B + 2] - N[A + 2]) * t;
        const l = Math.hypot(mx, my, mz) || 1; mx /= l; my /= l; mz /= l;
        e = { x, y, z, i: [0, 0], n: [], seen: false };
        for (let s = 0; s < 2; s++) {
          e.i[s] = out[s].pos.length / 3;
          out[s].pos.push(x, y, z); out[s].nrm.push(mx, my, mz);
        }
        emap.set(key, e);
      }
      return e;
    }

    for (let t = 0; t < T.length; t += 4) {
      const a = T[t], b = T[t + 1], c = T[t + 2], cap = T[t + 3];
      const sa = d[a] > 0, sb = d[b] > 0, sc = d[c] > 0;
      if (sa === sb && sb === sc) {
        const s = sa ? 0 : 1;
        out[s].tris.push(vert(s, a), vert(s, b), vert(s, c), cap);
        continue;
      }
      let v0, v1, v2;
      if (sa !== sb && sa !== sc) { v0 = a; v1 = b; v2 = c; }
      else if (sb !== sa && sb !== sc) { v0 = b; v1 = c; v2 = a; }
      else { v0 = c; v1 = a; v2 = b; }
      const s0 = d[v0] > 0 ? 0 : 1, s1 = 1 - s0;
      const e1 = cutv(v0, v1), e2 = cutv(v0, v2);
      out[s0].tris.push(vert(s0, v0), e1.i[s0], e2.i[s0], cap);
      const q1 = vert(s1, v1), q2 = vert(s1, v2);
      out[s1].tris.push(e1.i[s1], q1, q2, cap, e1.i[s1], q2, e2.i[s1], cap);
      e1.n.push(e2); e2.n.push(e1);
    }

    // plane basis with u x v = n
    let ux = ny * 0 - nz * 1, uy = nz * 0 - nx * 0, uz = nx * 1 - ny * 0; // n x (0,1,0)
    if (Math.hypot(ux, uy, uz) < 1e-3) { ux = 0; uy = nz; uz = -ny; }      // n x (1,0,0)
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;

    for (const start of emap.values()) {
      if (start.seen) continue;
      const loop = [];
      let prev = null, cur = start;
      while (cur && !cur.seen) {
        cur.seen = true; loop.push(cur);
        const nxt = cur.n[0] !== prev ? cur.n[0] : cur.n[1];
        prev = cur; cur = nxt;
      }
      if (loop.length < 3) continue;
      const contour = loop.map(e => new THREE.Vector2(e.x * ux + e.y * uy + e.z * uz, e.x * vx + e.y * vy + e.z * vz));
      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const f of faces) {
        const A = contour[f[0]], B = contour[f[1]], C = contour[f[2]];
        const ccw = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0;
        const i = loop[f[0]], j = loop[ccw ? f[1] : f[2]], k = loop[ccw ? f[2] : f[1]]; // i,j,k is CCW => normal +n
        out[1].tris.push(i.i[1], j.i[1], k.i[1], capId);
        out[0].tris.push(i.i[0], k.i[0], j.i[0], capId);
      }
    }
    return out;
  }

  // Separate a mesh into connected pieces.
  function components(m) {
    const V = m.pos.length / 3, T = m.tris, par = new Int32Array(V);
    for (let i = 0; i < V; i++) par[i] = i;
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let t = 0; t < T.length; t += 4) {
      const a = find(T[t]), b = find(T[t + 1]), c = find(T[t + 2]);
      if (a !== b) par[b] = a;
      const a2 = find(a); if (a2 !== c) par[find(c)] = a2;
    }
    const subs = new Map(), idx = new Int32Array(V).fill(-1);
    for (let t = 0; t < T.length; t += 4) {
      const r = find(T[t]);
      let s = subs.get(r);
      if (!s) { s = { pos: [], nrm: [], tris: [], capN: m.capN }; subs.set(r, s); }
      for (let k = 0; k < 3; k++) {
        const i = T[t + k];
        if (idx[i] < 0) {
          idx[i] = s.pos.length / 3;
          s.pos.push(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
          s.nrm.push(m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]);
        }
        s.tris.push(idx[i]);
      }
      s.tris.push(T[t + 3]);
    }
    return [...subs.values()];
  }

  const api = { makeGinger, splitMesh, components };
  if (typeof module !== 'undefined') module.exports = api; else root.GingerCut = api;
})(typeof window !== 'undefined' ? window : globalThis);
