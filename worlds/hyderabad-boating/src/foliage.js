import * as THREE from 'three';
import { bentTrunk, leafCard, frondCard, cylinder, box, mergeGeometries } from './geom.js';
import { makeFloating, makeWindy } from './shaders/waves.js';
import { Rng, TAU, noise2 } from './utils.js';

/**
 * Instanced vegetation. Scenes call add('palm', x, z, opts) as many times as
 * they like, then build() — each species becomes one or two InstancedMeshes
 * (trunk + alpha-tested foliage cards) with wind sway in the vertex shader.
 */
export class Foliage {
  constructor({ scene, assets, terrain, water, windClock, seed = 77 }) {
    this.scene = scene;
    this.assets = assets;
    this.terrain = terrain;
    this.water = water;
    this.windClock = windClock;
    this.rng = new Rng(seed);
    this.group = new THREE.Group();
    this.group.name = 'foliage';
    scene.add(this.group);
    this.placements = new Map();
    this.kinds = new Map();
    this.meshes = [];
    this.#materials();
  }

  #materials() {
    const a = this.assets;
    this.bark = a.material('bark', { repeat: 1.6, roughness: 0.95, metalness: 0 });
    this.bark.color.setHex(0x9a8a76);

    this.leafBase = new THREE.MeshStandardMaterial({
      map: a.proc.leaf,
      side: THREE.DoubleSide,
      alphaTest: 0.42,
      roughness: 0.78,
      metalness: 0,
      envMapIntensity: 0.8,
    });
    this.frondBase = new THREE.MeshStandardMaterial({
      map: a.proc.frond,
      side: THREE.DoubleSide,
      alphaTest: 0.38,
      roughness: 0.72,
      metalness: 0,
    });
    this.reedMat = new THREE.MeshStandardMaterial({
      color: 0x7d7f46,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0,
    });
    this.padMat = new THREE.MeshStandardMaterial({
      map: a.proc.lilypad,
      side: THREE.DoubleSide,
      alphaTest: 0.4,
      roughness: 0.42,
      metalness: 0,
    });
    this.hyacinthMat = new THREE.MeshStandardMaterial({
      map: a.proc.hyacinth,
      side: THREE.DoubleSide,
      alphaTest: 0.35,
      roughness: 0.6,
      metalness: 0,
    });
  }

  #leafMat(tint, windHeight, strength = 0.14) {
    const m = this.leafBase.clone();
    m.map = this.leafBase.map;
    if (tint !== undefined) m.color.setHex(tint);
    makeWindy(m, this.windClock, { strength, height: windHeight });
    return m;
  }

  // ------------------------------------------------------------------ species
  #build(kind) {
    if (this.kinds.has(kind)) return this.kinds.get(kind);
    const rng = this.rng;
    let def;

    switch (kind) {
      case 'palm': {
        // Coconut palm: leaning tapered trunk, 11 drooping fronds, a few nuts.
        const trunk = bentTrunk({
          height: 9.5,
          rBottom: 0.34,
          rTop: 0.2,
          bend: 0.1,
          bendDir: 0.6,
          taper: 1.7,
          heightSegs: 12,
        });
        const rings = [];
        for (let i = 0; i < 9; i++) {
          const y = 0.9 + i * 0.85;
          rings.push(cylinder(0.33 - i * 0.012, 0.33 - i * 0.012, 0.1, 9, { y }));
        }
        const fronds = [];
        const top = 9.3;
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * TAU + rng.float(-0.12, 0.12);
          const pitch = rng.float(0.35, 1.15);
          const g = frondCard(rng.float(3.0, 4.0), rng.float(1.0, 1.3), rng.float(0.45, 0.75));
          g.rotateX(pitch);
          g.rotateY(-a);
          g.translate(Math.cos(a) * 0.22, top, Math.sin(a) * 0.22);
          fronds.push(g);
        }
        const nuts = [];
        for (let i = 0; i < 5; i++) {
          const a = rng.float(0, TAU);
          nuts.push(
            new THREE.SphereGeometry(0.17, 8, 6).translate(
              Math.cos(a) * 0.42,
              top - 0.35,
              Math.sin(a) * 0.42
            )
          );
        }
        const frondMat = this.frondBase.clone();
        frondMat.map = this.frondBase.map;
        makeWindy(frondMat, this.windClock, { strength: 0.22, height: 10 });
        const barkMat = this.bark.clone();
        makeWindy(barkMat, this.windClock, { strength: 0.07, height: 10 });
        def = {
          parts: [
            { geometry: mergeGeometries([trunk, ...rings, ...nuts]), material: barkMat, shadow: true },
            { geometry: mergeGeometries(fronds), material: frondMat, shadow: true },
          ],
        };
        break;
      }

      case 'neem':
      case 'jacaranda':
      case 'gulmohar': {
        const tint = kind === 'jacaranda' ? 0x9f8fd0 : kind === 'gulmohar' ? 0xd98b57 : 0xa8c47a;
        const h = kind === 'neem' ? 7.5 : 6.5;
        const trunk = bentTrunk({
          height: h,
          rBottom: 0.46,
          rTop: 0.2,
          bend: 0.12,
          bendDir: rng.float(0, TAU),
          taper: 2.2,
        });
        const branches = [];
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + rng.float(-0.3, 0.3);
          const len = rng.float(2.2, 3.4);
          const g = cylinder(0.17, 0.07, len, 6);
          g.rotateZ(rng.float(0.5, 0.95));
          g.rotateY(-a);
          g.translate(0, h * 0.72, 0);
          branches.push(g);
        }
        const cards = [];
        const canopyY = h * 0.92;
        for (let i = 0; i < 18; i++) {
          const a = rng.float(0, TAU);
          const r = Math.pow(rng.float(0, 1), 0.55) * 3.2;
          const g = leafCard(rng.float(2.6, 4.0), rng.float(2.4, 3.6), 0.3);
          g.rotateX(rng.float(-0.9, 0.9));
          g.rotateZ(rng.float(-0.7, 0.7));
          g.rotateY(rng.float(0, TAU));
          g.translate(Math.cos(a) * r, canopyY + rng.float(-0.9, 1.7) - 1.2, Math.sin(a) * r);
          cards.push(g);
        }
        const barkMat = this.bark.clone();
        makeWindy(barkMat, this.windClock, { strength: 0.05, height: h + 2 });
        def = {
          parts: [
            { geometry: mergeGeometries([trunk, ...branches]), material: barkMat, shadow: true },
            { geometry: mergeGeometries(cards), material: this.#leafMat(tint, h + 3, 0.16), shadow: true },
          ],
        };
        break;
      }

      case 'banyan': {
        // Wide crown and aerial prop roots — the old trees along the tank bunds.
        const h = 8.5;
        const trunk = bentTrunk({ height: h, rBottom: 1.0, rTop: 0.3, bend: 0.08, taper: 3.2, radialSegs: 12 });
        const roots = [];
        for (let i = 0; i < 9; i++) {
          const a = rng.float(0, TAU);
          const r = rng.float(2.0, 4.6);
          const top = rng.float(4.5, 6.5);
          const g = cylinder(0.1, 0.16, top, 5);
          g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
          roots.push(g);
        }
        const branches = [];
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU;
          const g = cylinder(0.26, 0.1, rng.float(3.5, 5.2), 6);
          g.rotateZ(rng.float(0.9, 1.25));
          g.rotateY(-a);
          g.translate(0, h * 0.68, 0);
          branches.push(g);
        }
        const cards = [];
        for (let i = 0; i < 26; i++) {
          const a = rng.float(0, TAU);
          const r = Math.pow(rng.float(0, 1), 0.5) * 5.4;
          const g = leafCard(rng.float(3.0, 4.6), rng.float(2.6, 3.8), 0.3);
          g.rotateX(rng.float(-0.8, 0.8));
          g.rotateY(rng.float(0, TAU));
          g.translate(Math.cos(a) * r, h * 0.92 + rng.float(-1.2, 1.4), Math.sin(a) * r);
          cards.push(g);
        }
        const barkMat = this.bark.clone();
        barkMat.color.setHex(0x8e8373);
        makeWindy(barkMat, this.windClock, { strength: 0.03, height: h + 3 });
        def = {
          parts: [
            { geometry: mergeGeometries([trunk, ...roots, ...branches]), material: barkMat, shadow: true },
            { geometry: mergeGeometries(cards), material: this.#leafMat(0x93b06c, h + 3, 0.12), shadow: true },
          ],
        };
        break;
      }

      case 'scrub': {
        const cards = [];
        for (let i = 0; i < 7; i++) {
          const a = rng.float(0, TAU);
          const r = rng.float(0, 0.6);
          const g = leafCard(rng.float(1.1, 1.8), rng.float(1.0, 1.5), 0.25);
          g.rotateX(rng.float(-0.8, 0.8));
          g.rotateY(rng.float(0, TAU));
          g.translate(Math.cos(a) * r, rng.float(0.2, 0.9), Math.sin(a) * r);
          cards.push(g);
        }
        def = {
          parts: [
            {
              geometry: mergeGeometries(cards),
              material: this.#leafMat(0x8f9c5c, 1.8, 0.1),
              shadow: true,
            },
          ],
        };
        break;
      }

      case 'reeds':
      case 'tallgrass': {
        const tall = kind === 'reeds';
        const blades = [];
        const count = tall ? 14 : 10;
        for (let i = 0; i < count; i++) {
          const a = rng.float(0, TAU);
          const r = rng.float(0, tall ? 0.55 : 0.4);
          const hgt = tall ? rng.float(1.5, 2.6) : rng.float(0.5, 0.95);
          const w = tall ? 0.085 : 0.07;
          const g = new THREE.PlaneGeometry(w, hgt, 1, 4);
          const pos = g.attributes.position;
          for (let v = 0; v < pos.count; v++) {
            const y = pos.getY(v) + hgt / 2;
            const t = y / hgt;
            pos.setY(v, y);
            pos.setX(v, pos.getX(v) * (1 - t * 0.8));
            pos.setZ(v, t * t * hgt * 0.22);
          }
          pos.needsUpdate = true;
          g.computeVertexNormals();
          g.rotateY(a);
          g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
          blades.push(g);
          if (tall && rng.next() < 0.5) {
            const head = cylinder(0.05, 0.02, 0.3, 5, { y: hgt - 0.05 });
            head.rotateY(a);
            head.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
            blades.push(head);
          }
        }
        const mat = this.reedMat.clone();
        mat.color.setHex(tall ? 0x7b7d45 : 0x8b8a4c);
        makeWindy(mat, this.windClock, { strength: tall ? 0.16 : 0.08, height: tall ? 2.4 : 0.9 });
        def = { parts: [{ geometry: mergeGeometries(blades), material: mat, shadow: false }] };
        break;
      }

      case 'lilypad': {
        const pads = [];
        for (let i = 0; i < 5; i++) {
          const a = rng.float(0, TAU);
          const r = rng.float(0, 1.1);
          const s = rng.float(0.35, 0.72);
          const g = new THREE.CircleGeometry(s, 12);
          g.rotateX(-Math.PI / 2);
          g.rotateY(rng.float(0, TAU));
          g.translate(Math.cos(a) * r, 0.035, Math.sin(a) * r);
          pads.push(g);
        }
        const mat = this.padMat.clone();
        mat.map = this.padMat.map;
        makeFloating(mat, this.water, { bobScale: 1, tilt: 0.85 });
        def = { parts: [{ geometry: mergeGeometries(pads), material: mat, shadow: false, floating: true }] };
        break;
      }

      case 'lotus': {
        // flower: layered petals on a short stalk
        const parts = [];
        for (let row = 0; row < 3; row++) {
          const n = 8 - row;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + row * 0.3;
            const g = new THREE.PlaneGeometry(0.16, 0.3, 1, 2);
            const pos = g.attributes.position;
            for (let v = 0; v < pos.count; v++) {
              const t = (pos.getY(v) + 0.15) / 0.3;
              pos.setX(v, pos.getX(v) * (1 - Math.abs(t - 0.5) * 0.9));
              pos.setZ(v, -0.06 * Math.sin(t * Math.PI));
            }
            pos.needsUpdate = true;
            g.computeVertexNormals();
            g.rotateX(-0.75 + row * 0.3);
            g.rotateY(-a);
            g.translate(Math.cos(a) * 0.07, 0.3 + row * 0.05, Math.sin(a) * 0.07);
            parts.push(g);
          }
        }
        parts.push(cylinder(0.03, 0.025, 0.32, 5));
        const mat = new THREE.MeshStandardMaterial({
          color: 0xf2c4d6,
          side: THREE.DoubleSide,
          roughness: 0.55,
          metalness: 0,
        });
        makeFloating(mat, this.water, { bobScale: 1, tilt: 0.3 });
        def = { parts: [{ geometry: mergeGeometries(parts), material: mat, shadow: false, floating: true }] };
        break;
      }

      case 'hyacinth': {
        // Water hyacinth raft — the green mats that drift across Hussain Sagar.
        const parts = [];
        for (let i = 0; i < 4; i++) {
          const a = rng.float(0, TAU);
          const r = rng.float(0, 1.4);
          const s = rng.float(1.0, 2.2);
          const g = new THREE.PlaneGeometry(s, s, 1, 1);
          g.rotateX(-Math.PI / 2);
          g.rotateY(rng.float(0, TAU));
          g.translate(Math.cos(a) * r, 0.04, Math.sin(a) * r);
          parts.push(g);
        }
        for (let i = 0; i < 7; i++) {
          const a = rng.float(0, TAU);
          const r = rng.float(0, 1.5);
          const g = leafCard(0.3, 0.42, 0.3);
          g.rotateX(rng.float(-0.5, 0.5));
          g.rotateY(rng.float(0, TAU));
          g.translate(Math.cos(a) * r, 0.05, Math.sin(a) * r);
          parts.push(g);
        }
        const mat = this.hyacinthMat.clone();
        mat.map = this.hyacinthMat.map;
        makeFloating(mat, this.water, { bobScale: 1, tilt: 0.7 });
        def = { parts: [{ geometry: mergeGeometries(parts), material: mat, shadow: false, floating: true }] };
        break;
      }

      default:
        throw new Error('unknown foliage kind: ' + kind);
    }

    this.kinds.set(kind, def);
    return def;
  }

  /** Queue one plant. y defaults to the terrain height (or water level). */
  add(kind, x, z, { scale = 1, rotY, y } = {}) {
    if (!this.placements.has(kind)) this.placements.set(kind, []);
    this.placements.get(kind).push({
      x,
      z,
      y,
      scale,
      rotY: rotY ?? this.rng.float(0, TAU),
    });
  }

  build() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (const [kind, list] of this.placements) {
      if (!list.length) continue;
      const def = this.#build(kind);
      for (const part of def.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        mesh.castShadow = !!part.shadow;
        mesh.receiveShadow = !!part.shadow;
        mesh.name = `foliage:${kind}`;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          const y = it.y ?? (part.floating ? this.water.level : this.terrain.height(it.x, it.z));
          p.set(it.x, y, it.z);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rotY);
          const sc = it.scale;
          s.set(sc, sc, sc);
          m.compose(p, q, s);
          mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = true;
        mesh.computeBoundingSphere?.();
        this.group.add(mesh);
        this.meshes.push(mesh);
      }
    }
    this.placements.clear();
    return this;
  }

  /** Slight per-species breathing of the leaf colour at dusk/night. */
  applySky(preset) {
    const night = preset.hdri === 'night';
    for (const mesh of this.meshes) {
      if (mesh.material.map === this.assets.proc.leaf) {
        mesh.material.envMapIntensity = night ? 1.4 : 0.85;
      }
    }
  }
}

