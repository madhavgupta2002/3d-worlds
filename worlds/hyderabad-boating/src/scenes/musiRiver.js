import * as THREE from 'three';
import { fbm, ridged, smoothstep, clamp, TAU, lerp } from '../utils.js';
import { scatter } from '../foliage.js';
import { stoneBridge, charminar, mosque } from '../landmarks.js';

/**
 * The Musi, running through the old city. A narrow channel with a real
 * current, sandbars to dodge, stone ghats and Purana Pul's arches, with the
 * Charminar and Mecca Masjid standing over the south bank.
 */

/** Centre-line of the channel: z as a function of x. */
function centreZ(x) {
  return 58 * Math.sin(x * 0.0038) + 26 * Math.sin(x * 0.0105 + 1.2);
}
function halfWidth(x) {
  return 36 + 9 * Math.sin(x * 0.0062 + 0.4) + 5 * Math.sin(x * 0.017);
}

export const musiRiver = {
  id: 'musi-river',
  name: 'River Musi',
  region: 'Purana Pul, Old City',
  blurb:
    'The old city river: a current that pushes you downstream, shifting sandbars, washing on the ghats and the Charminar above the south bank.',
  sky: 'sunset',
  defaultBoat: 'country',
  terrain: {
    size: 1700,
    segments: 460,
    depthScale: 12,
    layers: [
      { set: 'mud', scale: 5, tint: 0x6a5f44 },
      { set: 'sand', scale: 4, tint: 0xa08f6d, bandTop: 1.0 },
      { set: 'laterite', scale: 7, tint: 0xa2825f, blend: 2.0, macro: 0.45 },
      { set: 'sandstone', scale: 8, tint: 0xa89275, slopeStart: 0.3, slopeFull: 0.66 },
    ],
  },
  water: {
    level: 0,
    deepColor: 0x23301f,
    shallowColor: 0x5b5531,
    foamColor: 0xdfe0cf,
    foamWidth: 1.9,
    murk: 0.92,
    shoreAlpha: 0.62,
    size: 5.4,
    waveScale: 0.42,
    waves: [
      [1, 0.05, 0.055, 12],
      [0.9, 0.42, 0.04, 7.5],
      [-0.8, 0.6, 0.028, 4.6],
      [0.3, -0.95, 0.018, 2.6],
    ],
    flow: { x: 1.25, z: 0.1 },
  },
  ambience: { traffic: 0.55, birds: 0.6, cicadas: 0.4, temple: 0.8, wind: 0.25, lapping: 0.7 },
  spawn: { x: -480, z: centreZ(-480), heading: Math.PI / 2 },

  height(x, z) {
    const cz = centreZ(x);
    const w = halfWidth(x);
    const d = Math.abs(z - cz);

    let h;
    if (d < w) {
      const t = d / w;
      // asymmetric channel: deeper on the outside of each bend
      const thalweg = 0.35 * Math.sign(Math.cos(x * 0.0038));
      const prof = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t - thalweg) / 1.25, 2)), 0.7);
      h = -4.4 * prof + fbm(x * 0.012, z * 0.012, 3) * 0.35;
      // sandbars and silt islands — the Musi is full of them
      const bar = Math.pow(Math.max(0, ridged(x * 0.0065, z * 0.016, 3) - 0.46), 1.2) * 26;
      h += bar;
    } else {
      const over = d - w;
      h = 1.15 * Math.pow(over, 0.52) + fbm(x * 0.007, z * 0.007, 4) * 1.2;
      // the old city sits higher on the south bank
      const south = z > cz ? 1 : 0;
      h += smoothstep(10, 160, over) * (south ? 9 : 5.5);
      h += smoothstep(200, 600, over) * 14;
    }

    // stone ghat terraces on the north bank near the old bridge
    const ghatZone = smoothstep(260, 120, Math.abs(x + 90)) * (z < cz ? 1 : 0);
    if (ghatZone > 0.01) {
      const over = clamp(cz - z - w, -4, 60);
      const terraced = Math.floor(clamp(over, 0, 26) / 2.2) * 0.75 + 0.3;
      h = lerp(h, Math.max(h * 0.4, terraced), ghatZone * smoothstep(-3, 6, over) * 0.9);
    }

    // embankment road along the south bank
    const roadDist = Math.abs(z - (cz + halfWidth(x) + 46));
    h = lerp(h, 7.6, (1 - smoothstep(9, 26, roadDist)) * 0.85);

    return h;
  },

  build(ctx) {
    const { props, foliage, rng, addPOI, terrain, water } = ctx;

    // ----------------------------------------------------------- Purana Pul
    const bx = -90;
    const bcz = centreZ(bx);
    stoneBridge(ctx, {
      from: [bx, bcz - 95],
      to: [bx, bcz + 95],
      deckY: 8.6,
      spans: 9,
      thickness: 9,
    });
    addPOI({
      name: 'Purana Pul',
      x: bx,
      z: bcz,
      y: 10,
      radius: 120,
      text: 'The "old bridge" of 1578, built by Ibrahim Quli Qutb Shah: twenty-two arches of grey granite across the Musi.',
    });

    // a modern concrete bridge downstream
    const mx = 420;
    const mcz = centreZ(mx);
    const deckY = 9.2;
    const beams = [];
    const pierGeoms = [];
    for (let i = -1; i <= 1; i++) {
      const pz = mcz + i * 44;
      const bed = terrain.height(mx, pz);
      pierGeoms.push({ x: mx, z: pz, bed });
    }
    const bridgeGroup = new THREE.Group();
    const deckGeom = new THREE.BoxGeometry(16, 1.4, 200);
    const deck = new THREE.Mesh(deckGeom, ctx.mats.concrete);
    deck.position.set(mx, deckY, mcz);
    deck.castShadow = deck.receiveShadow = true;
    bridgeGroup.add(deck);
    for (const p of pierGeoms) {
      const hgt = deckY - p.bed;
      if (hgt <= 0.5) continue;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(5, hgt, 3.4), ctx.mats.concrete);
      pier.position.set(p.x, p.bed + hgt / 2, p.z);
      pier.castShadow = pier.receiveShadow = true;
      bridgeGroup.add(pier);
    }
    ctx.group.add(bridgeGroup);
    props.traffic(
      [
        [mx, mcz - 95],
        [mx, mcz],
        [mx, mcz + 95],
      ],
      { count: 7, speed: 10, y: deckY + 1.0, laneWidth: 3.6 }
    );
    for (let i = 0; i < 6; i++) props.lamp(mx + 7, mcz - 80 + i * 32, { y: deckY + 0.7, height: 5 });

    // --------------------------------------------------------------- ghats
    for (let i = 0; i < 6; i++) {
      const gx = -250 + i * 62;
      const gcz = centreZ(gx) - halfWidth(gx) - 2;
      props.ghat(gx, gcz, 0, { width: 56, count: 14, rise: 0.5, run: 1.0 });
    }
    addPOI({
      name: 'Dhobi ghat',
      x: -200,
      z: centreZ(-200) - 40,
      y: 2,
      radius: 90,
      text: 'Washermen have worked this stretch for generations — the sheets are laid out on the steps to dry.',
    });
    props.laundryLines(
      [
        [-250, centreZ(-250) - 54],
        [-210, centreZ(-210) - 58],
        [-170, centreZ(-170) - 56],
        [-130, centreZ(-130) - 60],
      ],
      { height: 3.0, spans: 4 }
    );
    props.laundryLines(
      [
        [-60, centreZ(-60) - 56],
        [-20, centreZ(-20) - 58],
        [20, centreZ(20) - 54],
      ],
      { height: 2.8, spans: 3 }
    );

    // ----------------------------------------------- old city on both banks
    const oldTown = [];
    for (let i = 0; i < 46; i++) {
      const ox = rng.float(-780, 780);
      const side = rng.next() < 0.6 ? 1 : -1;
      const oz = centreZ(ox) + side * (halfWidth(ox) + rng.float(66, 220));
      oldTown.push({
        x: ox,
        z: oz,
        w: rng.float(9, 20),
        d: rng.float(9, 18),
        h: rng.float(6, 20),
        rotY: rng.float(0, TAU),
        style: 'oldTown',
      });
    }
    props.skyline(oldTown);

    // temples and a mosque among the rooftops
    props.temple(-320, centreZ(-320) - 96, { scale: 1.2, rotY: 0.4 });
    props.temple(240, centreZ(240) - 110, { scale: 0.9, rotY: -0.8 });
    addPOI({
      name: 'Riverside temple',
      x: -320,
      z: centreZ(-320) - 96,
      y: 8,
      radius: 80,
      text: 'Bells at dusk. Half the old city\'s shrines back onto the river.',
    });

    // ------------------------------------------------- Charminar + Masjid
    charminar(ctx, 60, centreZ(60) + 310, { scale: 1.0, rotY: 0.18 });
    addPOI({
      name: 'Charminar',
      x: 60,
      z: centreZ(60) + 310,
      y: 40,
      radius: 320,
      text: '1591 CE, four 48 m minarets at the crossroads of the old city. Visible over the south bank rooftops.',
    });
    mosque(ctx, -140, centreZ(-140) + 290, { scale: 1.0, rotY: -0.1, width: 44 });
    addPOI({
      name: 'Mecca Masjid',
      x: -140,
      z: centreZ(-140) + 290,
      y: 24,
      radius: 220,
      text: 'Built with bricks from Mecca in its central arch, finished 1694 — and the burial place of the Nizams.',
    });

    // road along the south bank, with traffic
    const roadPts = [];
    for (let x = -800; x <= 800; x += 80) roadPts.push([x, centreZ(x) + halfWidth(x) + 46]);
    props.road(roadPts, { width: 11 });
    props.traffic(roadPts, { count: 18, speed: 11, laneWidth: 3.2 });
    props.wall(
      roadPts.map(([x, z]) => [x, z - 7]),
      { height: 1.0, thickness: 0.4 }
    );

    // ------------------------------------------------------------ river life
    for (let i = 0; i < 10; i++) {
      const cx = rng.float(-700, 700);
      const ccz = centreZ(cx) + rng.float(-18, 18);
      if (terrain.depth(cx, ccz) < 0.8) continue;
      props.ambientBoat('country', cx, ccz, rng.float(0, TAU), { scale: rng.float(0.8, 1.05) });
    }
    for (let i = 0; i < 7; i++) {
      const fx = rng.float(-700, 700);
      const fz = centreZ(fx) + (rng.next() < 0.5 ? -1 : 1) * halfWidth(fx) * rng.float(0.55, 0.9);
      props.fishingNet(fx, fz, rng.float(0, TAU), { size: rng.float(4, 6.5) });
    }
    for (let i = 0; i < 9; i++) {
      const wx = rng.float(-700, 700);
      const wz = centreZ(wx) + (rng.next() < 0.5 ? -1 : 1) * halfWidth(wx) * rng.float(0.8, 1.05);
      if (terrain.depth(wx, wz) > 1.4 || terrain.depth(wx, wz) < -0.4) continue;
      props.buffalo(wx, wz, rng.float(0, TAU));
    }
    addPOI({
      name: 'Buffalo wallow',
      x: 150,
      z: centreZ(150),
      y: 0,
      radius: 70,
      text: 'Give them room — they do not move for boats.',
    });

    for (const p of scatter(terrain, rng, {
      count: 22,
      area: { minX: -780, maxX: 780, minZ: -300, maxZ: 300 },
      minDepth: 0.05,
      maxDepth: 0.55,
    }))
      props.egret(p.x, p.z, { angle: rng.float(0, TAU), scale: rng.float(0.9, 1.4) });

    // hyacinth mats and litter choking the channel
    for (let i = 0; i < 200; i++) {
      const hx = rng.float(-820, 820);
      const hz = centreZ(hx) + rng.float(-1, 1) * halfWidth(hx) * 0.95;
      if (terrain.depth(hx, hz) < 0.5) continue;
      foliage.add('hyacinth', hx, hz, { scale: rng.float(0.9, 2.2) });
    }
    props.floatingLitter({ area: { minX: -800, maxX: 800, minZ: -160, maxZ: 160 }, count: 110 });

    // ------------------------------------------------------------ planting
    for (const p of scatter(terrain, rng, {
      count: 420,
      area: { minX: -800, maxX: 800, minZ: -420, maxZ: 420 },
      minHeight: 0.8,
      maxHeight: 24,
      maxSlope: 0.5,
    })) {
      const roll = rng.next();
      foliage.add(roll < 0.4 ? 'palm' : roll < 0.6 ? 'banyan' : roll < 0.8 ? 'neem' : 'gulmohar', p.x, p.z, {
        scale: rng.float(0.85, 1.25),
      });
    }
    for (const p of scatter(terrain, rng, {
      count: 900,
      area: { minX: -820, maxX: 820, minZ: -400, maxZ: 400 },
      minHeight: -0.6,
      maxHeight: 1.6,
      maxSlope: 0.8,
    }))
      foliage.add('reeds', p.x, p.z, { scale: rng.float(0.8, 1.6) });
    for (const p of scatter(terrain, rng, {
      count: 700,
      area: { minX: -820, maxX: 820, minZ: -420, maxZ: 420 },
      minHeight: 0.4,
      maxHeight: 22,
      maxSlope: 0.7,
    }))
      foliage.add('scrub', p.x, p.z, { scale: rng.float(0.8, 1.5) });

    props.birdFlock({ cx: 0, cz: 0, radius: 220, count: 16, height: 36, speed: 0.06 });
    props.commitLamps();

    addPOI({
      name: 'Downstream reach',
      x: 700,
      z: centreZ(700),
      y: 0,
      radius: 120,
      text: 'The current runs about 1.3 m/s here. Coming back upstream in the naav is honest work.',
    });
  },
};
