import * as THREE from 'three';
import { fbm, ridged, smoothstep, clamp, distToPolyline, TAU, lerp } from '../utils.js';
import { scatter } from '../foliage.js';
import {
  buddhaStatue,
  necklaceSkyline,
  flagpole,
  floatingPlatform,
} from '../landmarks.js';

/**
 * Hussain Sagar — the 1563 tank in the middle of Hyderabad. Tank Bund road
 * along the east shore, Necklace Road and the city skyline around the rim,
 * Lumbini Park to the south, and the 18 m Buddha on its island in the middle.
 */

const TANK_BUND = [
  [330, -420],
  [372, -250],
  [392, -90],
  [386, 70],
  [352, 220],
  [296, 350],
];

const NECKLACE = [
  [-392, -300],
  [-430, -140],
  [-424, 40],
  [-380, 200],
  [-300, 330],
];

const ISLAND = { x: 40, z: -70, r: 46 };

function shoreRadius(angle, x, z) {
  return (
    430 +
    64 * Math.sin(angle * 1.7 + 0.6) +
    46 * Math.cos(angle * 2.3 - 1.1) +
    26 * Math.sin(angle * 3.9 + 2.2) +
    34 * fbm(x * 0.0022, z * 0.0022, 3)
  );
}

export const hussainSagar = {
  id: 'hussain-sagar',
  name: 'Hussain Sagar',
  region: 'Tank Bund, Hyderabad',
  blurb:
    'A 5.7 km² tank dug in 1563, now ringed by the city. Open water, a stiff afternoon breeze, and the Buddha statue on Gibraltar Rock.',
  sky: 'day',
  defaultBoat: 'speedboat',
  terrain: {
    size: 1500,
    segments: 448,
    depthScale: 16,
    layers: [
      { set: 'mud', scale: 7, tint: 0x6d6a52 }, // lake bed
      { set: 'sand', scale: 5, tint: 0xa79a7e, bandTop: 1.4 }, // wet shore
      { set: 'scrub', scale: 9, tint: 0x9d9878, blend: 2.6, macro: 0.4 }, // banks
      { set: 'granite', scale: 7, tint: 0x8f8a84, slopeStart: 0.26, slopeFull: 0.6 },
    ],
  },
  water: {
    level: 0,
    deepColor: 0x1d4038,
    shallowColor: 0x51633c,
    foamColor: 0xe6ece4,
    foamWidth: 1.5,
    murk: 0.8,
    shoreAlpha: 0.5,
    size: 4.0,
    waveScale: 1.0,
    waves: [
      [1, 0.2, 0.1, 27],
      [0.8, 0.62, 0.08, 16],
      [-0.55, 0.84, 0.05, 9],
      [0.3, -0.95, 0.032, 4.6],
    ],
  },
  ambience: { traffic: 0.85, birds: 0.5, cicadas: 0.15, temple: 0.25, wind: 0.5, lapping: 0.6 },
  spawn: { x: -60, z: 170, heading: Math.PI * 0.92 },

  height(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const shore = shoreRadius(a, x, z);

    let h;
    if (r < shore) {
      const t = r / shore;
      // dished basin, deepest a little north of centre
      const depth = 8.6 * Math.pow(1 - t * t, 0.85);
      const drift = 0.9 * Math.sin(x * 0.004) * Math.cos(z * 0.0035);
      h = -depth - drift + fbm(x * 0.01, z * 0.01, 3) * 0.5;
    } else {
      const d = r - shore;
      h = 0.9 * Math.pow(d, 0.62) + fbm(x * 0.006, z * 0.006, 4) * 1.6;
      // far hills: the granite ridges around the city
      const far = smoothstep(90, 400, d);
      h += far * (14 + ridged(x * 0.0016, z * 0.0016, 4) * 36);
    }

    // Tank Bund: a flat causeway along the eastern shore
    const bundDist = distToPolyline(x, z, TANK_BUND);
    const bund = 1 - smoothstep(16, 46, bundDist);
    h = lerp(h, 3.4 + fbm(x * 0.02, z * 0.02, 2) * 0.12, bund * 0.92);

    // Necklace Road promenade on the western shore
    const neckDist = distToPolyline(x, z, NECKLACE);
    const neck = 1 - smoothstep(14, 40, neckDist);
    h = lerp(h, 2.8, neck * 0.9);

    // Gibraltar Rock: the Buddha's island
    const ir = Math.hypot(x - ISLAND.x, z - ISLAND.z);
    if (ir < ISLAND.r * 1.9) {
      const t = clamp(1 - ir / ISLAND.r, -1, 1);
      const knoll = Math.pow(Math.max(0, t), 0.75) * 11.5;
      const rocky = ridged(x * 0.03, z * 0.03, 3) * 2.2 * Math.max(0, t);
      h = Math.max(h, knoll + rocky - 1.2);
    }

    // a shallow sandbar off the southern park
    const barDist = Math.hypot(x + 150, z - 290);
    h = Math.max(h, -3.4 + 3.5 * smoothstep(130, 0, barDist) + fbm(x * 0.02, z * 0.02, 2) * 0.3);

    return h;
  },

  build(ctx) {
    const { props, foliage, rng, addPOI, terrain, water, mats, night } = ctx;

    // ---------------------------------------------------------- the Buddha
    buddhaStatue(ctx, ISLAND.x, ISLAND.z, { scale: 1, rotY: -2.2, baseY: terrain.height(ISLAND.x, ISLAND.z) - 0.6 });
    addPOI({
      name: 'Buddha Statue',
      x: ISLAND.x,
      z: ISLAND.z,
      y: 20,
      radius: 120,
      text: '18 m of white granite, carved in Raigir and raised on Gibraltar Rock in 1992 after a first attempt sank in the lake.',
    });
    // island fringe: boulders, a landing jetty, a few palms
    props.boulders(
      scatter(terrain, rng, {
        count: 26,
        area: { cx: ISLAND.x, cz: ISLAND.z, radius: ISLAND.r * 1.3 },
        minHeight: -2.5,
        maxHeight: 9,
      }).map((p) => ({ ...p, scale: rng.float(1.4, 4.0) }))
    );
    props.jetty(
      [
        [ISLAND.x - 30, ISLAND.z + 40],
        [ISLAND.x - 44, ISLAND.z + 62],
        [ISLAND.x - 52, ISLAND.z + 84],
      ],
      { width: 3.0, deckY: 1.5 }
    );
    for (const p of scatter(terrain, rng, {
      count: 14,
      area: { cx: ISLAND.x, cz: ISLAND.z, radius: ISLAND.r },
      minHeight: 1.2,
      maxSlope: 0.5,
    })) {
      foliage.add(rng.next() < 0.6 ? 'palm' : 'neem', p.x, p.z, { scale: rng.float(0.8, 1.15) });
    }

    // ------------------------------------------------------------ Tank Bund
    props.embankment(TANK_BUND, { y: 3.4, width: 9, lampEvery: 30 });
    props.road(
      TANK_BUND.map(([x, z]) => [x + 14, z]),
      { width: 12, y: 3.5 }
    );
    props.traffic(
      TANK_BUND.map(([x, z]) => [x + 14, z]),
      { count: 16, speed: 12, y: 3.8, laneWidth: 3.4 }
    );
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      const idx = Math.min(TANK_BUND.length - 2, Math.floor(t * (TANK_BUND.length - 1)));
      const f = t * (TANK_BUND.length - 1) - idx;
      const x = lerp(TANK_BUND[idx][0], TANK_BUND[idx + 1][0], f) - 3;
      const z = lerp(TANK_BUND[idx][1], TANK_BUND[idx + 1][1], f);
      props.statue(x, z, { scale: 1.1, rotY: -Math.PI / 2 });
    }
    addPOI({
      name: 'Tank Bund',
      x: 360,
      z: 20,
      y: 6,
      radius: 150,
      text: 'The eastern bund carries the road into Secunderabad, lined with statues of Telugu figures and a permanent traffic jam.',
    });

    // --------------------------------------------------- Necklace Road side
    props.embankment(NECKLACE, { y: 2.8, width: 8, lampEvery: 28 });
    props.pavilion(-396, 90, { radius: 7, columns: 10, height: 4.6 });
    addPOI({
      name: "People's Plaza",
      x: -396,
      z: 90,
      y: 6,
      radius: 110,
      text: 'Necklace Road promenade — eight kilometres of lake frontage, evening crowds and corn vendors.',
    });
    flagpole(ctx, -330, -240, { height: 44 });

    // --------------------------------------------------------- city skyline
    necklaceSkyline(ctx, { centre: [0, 0], radius: 560, count: 34 });
    props.skyline(
      [
        { x: 470, z: -140, w: 34, d: 26, h: 62, style: 'glass' },
        { x: 520, z: 30, w: 28, d: 28, h: 48, style: 'glass' },
        { x: 450, z: 210, w: 30, d: 22, h: 40 },
        { x: -500, z: -180, w: 26, d: 26, h: 54, style: 'glass' },
        { x: -540, z: 120, w: 30, d: 24, h: 44 },
      ]
    );

    // ------------------------------------------------- Lumbini Park (south)
    props.jetty(
      [
        [-120, 330],
        [-128, 302],
        [-134, 272],
      ],
      { width: 4.0, deckY: 1.6 }
    );
    props.pavilion(-150, 352, { radius: 5, columns: 8, height: 3.8 });
    addPOI({
      name: 'Lumbini Park jetty',
      x: -134,
      z: 272,
      y: 2,
      radius: 90,
      text: 'Where the launches and pedal boats go out. Laser show at 7.15 pm, mind the queue.',
    });
    // the famous swan pedal boats, moored and drifting
    for (let i = 0; i < 7; i++) {
      props.ambientBoat('swan', -150 + i * 11 + rng.float(-3, 3), 250 + rng.float(-14, 14), rng.float(0, TAU));
    }
    props.ambientBoat('launch', -60, 210, 1.1);
    props.ambientBoat('launch', 120, -180, -0.6);
    for (let i = 0; i < 5; i++) {
      props.ambientBoat(
        'country',
        rng.float(-260, 260),
        rng.float(-280, 280),
        rng.float(0, TAU)
      );
    }

    // ----------------------------------------------------- water furniture
    for (const [bx, bz, c] of [
      [-200, 60, 0xe8552c],
      [-40, 150, 0xffd166],
      [160, 40, 0xe8552c],
      [90, -240, 0xffd166],
      [-240, -160, 0xe8552c],
    ])
      props.buoy(bx, bz, { color: c });
    floatingPlatform(ctx, -210, 190, { w: 11, d: 8 });

    // water hyacinth rafts + the lake's less lovely floating population
    for (let i = 0; i < 90; i++) {
      const a = rng.float(0, TAU);
      const r = rng.float(120, 420);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (terrain.depth(x, z) < 1.2) continue;
      foliage.add('hyacinth', x, z, { scale: rng.float(0.8, 2.0) });
    }
    props.floatingLitter({ area: { minX: -380, maxX: 380, minZ: -380, maxZ: 380 }, count: 70 });

    // --------------------------------------------------------- bank planting
    const bankSpots = scatter(terrain, rng, {
      count: 520,
      area: { minX: -720, maxX: 720, minZ: -720, maxZ: 720 },
      minHeight: 0.6,
      maxHeight: 22,
      maxSlope: 0.45,
    });
    for (const p of bankSpots) {
      const roll = rng.next();
      const kind =
        roll < 0.3 ? 'palm' : roll < 0.55 ? 'neem' : roll < 0.7 ? 'banyan' : roll < 0.85 ? 'gulmohar' : 'jacaranda';
      foliage.add(kind, p.x, p.z, { scale: rng.float(0.85, 1.3) });
    }
    for (const p of scatter(terrain, rng, {
      count: 700,
      area: { minX: -620, maxX: 620, minZ: -620, maxZ: 620 },
      minHeight: 0.2,
      maxHeight: 14,
      maxSlope: 0.6,
    }))
      foliage.add('scrub', p.x, p.z, { scale: rng.float(0.8, 1.6) });

    for (const p of scatter(terrain, rng, {
      count: 460,
      area: { minX: -520, maxX: 520, minZ: -520, maxZ: 520 },
      minHeight: -0.9,
      maxHeight: 0.5,
      maxSlope: 0.7,
    }))
      foliage.add('reeds', p.x, p.z, { scale: rng.float(0.8, 1.5) });

    // birds over the tank
    props.birdFlock({ cx: 0, cz: 0, radius: 180, count: 18, height: 40, speed: 0.07 });
    props.birdFlock({ cx: -180, cz: 220, radius: 70, count: 9, height: 22, speed: 0.13 });
    for (const p of scatter(terrain, rng, {
      count: 14,
      area: { minX: -480, maxX: 480, minZ: -480, maxZ: 480 },
      minDepth: 0.05,
      maxDepth: 0.55,
    }))
      props.egret(p.x, p.z, { angle: rng.float(0, TAU), scale: rng.float(0.9, 1.3) });

    props.commitLamps();

    addPOI({
      name: 'Open water',
      x: -120,
      z: -40,
      y: 0,
      radius: 100,
      text: 'The middle of the tank. Two kilometres of fetch here — the chop builds up by mid-afternoon.',
    });
  },
};