/** Jitter helper that keeps clumps from looking like a grid. */
export function clumpOffsets(rng, count, radius) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = rng.float(0, TAU);
    const r = Math.sqrt(rng.float(0, 1)) * radius;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Terrain-aware scatter: find spots matching height/slope/water rules. */
export function scatter(
  terrain,
  rng,
  {
    count = 100,
    area, // {minX,maxX,minZ,maxZ} or {cx,cz,radius}
    minHeight = -Infinity,
    maxHeight = Infinity,
    maxSlope = 1,
    minDepth = -Infinity,
    maxDepth = Infinity,
    shoreBand, // [min,max] metres from the waterline (positive = inland)
    mask, // (x,z,h) => bool
    tries = 40,
  } = {}
) {
  const out = [];
  const pick = () => {
    if (area?.radius !== undefined) {
      const a = rng.float(0, TAU);
      const r = Math.sqrt(rng.float(0, 1)) * area.radius;
      return [area.cx + Math.cos(a) * r, area.cz + Math.sin(a) * r];
    }
    return [rng.float(area.minX, area.maxX), rng.float(area.minZ, area.maxZ)];
  };
  const normal = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < tries; t++) {
      const [x, z] = pick();
      const h = terrain.height(x, z);
      if (h < minHeight || h > maxHeight) continue;
      const depth = terrain.level - h;
      if (depth < minDepth || depth > maxDepth) continue;
      terrain.normal(x, z, normal);
      if (1 - normal.y > maxSlope) continue;
      if (shoreBand) {
        // crude distance-to-water: march outward along the downhill direction
        const d = shoreDistance(terrain, x, z);
        if (d < shoreBand[0] || d > shoreBand[1]) continue;
      }
      if (mask && !mask(x, z, h)) continue;
      out.push({ x, z, h });
      break;
    }
  }
  return out;
}

/** Approximate distance from (x,z) to the waterline, searching a few rings. */
export function shoreDistance(terrain, x, z, maxR = 40, steps = 8) {
  const wet = terrain.height(x, z) < terrain.level;
  for (let r = 2; r <= maxR; r += maxR / steps) {
    for (let a = 0; a < TAU; a += TAU / 10) {
      const h = terrain.height(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (h < terrain.level !== wet) return r;
    }
  }
  return maxR;
}

export { noise2 };
