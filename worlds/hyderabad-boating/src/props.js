import * as THREE from 'three';
import {
  box,
  cylinder,
  mergeGeometries,
  ribbon,
  railing,
  steps,
  shikhara,
  onionDome,
  tube,
  catenaryPoints,
  roughen,
} from './geom.js';
import { BOAT_BUILDERS } from './boatModels.js';
import { makeFloating } from './shaders/waves.js';
import { noise2, TAU, smoothPolyline } from './utils.js';

/**
 * Everything that isn't terrain, water, vegetation or the player's boat:
 * jetties, ghats, lamps, buildings, boulders, moored boats, buffalo, birds,
 * traffic, floating litter. Each helper adds to the scene group and (when it
 * moves) registers an updater.
 */
export class Props {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.group = ctx.group;
    this.assets = ctx.assets;
    this.mats = ctx.mats;
    this.night = ctx.night;
    this.terrain = ctx.terrain;
    this.water = ctx.water;
    this.rng = ctx.rng;
    this.updaters = ctx.updaters;
  }

  #add(geometry, material, { shadow = true, name } = {}) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    if (name) m.name = name;
    this.group.add(m);
    return m;
  }

  terrainY(x, z) {
    return this.terrain.height(x, z);
  }

  // ---------------------------------------------------------------- walkways
  /** Timber jetty on piles, deck at a fixed height above the water. */
  jetty(points, { width = 2.6, deckY = 0.9, pileEvery = 3.4, rail = true } = {}) {
    const pts = smoothPolyline(points, 4);
    const deck = ribbon(pts, { width, y: deckY, uvScale: 0.35 });
    this.#add(deck, this.mats.planks, { name: 'jetty-deck' });

    const piles = [];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc < pileEvery) continue;
      acc = 0;
      const [x, z] = pts[i];
      const ground = this.terrainY(x, z);
      const h = deckY - ground + 0.2;
      if (h <= 0.2) continue;
      for (const side of [-1, 1]) {
        const dx = -(pts[i][1] - pts[i - 1][1]);
        const dz = pts[i][0] - pts[i - 1][0];
        const l = Math.hypot(dx, dz) || 1;
        const ox = (dx / l) * width * 0.42 * side;
        const oz = (dz / l) * width * 0.42 * side;
        piles.push(cylinder(0.13, 0.11, h, 8, { x: x + ox, y: ground, z: z + oz }));
      }
    }
    if (piles.length) this.#add(mergeGeometries(piles), this.mats.darkPlanks, { name: 'jetty-piles' });

    if (rail) {
      const left = pts.map(([x, z], i) => {
        const n = this.#normalAt(pts, i);
        return [x + n[0] * width * 0.45, z + n[1] * width * 0.45];
      });
      const right = pts.map(([x, z], i) => {
        const n = this.#normalAt(pts, i);
        return [x - n[0] * width * 0.45, z - n[1] * width * 0.45];
      });
      const g = mergeGeometries([
        railing(left, { height: 0.95, postEvery: 2.2, yFn: () => deckY }),
        railing(right, { height: 0.95, postEvery: 2.2, yFn: () => deckY }),
      ]);
      this.#add(g, this.mats.darkPlanks, { name: 'jetty-rail' });
    }
    return this;
  }

  #normalAt(pts, i) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  }

  /** Stepped ghat descending into the water, facing `angle`. */
  ghat(x, z, angle, { width = 14, count = 12, rise = 0.42, run = 0.9, material } = {}) {
    const topY = this.terrainY(x, z) + 0.1;
    const g = steps({ width, count, rise, run });
    const mesh = this.#add(g, material ?? this.mats.stone, { name: 'ghat' });
    mesh.position.set(x, topY, z);
    mesh.rotation.y = angle;
    return mesh;
  }

  /** Concrete embankment wall with a promenade, railing and lamp posts. */
  embankment(points, { y = 1.6, width = 7, lampEvery = 26, railHeight = 1.05 } = {}) {
    const pts = smoothPolyline(points, 5);
    const walk = ribbon(pts, { width, y, uvScale: 0.12 });
    this.#add(walk, this.mats.concrete, { name: 'promenade' });

    // skirt down to the water
    const skirt = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const n = this.#normalAt(pts, i);
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.2;
      const ang = Math.atan2(z1 - z0, x1 - x0);
      const g = box(len, y + 2.6, 0.5, { y: -(y + 2.6) + y, centred: false });
      g.rotateY(-ang);
      g.translate((x0 + x1) / 2 + n[0] * width * 0.5, 0, (z0 + z1) / 2 + n[1] * width * 0.5);
      skirt.push(g);
    }
    this.#add(mergeGeometries(skirt), this.mats.concrete, { name: 'embankment' });

    const waterSide = pts.map(([x, z], i) => {
      const n = this.#normalAt(pts, i);
      return [x + n[0] * (width * 0.5 - 0.3), z + n[1] * (width * 0.5 - 0.3)];
    });
    this.#add(railing(waterSide, { height: railHeight, postEvery: 2.0, yFn: () => y }), this.mats.metal, {
      name: 'railing',
      shadow: false,
    });

    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc < lampEvery) continue;
      acc = 0;
      const n = this.#normalAt(pts, i);
      this.lamp(pts[i][0] + n[0] * (width * 0.5 - 1.1), pts[i][1] + n[1] * (width * 0.5 - 1.1), { y });
    }
    return this;
  }

  // ------------------------------------------------------------------- lights
  /** Twin-globe promenade lamp; the globes glow after dark. */
  lamp(x, z, { y, height = 4.6, globes = 2 } = {}) {
    const baseY = y ?? this.terrainY(x, z);
    if (!this._lampParts) {
      this._lampParts = { poles: [], globes: [] };
      this._lampGlassMat = this.mats.lampGlass.clone();
      this.night?.register(this._lampGlassMat, 2.6);
    }
    const parts = [
      cylinder(0.14, 0.1, 0.5, 10, { x, y: baseY, z }),
      cylinder(0.08, 0.06, height, 10, { x, y: baseY + 0.5, z }),
      cylinder(0.2, 0.05, 0.3, 10, { x, y: baseY + height * 0.52, z }),
    ];
    this._lampParts.poles.push(...parts);
    for (let i = 0; i < globes; i++) {
      const off = globes === 1 ? 0 : (i === 0 ? -1 : 1) * 0.55;
      const arm = box(Math.abs(off) + 0.1, 0.06, 0.06, { x: x + off / 2, y: baseY + height, z });
      this._lampParts.poles.push(arm);
      const g = new THREE.SphereGeometry(0.21, 12, 10);
      g.translate(x + off, baseY + height + 0.16, z);
      this._lampParts.globes.push(g);
    }
    return this;
  }

  /** Call once after all lamps are queued — merges them into two meshes. */
  commitLamps() {
    if (!this._lampParts) return this;
    this.#add(mergeGeometries(this._lampParts.poles), this.mats.darkMetal, {
      name: 'lamp-posts',
      shadow: true,
    });
    const globes = this.#add(mergeGeometries(this._lampParts.globes), this._lampGlassMat, {
      name: 'lamp-globes',
      shadow: false,
    });
    globes.castShadow = false;
    this._lampParts = null;
    return this;
  }

  // ----------------------------------------------------------------- buildings
  /**
   * City block. `style`: 'concrete' (walls+windows), 'glass' (IT tower),
   * 'oldTown' (plastered, flat roof, water tanks).
   */
  building(x, z, { w = 10, d = 10, h = 14, style = 'concrete', rotY = 0 } = {}) {
    const baseY = this.terrainY(x, z);
    const g = new THREE.Group();
    g.position.set(x, baseY, z);
    g.rotation.y = rotY;

    if (!this._facadeMat) {
      this._facadeMat = this.mats.facadeLit.clone();
      this._facadeMat.map = this.mats.facadeLit.map;
      this._facadeMat.emissiveMap = this.mats.facadeLit.emissiveMap;
      this.night?.register(this._facadeMat, 1.5);
    }

    if (style === 'glass') {
      const body = new THREE.Mesh(box(w, h, d), this.mats.glassTower);
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const crown = new THREE.Mesh(box(w * 0.7, h * 0.08, d * 0.7, { y: h }), this.mats.chrome);
      g.add(crown);
      const bands = [];
      for (let y = 2; y < h; y += 3.2) bands.push(box(w * 1.01, 0.12, d * 1.01, { y }));
      g.add(new THREE.Mesh(mergeGeometries(bands), this.mats.darkMetal));
    } else if (style === 'oldTown') {
      const body = new THREE.Mesh(box(w, h, d), this.mats.plaster);
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const parapet = new THREE.Mesh(box(w + 0.3, 0.6, d + 0.3, { y: h }), this.mats.plaster);
      g.add(parapet);
      const extras = [];
      for (let i = 0; i < 3; i++) {
        const tx = this.rng.float(-w * 0.3, w * 0.3);
        const tz = this.rng.float(-d * 0.3, d * 0.3);
        extras.push(cylinder(0.45, 0.45, 0.9, 10, { x: tx, y: h + 0.6, z: tz }));
      }
      g.add(new THREE.Mesh(mergeGeometries(extras), this.mats.flat(0x2b5f8a)));
      // window openings
      const wins = [];
      for (let y = 1.6; y < h - 1; y += 3) {
        for (let i = -1; i <= 1; i++) {
          wins.push(box(1.0, 1.4, 0.1, { x: i * (w * 0.28), y, z: d / 2 + 0.02 }));
          wins.push(box(0.1, 1.4, 1.0, { x: w / 2 + 0.02, y, z: i * (d * 0.28) }));
        }
      }
      g.add(new THREE.Mesh(mergeGeometries(wins), this._facadeMat));
    } else {
      const body = new THREE.Mesh(box(w, h, d), this._facadeMat);
      body.castShadow = body.receiveShadow = true;
      // facade texture tiles with size
      g.add(body);
      const roof = new THREE.Mesh(box(w + 0.4, 0.5, d + 0.4, { y: h }), this.mats.concrete);
      g.add(roof);
    }
    this.group.add(g);
    return g;
  }

  /** A whole skyline in one go, kept to two draw calls. */
  skyline(specs, { style = 'concrete' } = {}) {
    for (const s of specs) this.building(s.x, s.z, { ...s, style: s.style ?? style });
    return this;
  }

  // ------------------------------------------------------------------- nature
  /** Granite boulders — the signature Deccan outcrops. */
  boulders(placements, { material } = {}) {
    if (!placements.length) return this;
    const variants = [];
    for (let v = 0; v < 4; v++) {
      const g = new THREE.IcosahedronGeometry(1, 2);
      roughen(g, 0.34, 0.9, (x, y, z) => noise2(x + v * 3.1, y * 0.8 + v, z * 0.9));
      g.scale(1, this.rng.float(0.55, 0.9), this.rng.float(0.85, 1.2));
      g.computeVertexNormals();
      variants.push(g);
    }
    const mat = material ?? this.mats.granite;
    const buckets = variants.map(() => []);
    placements.forEach((p, i) => buckets[i % variants.length].push(p));

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const pv = new THREE.Vector3();
    buckets.forEach((list, vi) => {
      if (!list.length) return;
      const inst = new THREE.InstancedMesh(variants[vi], mat, list.length);
      inst.castShadow = inst.receiveShadow = true;
      inst.name = 'boulders';
      list.forEach((p, i) => {
        const scale = p.scale ?? this.rng.float(1.2, 4.2);
        const y = p.y ?? this.terrainY(p.x, p.z) - scale * 0.32;
        pv.set(p.x, y, p.z);
        e.set(this.rng.float(-0.25, 0.25), this.rng.float(0, TAU), this.rng.float(-0.25, 0.25));
        q.setFromEuler(e);
        s.set(scale, scale * this.rng.float(0.7, 1.1), scale);
        m4.compose(pv, q, s);
        inst.setMatrixAt(i, m4);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    });
    return this;
  }

  /** Water buffalo wallowing in the shallows. */
  buffalo(x, z, angle = 0, { wallow = true } = {}) {
    const dark = this.mats.flat(0x2e2a28, { roughness: 0.85 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10), dark);
    body.scale.set(0.72, 0.62, 1.25);
    body.position.y = 1.0;
    const neck = new THREE.Mesh(box(0.5, 0.45, 0.7, { y: 1.05, z: 1.0 }), dark);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 9), dark);
    head.scale.set(0.8, 0.8, 1.25);
    head.position.set(0, 1.12, 1.6);
    const snout = new THREE.Mesh(box(0.26, 0.22, 0.3, { y: 1.02, z: 1.92 }), this.mats.flat(0x4a4340));
    g.add(body, neck, head, snout);
    for (const sign of [-1, 1]) {
      const horn = new THREE.Mesh(
        tube(
          [
            new THREE.Vector3(sign * 0.22, 1.36, 1.5),
            new THREE.Vector3(sign * 0.6, 1.5, 1.42),
            new THREE.Vector3(sign * 0.78, 1.34, 1.16),
          ],
          0.055,
          6
        ),
        this.mats.flat(0x8d8477)
      );
      g.add(horn);
      for (const z0 of [0.75, -0.7]) {
        const leg = new THREE.Mesh(cylinder(0.12, 0.1, 0.95, 7, { x: sign * 0.42, z: z0 }), dark);
        g.add(leg);
      }
    }
    const tail = new THREE.Mesh(cylinder(0.05, 0.03, 0.8, 6, { y: 1.1, z: -1.25 }), dark);
    tail.rotation.x = -0.4;
    g.add(tail);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    const groundY = this.terrainY(x, z);
    const sink = wallow ? Math.min(0.55, Math.max(0, this.water.level - groundY) * 0.8) : 0;
    g.position.set(x, groundY - sink, z);
    g.rotation.y = angle;
    this.group.add(g);

    // lazy head swing
    const phase = this.rng.float(0, TAU);
    this.updaters.push((dt, t) => {
      head.rotation.y = Math.sin(t * 0.4 + phase) * 0.22;
      tail.rotation.z = Math.sin(t * 1.8 + phase) * 0.3;
    });
    return g;
  }

  /** Egret / heron standing in the shallows. */
  egret(x, z, { angle = 0, scale = 1 } = {}) {
    const white = this.mats.flat(0xf2f2ec, { roughness: 0.7 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 9), white);
    body.scale.set(0.7, 0.8, 1.3);
    body.position.y = 0.52;
    const neck = new THREE.Mesh(
      tube(
        [
          new THREE.Vector3(0, 0.56, 0.1),
          new THREE.Vector3(0, 0.78, 0.2),
          new THREE.Vector3(0, 0.92, 0.1),
          new THREE.Vector3(0, 0.95, 0.22),
        ],
        0.035,
        6
      ),
      white
    );
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), white);
    head.position.set(0, 0.97, 0.24);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.2, 7), this.mats.flat(0xe3b04b));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.96, 0.38);
    g.add(body, neck, head, beak);
    for (const sign of [-1, 1]) {
      const leg = new THREE.Mesh(cylinder(0.018, 0.016, 0.5, 5, { x: sign * 0.06 }), this.mats.flat(0x2c2c2c));
      g.add(leg);
    }
    g.scale.setScalar(scale);
    const groundY = this.terrainY(x, z);
    g.position.set(x, Math.max(groundY, this.water.level - 0.42), z);
    g.rotation.y = angle;
    g.traverse((o) => (o.isMesh ? (o.castShadow = true) : null));
    this.group.add(g);
    const phase = this.rng.float(0, TAU);
    this.updaters.push((dt, t) => {
      head.position.y = 0.97 + Math.sin(t * 0.8 + phase) * 0.06;
      g.rotation.y = angle + Math.sin(t * 0.25 + phase) * 0.4;
    });
    return g;
  }

  /** A flock that wheels overhead — cheap, but it makes the sky feel alive. */
  birdFlock({ cx = 0, cz = 0, radius = 90, count = 14, height = 34, speed = 0.12 } = {}) {
    const mat = this.mats.flat(0x2d2f33, { roughness: 0.9 });
    const birds = [];
    const flock = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), mat);
      body.scale.set(0.5, 0.5, 1.6);
      b.add(body);
      const wings = [];
      for (const sign of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), mat);
        w.geometry.translate(sign * 0.45, 0, 0);
        w.rotation.x = -Math.PI / 2;
        b.add(w);
        wings.push(w);
      }
      b.userData = {
        wings,
        phase: this.rng.float(0, TAU),
        r: radius * this.rng.float(0.5, 1.15),
        y: height + this.rng.float(-8, 10),
        flap: this.rng.float(5.5, 8.5),
        dir: this.rng.next() < 0.5 ? 1 : -1,
      };
      flock.add(b);
      birds.push(b);
    }
    this.group.add(flock);
    this.updaters.push((dt, t) => {
      for (const b of birds) {
        const u = b.userData;
        const a = u.phase + t * speed * u.dir;
        const x = cx + Math.cos(a) * u.r;
        const z = cz + Math.sin(a) * u.r * 0.8;
        b.position.set(x, u.y + Math.sin(t * 0.5 + u.phase) * 1.6, z);
        b.rotation.y = -a * u.dir + (u.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        b.rotation.z = u.dir * 0.25;
        const flap = Math.sin(t * u.flap + u.phase);
        u.wings[0].rotation.y = flap * 0.5;
        u.wings[1].rotation.y = -flap * 0.5;
      }
    });
    return flock;
  }

  // -------------------------------------------------------------- water life
  /** Moored / drifting boats. `drift` makes them bob and swing on the waves. */
  ambientBoat(kind, x, z, angle = 0, { drift = true, scale = 1 } = {}) {
    const build = BOAT_BUILDERS[kind] ?? BOAT_BUILDERS.country;
    const { group, spec } = build({ mats: this.mats, night: this.night });
    group.scale.setScalar(scale);
    const holder = new THREE.Group();
    holder.rotation.order = 'YXZ';
    holder.add(group);
    holder.position.set(x, this.water.level, z);
    holder.rotation.y = angle;
    this.group.add(holder);

    if (drift) {
      const halfL = spec.length * 0.45 * scale;
      const halfB = spec.beam * 0.95 * scale;
      const swing = this.rng.float(0.1, 0.3);
      const phase = this.rng.float(0, TAU);
      const w = this.water;
      this.updaters.push((dt, t) => {
        const h = Math.sin(angle);
        const c = Math.cos(angle);
        const hBow = w.heightAt(x + h * halfL, z + c * halfL);
        const hStern = w.heightAt(x - h * halfL, z - c * halfL);
        const hPort = w.heightAt(x - c * halfB, z + h * halfB);
        const hStbd = w.heightAt(x + c * halfB, z - h * halfB);
        holder.position.y = (hBow + hStern + hPort + hStbd) * 0.25 + 0.02;
        holder.rotation.x = -Math.atan2(hBow - hStern, halfL * 2);
        holder.rotation.z = Math.atan2(hStbd - hPort, halfB * 2);
        holder.rotation.y = angle + Math.sin(t * 0.21 + phase) * swing;
      });
    }
    return holder;
  }

  /** Marker buoy that bobs on the swell. */
  buoy(x, z, { color = 0xe8552c, light = true } = {}) {
    const g = new THREE.Group();
    const bodyMat = this.mats.flat(color, { roughness: 0.55 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.9, 12), bodyMat);
    body.position.y = 0.2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.5, 12), bodyMat);
    cone.position.y = 0.85;
    const mast = new THREE.Mesh(cylinder(0.04, 0.03, 0.8, 6, { y: 1.0 }), this.mats.darkMetal);
    g.add(body, cone, mast);
    if (light) {
      const lampMat = new THREE.MeshStandardMaterial({
        color: 0xffd27a,
        emissive: 0xffb347,
        emissiveIntensity: 0,
        roughness: 0.4,
      });
      this.night?.register(lampMat, 3.2);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), lampMat);
      lamp.position.y = 1.82;
      g.add(lamp);
    }
    g.traverse((o) => (o.isMesh ? (o.castShadow = true) : null));
    g.position.set(x, this.water.level, z);
    this.group.add(g);
    const w = this.water;
    const s = { normal: new THREE.Vector3(), height: 0, slopeX: 0, slopeZ: 0 };
    this.updaters.push(() => {
      w.sample(x, z, s);
      g.position.y = s.height;
      g.rotation.x = Math.atan2(s.normal.z, s.normal.y) * 0.8;
      g.rotation.z = -Math.atan2(s.normal.x, s.normal.y) * 0.8;
    });
    return g;
  }

  /** Fixed fishing net on bamboo poles, and a few floats. */
  fishingNet(x, z, angle = 0, { size = 5 } = {}) {
    const bamboo = this.mats.flat(0xc0a467, { roughness: 0.9 });
    const g = new THREE.Group();
    const poles = [];
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const a = angle + (i / 4) * TAU;
      const px = Math.cos(a) * size * 0.5;
      const pz = Math.sin(a) * size * 0.5;
      const groundY = this.terrainY(x + px, z + pz);
      const top = this.water.level + 2.4;
      poles.push(cylinder(0.07, 0.05, top - groundY, 6, { x: px, y: groundY - this.water.level, z: pz }));
      pts.push(new THREE.Vector3(px, 2.1, pz));
    }
    g.add(new THREE.Mesh(mergeGeometries(poles), bamboo));
    const netMat = new THREE.MeshStandardMaterial({
      color: 0xd8d2bf,
      wireframe: true,
      roughness: 0.9,
      transparent: true,
      opacity: 0.55,
    });
    const net = new THREE.Mesh(new THREE.SphereGeometry(size * 0.46, 10, 6, 0, TAU, 0, Math.PI / 2), netMat);
    net.rotation.x = Math.PI;
    net.position.y = 2.0;
    g.add(net);
    g.position.set(x, this.water.level, z);
    g.traverse((o) => (o.isMesh ? (o.castShadow = true) : null));
    this.group.add(g);
    return g;
  }

  /** Plastic bottles and litter — unglamorous, but it's what floats here. */
  floatingLitter({ area, count = 60 } = {}) {
    const items = [];
    for (let i = 0; i < count; i++) {
      let x, z;
      for (let t = 0; t < 30; t++) {
        x = this.rng.float(area.minX, area.maxX);
        z = this.rng.float(area.minZ, area.maxZ);
        if (this.terrain.depth(x, z) > 0.6) break;
      }
      items.push({ x, z, s: this.rng.float(0.5, 1.2) });
    }
    const geoms = [
      new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6).rotateX(Math.PI / 2),
      box(0.18, 0.04, 0.12),
      new THREE.SphereGeometry(0.07, 6, 5),
    ];
    const mats = [
      this.mats.flat(0xdce9ec, { roughness: 0.3 }),
      this.mats.flat(0xdedad0, { roughness: 0.8 }),
      this.mats.flat(0xc96a5a, { roughness: 0.6 }),
    ];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sv = new THREE.Vector3();
    const pv = new THREE.Vector3();
    geoms.forEach((geom, gi) => {
      const list = items.filter((_, i) => i % geoms.length === gi);
      if (!list.length) return;
      const mat = mats[gi];
      makeFloating(mat, this.water, { bobScale: 1, tilt: 0.6 });
      const inst = new THREE.InstancedMesh(geom, mat, list.length);
      inst.castShadow = false;
      list.forEach((it, i) => {
        pv.set(it.x, this.water.level + 0.03, it.z);
        e.set(0, this.rng.float(0, TAU), 0);
        q.setFromEuler(e);
        sv.setScalar(it.s);
        m4.compose(pv, q, sv);
        inst.setMatrixAt(i, m4);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    });
    return this;
  }

  // ------------------------------------------------------------------ street
  /** Cars running along a road path; headlights and tail-lights at night. */
  traffic(points, { count = 10, speed = 11, y, lanes = 2, laneWidth = 3.2 } = {}) {
    const path = smoothPolyline(points, 6);
    const curve = new THREE.CatmullRomCurve3(
      path.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'catmullrom',
      0.5
    );
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfff4d8,
      emissive: 0xfff0c0,
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x8b1d1d,
      emissive: 0xff2d2d,
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    this.night?.register(headMat, 4);
    this.night?.register(tailMat, 2.4);

    const cars = [];
    const colors = [0xd8d8d8, 0x2b2b2b, 0xb23b3b, 0x27415e, 0xe0e0cf, 0x6a6a6a];
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const isBus = this.rng.next() < 0.18;
      const w = isBus ? 2.5 : 1.8;
      const h = isBus ? 3.0 : 1.35;
      const len = isBus ? 9 : 4.3;
      const colour = isBus ? 0xdb7a2a : this.rng.pick(colors);
      const body = new THREE.Mesh(box(w, h * 0.62, len), this.mats.flat(colour, { roughness: 0.4, metalness: 0.3 }));
      g.add(body);
      if (!isBus) {
        const cab = new THREE.Mesh(box(w * 0.9, h * 0.42, len * 0.5, { y: h * 0.62 }), this.mats.glass);
        g.add(cab);
      } else {
        const strip = new THREE.Mesh(box(w * 1.01, 0.8, len * 0.92, { y: h * 0.62 }), this.mats.glass);
        g.add(strip);
      }
      for (const sign of [-1, 1]) {
        const hl = new THREE.Mesh(box(0.3, 0.18, 0.08), headMat);
        hl.position.set(sign * w * 0.32, h * 0.3, len / 2);
        const tl = new THREE.Mesh(box(0.3, 0.14, 0.08), tailMat);
        tl.position.set(sign * w * 0.32, h * 0.3, -len / 2);
        g.add(hl, tl);
      }
      g.traverse((o) => (o.isMesh ? (o.castShadow = true) : null));
      const lane = i % lanes;
      cars.push({
        obj: g,
        t: this.rng.float(0, 1),
        dir: lane === 0 ? 1 : -1,
        lane: (lane - (lanes - 1) / 2) * laneWidth,
        speed: speed * this.rng.float(0.8, 1.25),
      });
      this.group.add(g);
    }

    const total = curve.getLength();
    const pos = new THREE.Vector3();
    const tan = new THREE.Vector3();
    this.updaters.push((dt) => {
      for (const car of cars) {
        car.t += (car.dir * car.speed * dt) / total;
        if (car.t > 1) car.t -= 1;
        if (car.t < 0) car.t += 1;
        curve.getPointAt(car.t, pos);
        curve.getTangentAt(car.t, tan);
        const nx = -tan.z;
        const nz = tan.x;
        const roadY = y ?? this.terrainY(pos.x, pos.z) + 0.3;
        car.obj.position.set(pos.x + nx * car.lane, roadY, pos.z + nz * car.lane);
        car.obj.rotation.y = Math.atan2(tan.x, tan.z) + (car.dir > 0 ? 0 : Math.PI);
      }
    });
    return this;
  }

  /** Road surface + markings following a path. */
  road(points, { width = 9, y } = {}) {
    const pts = smoothPolyline(points, 6);
    const surface = ribbon(pts, {
      width,
      yFn: y !== undefined ? () => y : (x, z) => this.terrainY(x, z) + 0.28,
      uvScale: 0.08,
    });
    const mesh = this.#add(surface, this.mats.flat(0x2e3033, { roughness: 0.85 }), { name: 'road' });
    mesh.receiveShadow = true;
    return mesh;
  }

  // ------------------------------------------------------------- small places
  /** Whitewashed shrine with a shikhara and a saffron flag. */
  temple(x, z, { scale = 1, rotY = 0 } = {}) {
    const g = new THREE.Group();
    const baseY = this.terrainY(x, z);
    g.position.set(x, baseY, z);
    g.rotation.y = rotY;
    g.scale.setScalar(scale);
    const plinth = new THREE.Mesh(box(6, 0.8, 6), this.mats.stone);
    const hall = new THREE.Mesh(box(4.4, 3.2, 4.4, { y: 0.8 }), this.mats.whitewash);
    const tower = new THREE.Mesh(shikhara({ base: 3.0, height: 6.5, tiers: 6 }), this.mats.whitewash);
    tower.position.y = 4.0;
    const door = new THREE.Mesh(box(1.2, 2.0, 0.2, { y: 0.8, z: 2.2 }), this.mats.flat(0x6b3a22));
    const pole = new THREE.Mesh(cylinder(0.06, 0.05, 3, 6, { y: 10.4 }), this.mats.chrome);
    const flag = new THREE.Mesh(box(1.1, 0.7, 0.03, { x: 0.55, y: 12.6 }), this.mats.saffron);
    g.add(plinth, hall, tower, door, pole, flag);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(g);
    this.updaters.push((dt, t) => {
      flag.rotation.y = Math.sin(t * 2.2) * 0.3;
    });
    return g;
  }

  /** Open pavilion / viewing platform (People's Plaza style). */
  pavilion(x, z, { radius = 6, columns = 8, height = 4.2, rotY = 0 } = {}) {
    const g = new THREE.Group();
    g.position.set(x, this.terrainY(x, z), z);
    g.rotation.y = rotY;
    const parts = [cylinder(radius + 0.6, radius + 0.4, 0.5, 24)];
    for (let i = 0; i < columns; i++) {
      const a = (i / columns) * TAU;
      parts.push(cylinder(0.26, 0.22, height, 10, { x: Math.cos(a) * radius, y: 0.5, z: Math.sin(a) * radius }));
    }
    parts.push(cylinder(radius + 0.5, radius + 0.5, 0.4, 24, { y: height + 0.5 }));
    g.add(new THREE.Mesh(mergeGeometries(parts), this.mats.stone));
    const dome = new THREE.Mesh(onionDome(radius * 0.95, radius * 1.1, 24), this.mats.whitewash);
    dome.position.y = height + 0.9;
    g.add(dome);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(g);
    return g;
  }

  /** Statue on a plinth — Tank Bund has a row of them. */
  statue(x, z, { scale = 1, rotY = 0 } = {}) {
    const g = new THREE.Group();
    g.position.set(x, this.terrainY(x, z), z);
    g.rotation.y = rotY;
    g.scale.setScalar(scale);
    const plinth = new THREE.Mesh(box(1.8, 2.4, 1.8), this.mats.stone);
    const figureMat = this.mats.flat(0x6f7378, { roughness: 0.6, metalness: 0.35 });
    const body = new THREE.Mesh(cylinder(0.38, 0.3, 1.5, 12, { y: 2.4 }), figureMat);
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 12), figureMat);
    robe.position.y = 3.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), figureMat);
    head.position.y = 4.1;
    const arm = new THREE.Mesh(cylinder(0.09, 0.08, 1.0, 8), figureMat);
    arm.rotation.z = -1.1;
    arm.position.set(0.3, 3.5, 0.1);
    g.add(plinth, body, robe, head, arm);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(g);
    return g;
  }

  /** Laundry strung on lines between poles — the Musi dhobi ghat. */
  laundryLines(points, { height = 3.2, spans = 3 } = {}) {
    const poles = [];
    const sheets = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, z0] = points[i];
      const [x1, z1] = points[i + 1];
      const y0 = this.terrainY(x0, z0);
      const y1 = this.terrainY(x1, z1);
      poles.push(cylinder(0.08, 0.06, height, 6, { x: x0, y: y0, z: z0 }));
      const line = catenaryPoints(
        new THREE.Vector3(x0, y0 + height, z0),
        new THREE.Vector3(x1, y1 + height, z1),
        0.45,
        10
      );
      poles.push(tube(line, 0.015, 4));
      for (let s = 1; s <= spans; s++) {
        const t = s / (spans + 1);
        const p = line[Math.round(t * (line.length - 1))];
        const w = this.rng.float(0.7, 1.4);
        const h = this.rng.float(0.8, 1.7);
        const g = box(w, h, 0.02, { x: p.x, y: p.y - h, z: p.z });
        sheets.push(g);
      }
    }
    const last = points[points.length - 1];
    poles.push(cylinder(0.08, 0.06, height, 6, { x: last[0], y: this.terrainY(last[0], last[1]), z: last[1] }));
    this.#add(mergeGeometries(poles), this.mats.flat(0x8d7a5e), { name: 'laundry-poles' });
    const clothMesh = this.#add(mergeGeometries(sheets), this.mats.cloth, { name: 'laundry' });
    clothMesh.material.side = THREE.DoubleSide;
    return this;
  }

  /** Mooring posts with ropes, and a couple of coracles pulled up the bank. */
  mooring(x, z, angle = 0) {
    const g = new THREE.Group();
    const y = this.terrainY(x, z);
    g.position.set(x, y, z);
    g.rotation.y = angle;
    const posts = [];
    for (const dx of [-1.2, 1.2]) posts.push(cylinder(0.14, 0.12, 1.1, 8, { x: dx }));
    g.add(new THREE.Mesh(mergeGeometries(posts), this.mats.darkPlanks));
    const rope = new THREE.Mesh(
      tube(catenaryPoints(new THREE.Vector3(-1.2, 1.0, 0), new THREE.Vector3(1.2, 1.0, 0), 0.4, 12), 0.03, 5),
      this.mats.flat(0xcdb98f)
    );
    g.add(rope);
    g.traverse((o) => (o.isMesh ? (o.castShadow = true) : null));
    this.group.add(g);
    return g;
  }

  /** Low parapet / compound wall along a path. */
  wall(points, { height = 1.1, thickness = 0.4, material } = {}) {
    const pts = smoothPolyline(points, 4);
    const parts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.05;
      const ang = Math.atan2(z1 - z0, x1 - x0);
      const y = (this.terrainY(x0, z0) + this.terrainY(x1, z1)) / 2;
      const g = box(len, height, thickness, { centred: false });
      g.rotateY(-ang);
      g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      parts.push(g);
    }
    this.#add(mergeGeometries(parts), material ?? this.mats.concrete, { name: 'wall' });
    return this;
  }
}
