import { fbm, ridged, smoothstep, clamp, TAU, lerp } from '../utils.js';
import { scatter } from '../foliage.js';
import { cableBridge, cyberTowers } from '../landmarks.js';

/**
 * Durgam Cheruvu — the "secret lake" behind Jubilee Hills: 2.5 billion-year-old
 * granite boulders, a cliff on the east side, HITEC City towers over the ridge,
 * and the cable bridge that opened across it in 2020.
 */

const LOBES = [
  [-70, -10, 205],
  [130, 135, 140],
  [45, -180, 120],
];

function smoothMin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Signed distance to the lake edge: negative inside the water. */
function lakeField(x, z) {
  let f = Infinity;
  for (const [cx, cz, r] of LOBES) {
    const wobble = 1 + 0.14 * fbm(x * 0.004 + cx * 0.01, z * 0.004, 3);
    const d = Math.hypot(x - cx, z - cz) - r * wobble;
    f = f === Infinity ? d : smoothMin(f, d, 55);
  }
  return f;
}

export const durgamCheruvu = {
  id: 'durgam-cheruvu',
  name: 'Durgam Cheruvu',
  region: 'Jubilee Hills / Madhapur',
  blurb:
    'The Secret Lake: sheer granite, boulder islands and the cable bridge overhead. Sheltered water, so it stays glassy.',
  sky: 'morning',
  defaultBoat: 'speedboat',
  terrain: {
    size: 1300,
    segments: 448,
    depthScale: 14,
    layers: [
      { set: 'mud', scale: 6, tint: 0x5f6456 },
      { set: 'granite', scale: 4, tint: 0x9d978e, bandTop: 1.1 },
      { set: 'laterite', scale: 8, tint: 0xa98a6c, blend: 2.2, macro: 0.5 },
      { set: 'cliff', scale: 10, tint: 0x8c867e, slopeStart: 0.18, slopeFull: 0.5 },
    ],
  },
  water: {
    level: 0,
    deepColor: 0x16302c,
    shallowColor: 0x3f5a46,
    foamColor: 0xeef2ee,
    foamWidth: 1.1,
    murk: 0.68,
    shoreAlpha: 0.42,
    size: 4.6,
    waveScale: 0.55,
    waves: [
      [1, 0.3, 0.07, 18],
      [0.6, 0.8, 0.055, 11],
      [-0.7, 0.72, 0.035, 6.5],
      [0.2, -0.98, 0.022, 3.4],
    ],
  },
  ambience: { traffic: 0.35, birds: 0.75, cicadas: 0.35, temple: 0.1, wind: 0.3, lapping: 0.45 },
  spawn: { x: -80, z: 40, heading: 1.2 },

  height(x, z) {
    const f = lakeField(x, z);

    let h;
    if (f < 0) {
      const depth = 7.4 * smoothstep(0, 95, -f);
      h = -depth + fbm(x * 0.014, z * 0.014, 3) * 0.55;
      // submerged boulders: the lake is full of them
      const bump = Math.pow(Math.max(0, ridged(x * 0.022, z * 0.022, 3) - 0.42), 1.4) * 16;
      h += bump;
    } else {
      h = 0.62 * Math.pow(f, 0.72) + fbm(x * 0.008, z * 0.008, 4) * 1.4;
      // granite domes and boulder piles
      const domes = Math.pow(Math.max(0, ridged(x * 0.011, z * 0.011, 4) - 0.3), 1.5) * 42;
      h += domes * smoothstep(2, 30, f);
      // Jubilee Hills ridge to the east, quarry cliff to the north
      h += smoothstep(190, 340, x) * (16 + ridged(x * 0.0022, z * 0.0022, 3) * 30);
      h += smoothstep(230, 420, -z) * (12 + ridged(x * 0.003, z * 0.003, 3) * 24);
      h += smoothstep(380, 620, Math.hypot(x, z)) * 18;
    }

    // rocky promontory reaching into the lake from the south-west
    const promD = Math.hypot((x + 230) * 0.8, z - 90);
    h = Math.max(h, -4 + 9.5 * smoothstep(150, 10, promD));

    return h;
  },

  build(ctx) {
    const { props, foliage, rng, addPOI, terrain } = ctx;

    // ------------------------------------------------------- cable bridge
    cableBridge(ctx, {
      from: [-340, 95],
      to: [330, -55],
      deckY: 13.5,
      pylonHeight: 34,
      width: 15,
    });
    addPOI({
      name: 'Durgam Cheruvu Cable Bridge',
      x: -20,
      z: 20,
      y: 20,
      radius: 150,
      text: 'A 426 m extradosed deck on two pylons, opened 2020 — India\'s longest concrete-deck cable bridge. Plenty of air draft underneath.',
    });

    // --------------------------------------------------------- the boulders
    const rockSpots = scatter(terrain, rng, {
      count: 420,
      area: { minX: -560, maxX: 560, minZ: -560, maxZ: 560 },
      minHeight: -2.4,
      maxHeight: 40,
    });
    props.boulders(rockSpots.map((p) => ({ ...p, scale: rng.float(1.1, 6.5) })));

    // boulder islands sitting in the water
    for (let i = 0; i < 28; i++) {
      const a = rng.float(0, TAU);
      const r = rng.float(60, 230);
      const x = Math.cos(a) * r - 40;
      const z = Math.sin(a) * r;
      if (terrain.depth(x, z) < 0.8) continue;
      props.boulders([{ x, z, y: terrain.height(x, z) + rng.float(0.2, 1.6), scale: rng.float(1.2, 3.4) }]);
    }

    addPOI({
      name: 'Secret Lake rocks',
      x: -230,
      z: 95,
      y: 8,
      radius: 110,
      text: 'Deccan granite, among the oldest exposed rock on earth. The lake was a hiding place in Qutb Shahi times — hence "secret".',
    });

    // ------------------------------------------------------------- HITEC City
    cyberTowers(ctx, 150, -430, { rotY: 0.3 });
    addPOI({
      name: 'HITEC City',
      x: 150,
      z: -430,
      y: 50,
      radius: 240,
      text: 'Cyber Towers and the glass of Madhapur, a kilometre from water that looks like wilderness.',
    });
    props.skyline(
      [
        { x: 420, z: -250, w: 28, d: 24, h: 52, style: 'glass' },
        { x: 480, z: -80, w: 24, d: 24, h: 40, style: 'glass' },
        { x: -300, z: -420, w: 30, d: 22, h: 34 },
        { x: -480, z: -300, w: 22, d: 22, h: 44, style: 'glass' },
      ]
    );

    // --------------------------------------------------------- lake frontage
    props.jetty(
      [
        [-250, 150],
        [-236, 128],
        [-222, 104],
      ],
      { width: 3.0, deckY: 1.4 }
    );
    for (let i = 0; i < 5; i++) {
      props.ambientBoat('country', -215 + rng.float(-14, 14), 92 + rng.float(-14, 14), rng.float(0, TAU), {
        scale: 0.8,
      });
    }
    props.ambientBoat('launch', 60, 150, 2.1);
    props.mooring(-244, 142, 0.6);
    for (const [bx, bz] of [
      [-150, 60],
      [40, -60],
      [120, 90],
    ])
      props.buoy(bx, bz, { color: 0xffd166 });

    // ------------------------------------------------------------- planting
    for (const p of scatter(terrain, rng, {
      count: 420,
      area: { minX: -600, maxX: 600, minZ: -600, maxZ: 600 },
      minHeight: 1.0,
      maxHeight: 34,
      maxSlope: 0.5,
    })) {
      const roll = rng.next();
      foliage.add(roll < 0.35 ? 'palm' : roll < 0.7 ? 'neem' : 'banyan', p.x, p.z, {
        scale: rng.float(0.8, 1.25),
      });
    }
    for (const p of scatter(terrain, rng, {
      count: 1100,
      area: { minX: -600, maxX: 600, minZ: -600, maxZ: 600 },
      minHeight: 0.1,
      maxHeight: 44,
      maxSlope: 0.75,
    }))
      foliage.add('scrub', p.x, p.z, { scale: rng.float(0.7, 1.7) });
    for (const p of scatter(terrain, rng, {
      count: 320,
      area: { minX: -520, maxX: 520, minZ: -520, maxZ: 520 },
      minHeight: -0.7,
      maxHeight: 0.4,
    }))
      foliage.add('reeds', p.x, p.z, { scale: rng.float(0.7, 1.3) });

    for (let i = 0; i < 40; i++) {
      const a = rng.float(0, TAU);
      const r = rng.float(80, 220);
      const x = Math.cos(a) * r - 60;
      const z = Math.sin(a) * r - 10;
      if (terrain.depth(x, z) < 1.0) continue;
      foliage.add('lilypad', x, z, { scale: rng.float(0.7, 1.4) });
    }

    props.birdFlock({ cx: -60, cz: 0, radius: 150, count: 12, height: 44, speed: 0.08 });
    for (const p of scatter(terrain, rng, {
      count: 10,
      area: { minX: -420, maxX: 420, minZ: -420, maxZ: 420 },
      minDepth: 0.08,
      maxDepth: 0.5,
    }))
      props.egret(p.x, p.z, { angle: rng.float(0, TAU) });

    props.commitLamps();
  },
};
