import * as THREE from 'three';
import { fbm, noise2, smoothstep, clamp, TAU, lerp } from '../utils.js';
import { scatter } from '../foliage.js';
import { box, cylinder, mergeGeometries } from '../geom.js';

/**
 * A village tank on the outskirts — the kind of pond every Telangana village
 * keeps for its buffalo and its paddy. Glassy water, lotus beds, an earthen
 * bund with a sluice, and a patchwork of fields all around.
 */

const POND = { x: 8, z: -6 };

function pondRadius(a, x, z) {
  return (
    94 +
    17 * Math.sin(a * 2.2 + 0.7) +
    11 * Math.cos(a * 3.1 - 0.4) +
    7 * Math.sin(a * 5.3 + 1.9) +
    9 * fbm(x * 0.006, z * 0.006, 2)
  );
}

function hutGeometry() {
  const walls = box(4.4, 2.4, 3.6);
  const door = box(1.0, 1.8, 0.2, { z: 1.85 });
  return { walls: mergeGeometries([walls]), door };
}

export const villagePond = {
  id: 'village-pond',
  name: 'Village tank',
  region: 'Shamirpet outskirts',
  blurb:
    'A village cheruvu: lotus beds, buffalo in the shallows, an earthen bund and paddy to the horizon. Flat calm — bring the rowing boat.',
  sky: 'morning',
  defaultBoat: 'country',
  terrain: {
    size: 760,
    segments: 420,
    depthScale: 8,
    layers: [
      { set: 'mud', scale: 4, tint: 0x6b5f44 },
      { set: 'mud', scale: 3, tint: 0x8a7a58, bandTop: 0.9 },
      { set: 'scrub', scale: 6, tint: 0x8f9361, blend: 1.6, macro: 0.55 },
      { set: 'laterite', scale: 6, tint: 0xa57f5c, slopeStart: 0.34, slopeFull: 0.7 },
    ],
  },
  water: {
    level: 0,
    deepColor: 0x1f3326,
    shallowColor: 0x56613a,
    foamColor: 0xe4e8da,
    foamWidth: 1.2,
    murk: 0.95,
    shoreAlpha: 0.55,
    size: 6.5,
    waveScale: 0.3,
    waves: [
      [1, 0.25, 0.035, 7.5],
      [0.7, 0.72, 0.028, 4.4],
      [-0.65, 0.76, 0.018, 2.6],
      [0.2, -0.98, 0.012, 1.5],
    ],
  },
  ambience: { traffic: 0.05, birds: 1.0, cicadas: 0.6, temple: 0.5, wind: 0.2, lapping: 0.35 },
  spawn: { x: 8, z: 40, heading: Math.PI },

  height(x, z) {
    const dx = x - POND.x;
    const dz = z - POND.z;
    const r = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx);
    const shore = pondRadius(a, x, z);

    let h;
    if (r < shore) {
      const t = r / shore;
      h = -3.1 * Math.pow(1 - t * t, 0.8) + fbm(x * 0.02, z * 0.02, 3) * 0.22;
      // a shallow shelf on the north side where the lotus grows
      h += smoothstep(0.35, 1.0, (dz + shore * 0.3) / shore) * 1.5;
    } else {
      const d = r - shore;
      h = 0.55 * Math.pow(d, 0.5) + fbm(x * 0.01, z * 0.01, 3) * 0.5;

      // paddy patchwork: each field flat, with a low bund between
      const cell = 56;
      const fx = Math.floor((x + 1000) / cell);
      const fz = Math.floor((z + 1000) / cell);
      const fieldH = 1.1 + (noise2(fx * 7.3, fz * 3.1) * 0.5 + 0.5) * 0.95;
      const gx = Math.abs(((x + 1000) % cell) - cell / 2);
      const gz = Math.abs(((z + 1000) % cell) - cell / 2);
      const bund = (1 - smoothstep(0, 2.2, Math.min(cell / 2 - gx, cell / 2 - gz))) * 0.42;
      h = lerp(h, fieldH + bund, smoothstep(12, 48, d) * 0.85);

      // low hills at the horizon
      h += smoothstep(180, 360, d) * (5 + fbm(x * 0.004, z * 0.004, 3) * 10);
    }

    // earthen bund across the south side, with a dip for the sluice
    const bundZ = 118;
    const bundDist = Math.abs(z - bundZ);
    const sluice = smoothstep(16, 3, Math.abs(x - 36));
    const bundH = 4.2 - sluice * 3.0;
    h = lerp(h, bundH, (1 - smoothstep(6, 20, bundDist)) * 0.95);

    return h;
  },

  build(ctx) {
    const { props, foliage, rng, addPOI, terrain, mats, group } = ctx;

    // --------------------------------------------------------- the bund
    props.road(
      [
        [-170, 118],
        [-60, 116],
        [40, 119],
        [150, 117],
      ],
      { width: 5.5 }
    );
    addPOI({
      name: 'The bund',
      x: 36,
      z: 118,
      y: 4,
      radius: 70,
      text: 'Earth bund with a stone sluice — open it in June and the tank waters the paddy below.',
    });
    // sluice gate structure
    const sluiceGroup = new THREE.Group();
    const sy = terrain.height(36, 112);
    sluiceGroup.position.set(36, sy, 112);
    const piers = [];
    for (const sx of [-2.2, 2.2]) piers.push(box(1.2, 3.4, 3.0, { x: sx }));
    piers.push(box(5.6, 0.7, 3.0, { y: 3.4 }));
    sluiceGroup.add(new THREE.Mesh(mergeGeometries(piers), mats.stone));
    const gate = new THREE.Mesh(box(3.2, 2.4, 0.25, { y: 0.4 }), mats.rust);
    sluiceGroup.add(gate);
    sluiceGroup.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(sluiceGroup);

    // ------------------------------------------------------------- temple
    props.temple(-54, 104, { scale: 0.85, rotY: 0.3 });
    addPOI({
      name: 'Tank temple',
      x: -54,
      z: 104,
      y: 6,
      radius: 60,
      text: 'A shrine on the bund, as there always is. The bell carries right across the water.',
    });

    // washing steps + mooring
    props.ghat(-16, -108, Math.PI, { width: 12, count: 8, rise: 0.36, run: 0.9 });
    props.ghat(70, 86, 0.2, { width: 9, count: 7, rise: 0.34, run: 0.85 });
    props.mooring(-14, -98, 0.2);
    props.ambientBoat('country', -20, -88, 1.9, { scale: 0.95 });
    props.ambientBoat('country', 86, 70, -1.2, { scale: 0.9 });
    addPOI({
      name: 'Washing steps',
      x: -16,
      z: -108,
      y: 1,
      radius: 55,
      text: 'Stone steps worn smooth. Clothes in the morning, buffalo in the afternoon.',
    });

    // ------------------------------------------------------- village huts
    const hut = hutGeometry();
    const hutWalls = [];
    const thatch = [];
    for (let i = 0; i < 16; i++) {
      const a = rng.float(0, TAU);
      const r = rng.float(150, 260);
      const hx = POND.x + Math.cos(a) * r;
      const hz = POND.z + Math.sin(a) * r;
      const hy = terrain.height(hx, hz);
      if (hy < 0.8) continue;
      const rot = rng.float(0, TAU);
      const w = hut.walls.clone();
      w.rotateY(rot);
      w.translate(hx, hy, hz);
      hutWalls.push(w);
      const roof = new THREE.ConeGeometry(3.9, 2.2, 4);
      roof.rotateY(rot + Math.PI / 4);
      roof.translate(hx, hy + 3.5, hz);
      thatch.push(roof);
    }
    if (hutWalls.length) {
      const wallMesh = new THREE.Mesh(mergeGeometries(hutWalls), mats.whitewash);
      wallMesh.castShadow = wallMesh.receiveShadow = true;
      group.add(wallMesh);
      const roofMesh = new THREE.Mesh(
        mergeGeometries(thatch),
        mats.flat(0xa08457, { roughness: 0.95 })
      );
      roofMesh.castShadow = roofMesh.receiveShadow = true;
      group.add(roofMesh);
    }

    // haystacks and a well
    const stacks = [];
    for (let i = 0; i < 9; i++) {
      const a = rng.float(0, TAU);
      const r = rng.float(140, 250);
      const sx = POND.x + Math.cos(a) * r;
      const sz = POND.z + Math.sin(a) * r;
      const syy = terrain.height(sx, sz);
      if (syy < 0.8) continue;
      const g = new THREE.ConeGeometry(rng.float(1.6, 2.6), rng.float(2.6, 4.2), 9);
      g.translate(sx, syy + 1.4, sz);
      stacks.push(g);
    }
    if (stacks.length) {
      const m = new THREE.Mesh(mergeGeometries(stacks), mats.flat(0xc9a55e, { roughness: 1 }));
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    const wellY = terrain.height(-120, 150);
    const well = new THREE.Mesh(
      mergeGeometries([
        cylinder(2.2, 2.2, 1.2, 18, { open: true }),
        cylinder(2.4, 2.4, 0.3, 18),
      ]),
      mats.stone
    );
    well.position.set(-120, wellY, 150);
    well.castShadow = well.receiveShadow = true;
    group.add(well);

    // ------------------------------------------------------- pond planting
    // lotus bed on the northern shelf
    for (let i = 0; i < 260; i++) {
      const a = rng.float(0, TAU);
      const r = rng.float(10, 95);
      const x = POND.x + Math.cos(a) * r;
      const z = POND.z + Math.sin(a) * r;
      const depth = terrain.depth(x, z);
      if (depth < 0.25 || depth > 1.8) continue;
      foliage.add('lilypad', x, z, { scale: rng.float(0.7, 1.5) });
      if (rng.next() < 0.45) foliage.add('lotus', x + rng.float(-1, 1), z + rng.float(-1, 1), { scale: rng.float(0.9, 1.6) });
    }
    for (let i = 0; i < 70; i++) {
      const a = rng.float(0, TAU);
      const r = rng.float(20, 80);
      const x = POND.x + Math.cos(a) * r;
      const z = POND.z + Math.sin(a) * r;
      if (terrain.depth(x, z) < 1.2) continue;
      foliage.add('hyacinth', x, z, { scale: rng.float(0.7, 1.4) });
    }

    // reeds right around the waterline, tall grass on the banks
    for (const p of scatter(terrain, rng, {
      count: 700,
      area: { cx: POND.x, cz: POND.z, radius: 150 },
      minHeight: -0.8,
      maxHeight: 0.5,
    }))
      foliage.add('reeds', p.x, p.z, { scale: rng.float(0.8, 1.6) });
    for (const p of scatter(terrain, rng, {
      count: 900,
      area: { minX: -340, maxX: 340, minZ: -340, maxZ: 340 },
      minHeight: 0.4,
      maxHeight: 12,
      maxSlope: 0.7,
    }))
      foliage.add('tallgrass', p.x, p.z, { scale: rng.float(0.8, 1.7) });

    // trees: palms and a big banyan by the steps
    foliage.add('banyan', -36, -112, { scale: 1.35 });
    foliage.add('banyan', 120, 96, { scale: 1.1 });
    for (const p of scatter(terrain, rng, {
      count: 160,
      area: { minX: -340, maxX: 340, minZ: -340, maxZ: 340 },
      minHeight: 0.7,
      maxHeight: 14,
      maxSlope: 0.5,
    })) {
      const roll = rng.next();
      foliage.add(roll < 0.45 ? 'palm' : roll < 0.7 ? 'neem' : roll < 0.9 ? 'gulmohar' : 'banyan', p.x, p.z, {
        scale: rng.float(0.8, 1.2),
      });
    }
    for (const p of scatter(terrain, rng, {
      count: 420,
      area: { minX: -340, maxX: 340, minZ: -340, maxZ: 340 },
      minHeight: 0.5,
      maxHeight: 14,
      maxSlope: 0.7,
    }))
      foliage.add('scrub', p.x, p.z, { scale: rng.float(0.8, 1.5) });

    // -------------------------------------------------------------- animals
    for (let i = 0; i < 8; i++) {
      const a = rng.float(-2.4, 0.6);
      const r = pondRadius(a, 0, 0) * rng.float(0.86, 1.0);
      const bxx = POND.x + Math.cos(a) * r;
      const bzz = POND.z + Math.sin(a) * r;
      props.buffalo(bxx, bzz, rng.float(0, TAU));
    }
    for (const p of scatter(terrain, rng, {
      count: 16,
      area: { cx: POND.x, cz: POND.z, radius: 140 },
      minDepth: 0.02,
      maxDepth: 0.45,
    }))
      props.egret(p.x, p.z, { angle: rng.float(0, TAU), scale: rng.float(0.9, 1.3) });
    props.birdFlock({ cx: POND.x, cz: POND.z, radius: 80, count: 10, height: 26, speed: 0.12 });
    props.birdFlock({ cx: POND.x - 120, cz: POND.z + 90, radius: 50, count: 7, height: 16, speed: 0.17 });

    for (const [bx2, bz2] of [
      [-60, -40],
      [60, 30],
    ])
      props.buoy(bx2, bz2, { color: 0xffd166, light: true });

    props.commitLamps();

    addPOI({
      name: 'Middle of the tank',
      x: POND.x,
      z: POND.z,
      y: 0,
      radius: 60,
      text: 'Three metres deep in the middle, and still as a mirror before the breeze picks up.',
    });
  },
};
