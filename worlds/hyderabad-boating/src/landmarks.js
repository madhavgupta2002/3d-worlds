import * as THREE from 'three';
import {
  box,
  cylinder,
  mergeGeometries,
  onionDome,
  lotusPedestal,
  minaret,
  archedWall,
  railing,
  tube,
  ribbon,
} from './geom.js';
import { TAU } from './utils.js';

function meshOf(geometry, material, { shadow = true, name } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  if (name) m.name = name;
  return m;
}

/**
 * The 18 m monolithic Buddha on Rock of Gibraltar island, Hussain Sagar.
 * A lathe-turned robed figure (the robe really is near-cylindrical), with
 * shoulders, arms, head and ushnisha added on top.
 */
export function buddhaStatue(ctx, x, z, { scale = 1, rotY = 0, baseY } = {}) {
  const { mats, terrain, group } = ctx;
  const g = new THREE.Group();
  g.position.set(x, baseY ?? terrain.height(x, z), z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);

  const stoneMat = mats.granite.clone();
  stoneMat.color.setHex(0xb9b3a8);
  stoneMat.roughness = 0.92;

  // plinth + lotus pedestal
  g.add(meshOf(box(13, 1.6, 13), mats.stone, { name: 'buddha-plinth' }));
  g.add(meshOf(box(10.5, 1.0, 10.5, { y: 1.6 }), mats.stone));
  const pedestal = lotusPedestal({ radius: 5.0, petals: 18, rows: 2, height: 2.6 });
  pedestal.translate(0, 2.6, 0);
  g.add(meshOf(pedestal, stoneMat, { name: 'buddha-lotus' }));

  // robed body as a lathe of revolution
  const profile = [
    [2.9, 0],
    [2.85, 0.7],
    [2.6, 2.2],
    [2.35, 4.2],
    [2.2, 6.2],
    [2.1, 8.0],
    [1.9, 9.6],
    [2.0, 11.0],
    [2.12, 12.2],
    [1.8, 13.0],
    [1.15, 13.7],
    [0.66, 14.3],
    [0.64, 14.9],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(profile, 36);
  body.translate(0, 4.4, 0);
  g.add(meshOf(body, stoneMat, { name: 'buddha-body' }));

  // shoulders, arms and hands
  const limbs = [];
  for (const sign of [-1, 1]) {
    const shoulder = new THREE.SphereGeometry(1.0, 16, 12);
    shoulder.scale(1, 0.85, 1);
    shoulder.translate(sign * 1.5, 16.6, 0);
    limbs.push(shoulder);
    const arm = tube(
      [
        new THREE.Vector3(sign * 1.7, 16.2, 0.1),
        new THREE.Vector3(sign * 2.15, 14.0, 0.25),
        new THREE.Vector3(sign * 2.1, 11.6, 0.55),
        new THREE.Vector3(sign * 1.6, 10.3, 1.35),
      ],
      0.52,
      10
    );
    limbs.push(arm);
    const hand = new THREE.SphereGeometry(0.62, 12, 10);
    hand.scale(1, 0.6, 1.25);
    hand.translate(sign * 1.45, 10.1, 1.6);
    limbs.push(hand);
  }
  // neck + head
  const head = new THREE.SphereGeometry(1.3, 24, 18);
  head.scale(0.94, 1.1, 1.0);
  head.translate(0, 20.2, 0);
  limbs.push(head);
  const ushnisha = new THREE.SphereGeometry(0.52, 14, 12);
  ushnisha.translate(0, 21.4, -0.05);
  limbs.push(ushnisha);
  for (const sign of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.3, 10, 8);
    ear.scale(0.4, 1.5, 0.8);
    ear.translate(sign * 1.2, 19.9, 0);
    limbs.push(ear);
  }
  const nose = new THREE.ConeGeometry(0.16, 0.4, 8);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 20.1, 1.25);
  limbs.push(nose);
  g.add(meshOf(mergeGeometries(limbs), stoneMat, { name: 'buddha-limbs' }));

  // hair / eyes as darker inlays
  const dark = mats.flat(0x5c5a54, { roughness: 0.8 });
  const hair = new THREE.SphereGeometry(1.33, 20, 14, 0, TAU, 0, Math.PI * 0.46);
  hair.scale(0.95, 1.12, 1.01);
  hair.translate(0, 20.2, 0);
  g.add(meshOf(hair, dark, { name: 'buddha-hair' }));
  const eyes = [];
  for (const sign of [-1, 1]) {
    const e = box(0.34, 0.07, 0.1, { x: sign * 0.46, y: 20.3, z: 1.2 });
    eyes.push(e);
  }
  g.add(meshOf(mergeGeometries(eyes), dark, { shadow: false }));

  group.add(g);
  return g;
}

/**
 * Durgam Cheruvu cable bridge: two tapered pylons, fanned stay cables and a
 * deck high enough to drive a boat under.
 */
export function cableBridge(ctx, { from, to, deckY = 12, pylonHeight = 32, width = 14, lamps = true }) {
  const { mats, group, props } = ctx;
  const g = new THREE.Group();
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  g.position.set(from[0], 0, from[1]);
  g.rotation.y = -angle;

  // deck (built along +X in local space)
  const deck = meshOf(box(length, 1.1, width, { y: deckY, x: length / 2 }), mats.concrete, { name: 'bridge-deck' });
  g.add(deck);
  const surface = meshOf(box(length, 0.12, width - 1.6, { y: deckY + 0.56, x: length / 2 }), mats.flat(0x33373b));
  g.add(surface);

  // edge beams + railings
  const beams = [];
  for (const sign of [-1, 1]) {
    beams.push(box(length, 1.5, 0.6, { y: deckY - 0.2, x: length / 2, z: (sign * width) / 2 }));
  }
  g.add(meshOf(mergeGeometries(beams), mats.concrete));
  for (const sign of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push([(length * i) / 20, (sign * width) / 2 - sign * 0.35]);
    g.add(
      meshOf(railing(pts, { height: 1.25, postEvery: 3.0, yFn: () => deckY + 0.6 }), mats.metal, {
        shadow: false,
      })
    );
  }

  // pylons at 1/3 and 2/3 with fanned cables
  const cableMat = mats.flat(0xdcdcd4, { roughness: 0.4, metalness: 0.6 });
  const pylonMat = mats.concrete;
  for (const frac of [0.3, 0.7]) {
    const px = length * frac;
    const pylon = [];
    // two legs leaning together, joined above the deck
    for (const sign of [-1, 1]) {
      const legPts = [
        new THREE.Vector3(px, 0, (sign * width) / 2 + sign * 1.6),
        new THREE.Vector3(px, deckY + 6, (sign * width) / 2 - sign * 0.5),
        new THREE.Vector3(px, pylonHeight, 0),
      ];
      pylon.push(tube(legPts, 1.25, 10));
    }
    pylon.push(box(width + 3, 1.2, 2.4, { y: deckY + 7.5, x: px }));
    g.add(meshOf(mergeGeometries(pylon), pylonMat, { name: 'bridge-pylon' }));

    const cables = [];
    for (let i = 1; i <= 7; i++) {
      const spanOut = (length * 0.26 * i) / 7;
      for (const dir of [-1, 1]) {
        const anchorX = px + spanOut * dir;
        if (anchorX < 0 || anchorX > length) continue;
        for (const sign of [-1, 1]) {
          cables.push(
            tube(
              [
                new THREE.Vector3(px, pylonHeight - i * 1.4, 0),
                new THREE.Vector3(anchorX, deckY + 1.0, (sign * width) / 2 - sign * 0.8),
              ],
              0.085,
              4
            )
          );
        }
      }
    }
    g.add(meshOf(mergeGeometries(cables), cableMat, { shadow: false, name: 'bridge-cables' }));
  }

  // piers down into the lake bed
  const piers = [];
  for (const frac of [0.08, 0.3, 0.5, 0.7, 0.92]) {
    const px = length * frac;
    const wx = from[0] + Math.cos(angle) * px;
    const wz = from[1] + Math.sin(angle) * px;
    const bed = ctx.terrain.height(wx, wz);
    piers.push(cylinder(2.6, 2.2, Math.max(1, deckY - bed + 0.5), 14, { x: px, y: bed }));
  }
  const pierMesh = meshOf(mergeGeometries(piers), mats.concrete, { name: 'bridge-piers' });
  g.add(pierMesh);

  group.add(g);

  if (lamps && props) {
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const wx = from[0] + dx * t;
      const wz = from[1] + dz * t;
      props.lamp(wx, wz, { y: deckY + 0.6, height: 6 });
    }
    props.traffic(
      [
        [from[0], from[1]],
        [from[0] + dx * 0.5, from[1] + dz * 0.5],
        [to[0], to[1]],
      ],
      { count: 8, speed: 13, y: deckY + 0.8, laneWidth: 3.6 }
    );
  }
  return g;
}

/** Charminar: four arches, four minarets, 56 m of 1591 CE granite. */
export function charminar(ctx, x, z, { scale = 1, rotY = 0 } = {}) {
  const { mats, group, terrain } = ctx;
  const g = new THREE.Group();
  g.position.set(x, terrain.height(x, z), z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);

  const stone = mats.stone.clone();
  stone.color.setHex(0xc4a87c);

  const S = 20; // base width
  const baseParts = [];
  // plinth
  baseParts.push(box(S + 4, 1.2, S + 4));
  // four piers forming the arches
  const pier = 4.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      baseParts.push(box(pier, 20, pier, { x: (sx * (S - pier)) / 2, y: 1.2, z: (sz * (S - pier)) / 2 }));
    }
  }
  // arch spandrels on each face
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * TAU;
    const w = archedWall({
      spanCount: 1,
      spanWidth: S - pier * 2,
      pierWidth: pier,
      archRise: 11,
      wallHeight: 21.2,
      thickness: 1.2,
    });
    const geo = w.geometry;
    geo.rotateY(a);
    geo.translate(Math.sin(a) * (S / 2 - 0.6), 0, Math.cos(a) * (S / 2 - 0.6));
    baseParts.push(geo);
  }
  // gallery storeys
  baseParts.push(box(S + 2.4, 1.0, S + 2.4, { y: 21.2 }));
  baseParts.push(box(S - 1.5, 6.5, S - 1.5, { y: 22.2 }));
  baseParts.push(box(S + 1.2, 0.8, S + 1.2, { y: 28.7 }));
  baseParts.push(box(S - 5, 5.0, S - 5, { y: 29.5 }));
  baseParts.push(box(S - 3, 0.7, S - 3, { y: 34.5 }));
  g.add(meshOf(mergeGeometries(baseParts), stone, { name: 'charminar-base' }));

  // small domes on the upper terrace
  const domes = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const d = onionDome(1.5, 2.6, 14);
      d.translate((sx * (S - 9)) / 2, 35.2, (sz * (S - 9)) / 2);
      domes.push(d);
    }
  }
  const centreDome = onionDome(3.0, 5.0, 20);
  centreDome.translate(0, 35.2, 0);
  domes.push(centreDome);
  g.add(meshOf(mergeGeometries(domes), stone, { name: 'charminar-domes' }));

  // the four minarets
  const mins = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = minaret({ height: 34, radius: 2.5, balconies: 4 });
      m.translate((sx * (S - pier)) / 2, 1.2, (sz * (S - pier)) / 2);
      mins.push(m);
    }
  }
  g.add(meshOf(mergeGeometries(mins), stone, { name: 'charminar-minarets' }));

  group.add(g);
  return g;
}

/** Mecca Masjid-ish mosque facade: arcade, domes, flanking minarets. */
export function mosque(ctx, x, z, { scale = 1, rotY = 0, width = 44 } = {}) {
  const { mats, group, terrain } = ctx;
  const g = new THREE.Group();
  g.position.set(x, terrain.height(x, z), z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);

  const stone = mats.stone.clone();
  stone.color.setHex(0xb7a382);

  const arcade = archedWall({
    spanCount: 5,
    spanWidth: 5.6,
    pierWidth: 2.4,
    archRise: 9,
    wallHeight: 16,
    thickness: 14,
  });
  g.add(meshOf(arcade.geometry, stone, { name: 'mosque-arcade' }));
  g.add(meshOf(box(arcade.width + 2, 1.0, 16, { y: 16 }), stone));

  const domes = [];
  const mainDome = onionDome(5.4, 8.6, 26);
  mainDome.translate(0, 17, -2);
  domes.push(mainDome);
  for (const sx of [-1, 1]) {
    const d = onionDome(2.6, 4.4, 18);
    d.translate(sx * 11, 17, -2);
    domes.push(d);
  }
  g.add(meshOf(mergeGeometries(domes), stone, { name: 'mosque-domes' }));

  const mins = [];
  for (const sx of [-1, 1]) {
    const m = minaret({ height: 26, radius: 1.9, balconies: 3 });
    m.translate((sx * arcade.width) / 2 + sx * 1.2, 0, 4);
    mins.push(m);
  }
  g.add(meshOf(mergeGeometries(mins), stone, { name: 'mosque-minarets' }));

  group.add(g);
  return g;
}

/**
 * Purana Pul — the 1578 CE stone bridge over the Musi, 22 arches in reality,
 * trimmed to fit the stretch of river we model.
 */
export function stoneBridge(ctx, { from, to, deckY = 7.5, spans = 7, thickness = 9 }) {
  const { mats, group, props } = ctx;
  const g = new THREE.Group();
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const spanWidth = (length * 0.78) / spans;
  const pierWidth = (length - spanWidth * spans) / (spans + 1);

  const wall = archedWall({
    spanCount: spans,
    spanWidth,
    pierWidth,
    archRise: deckY * 0.72,
    wallHeight: deckY,
    thickness,
    deckOverhang: 0.6,
  });
  const stone = mats.stone.clone();
  stone.color.setHex(0xb49a74);
  const mesh = meshOf(wall.geometry, stone, { name: 'stone-bridge' });
  g.add(mesh);

  // cutwaters on the upstream piers
  const cuts = [];
  for (let i = 0; i <= spans; i++) {
    const px = -wall.width / 2 + pierWidth / 2 + i * (spanWidth + pierWidth);
    const c = new THREE.CylinderGeometry(pierWidth * 0.5, pierWidth * 0.5, deckY * 0.8, 10, 1, false, 0, Math.PI);
    c.rotateY(Math.PI);
    c.translate(px, (deckY * 0.8) / 2, thickness / 2);
    cuts.push(c);
  }
  g.add(meshOf(mergeGeometries(cuts), stone));

  // parapets
  for (const sign of [-1, 1]) {
    const pts = [
      [-wall.width / 2, (sign * thickness) / 2 + sign * 0.3],
      [wall.width / 2, (sign * thickness) / 2 + sign * 0.3],
    ];
    g.add(
      meshOf(railing(pts, { height: 0.95, postEvery: 2.0, yFn: () => deckY + 0.6 }), stone, { shadow: false })
    );
  }

  g.position.set((from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2);
  g.rotation.y = -angle;
  group.add(g);

  if (props) {
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      props.lamp(from[0] + dx * t, from[1] + dz * t, { y: deckY + 0.6, height: 4.2 });
    }
  }
  return g;
}

/** HITEC City: Cyber Towers plus a cluster of glass blocks. */
export function cyberTowers(ctx, x, z, { rotY = 0 } = {}) {
  const { props, mats, group, terrain } = ctx;
  const g = new THREE.Group();
  g.position.set(x, terrain.height(x, z), z);
  g.rotation.y = rotY;

  // twin stepped towers joined by a bridge
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(box(16, 44, 16, { x: sx * 13 }));
    parts.push(box(12, 10, 12, { x: sx * 13, y: 44 }));
  }
  const body = meshOf(mergeGeometries(parts), mats.glassTower, { name: 'cyber-towers' });
  g.add(body);
  g.add(meshOf(box(10, 4, 10, { y: 26 }), mats.chrome));
  const mast = [];
  for (const sx of [-1, 1]) mast.push(cylinder(0.4, 0.2, 14, 8, { x: sx * 13, y: 54 }));
  g.add(meshOf(mergeGeometries(mast), mats.darkMetal, { shadow: false }));
  group.add(g);

  // surrounding campus
  props?.skyline(
    [
      { x: x - 70, z: z + 40, w: 26, d: 20, h: 30 },
      { x: x + 60, z: z + 30, w: 22, d: 22, h: 38 },
      { x: x + 10, z: z + 70, w: 34, d: 18, h: 22 },
      { x: x - 40, z: z + 90, w: 20, d: 20, h: 46 },
      { x: x + 90, z: z - 10, w: 24, d: 24, h: 26 },
    ],
    { style: 'glass' }
  );
  return g;
}

/** Hussain Sagar's "Necklace Road" promenade skyline + the big flagpole. */
export function necklaceSkyline(ctx, { centre = [0, 0], radius = 320, count = 26 } = {}) {
  const { props, rng } = ctx;
  const specs = [];
  for (let i = 0; i < count; i++) {
    const a = rng.float(0, TAU);
    const r = radius + rng.float(-40, 120);
    specs.push({
      x: centre[0] + Math.cos(a) * r,
      z: centre[1] + Math.sin(a) * r,
      w: rng.float(14, 30),
      d: rng.float(14, 26),
      h: rng.float(16, 58),
      rotY: rng.float(0, TAU),
      style: rng.next() < 0.3 ? 'glass' : 'concrete',
    });
  }
  props.skyline(specs);
  return specs;
}

/** Tall flagpole with the national flag — Sanjeevaiah Park end of the tank. */
export function flagpole(ctx, x, z, { height = 42 } = {}) {
  const { mats, group, terrain, updaters } = ctx;
  const g = new THREE.Group();
  g.position.set(x, terrain.height(x, z), z);
  g.add(meshOf(cylinder(1.6, 1.4, 1.2, 16), mats.concrete));
  g.add(meshOf(cylinder(0.3, 0.16, height, 12, { y: 1.2 }), mats.chrome, { shadow: true }));
  const flagMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  const flagGeo = new THREE.PlaneGeometry(9, 6, 12, 6);
  const colors = [];
  const pos = flagGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = (pos.getY(i) + 3) / 6;
    if (v > 0.66) colors.push(1.0, 0.6, 0.2);
    else if (v > 0.33) colors.push(1, 1, 1);
    else colors.push(0.07, 0.53, 0.23);
  }
  flagGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const flag = meshOf(flagGeo, flagMat, { shadow: false });
  flag.position.set(4.6, height - 3, 0);
  g.add(flag);
  updaters.push((dt, t) => {
    const p = flag.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + 4.5) / 9;
      p.setZ(i, Math.sin(t * 3.2 + u * 6.0) * 0.55 * u);
    }
    p.needsUpdate = true;
  });
  group.add(g);
  return g;
}

/** Floating stage / jetty island with a signboard, for the lake. */
export function floatingPlatform(ctx, x, z, { w = 10, d = 7, label } = {}) {
  const { mats, group, water } = ctx;
  const g = new THREE.Group();
  g.position.set(x, water.level, z);
  const pontoon = meshOf(box(w, 0.8, d, { y: -0.3 }), mats.flat(0x4a4f52, { roughness: 0.7 }));
  const deck = meshOf(box(w - 0.4, 0.14, d - 0.4, { y: 0.1 }), mats.planks);
  g.add(pontoon, deck);
  const rails = railing(
    [
      [-w / 2 + 0.3, -d / 2 + 0.3],
      [w / 2 - 0.3, -d / 2 + 0.3],
      [w / 2 - 0.3, d / 2 - 0.3],
      [-w / 2 + 0.3, d / 2 - 0.3],
      [-w / 2 + 0.3, -d / 2 + 0.3],
    ],
    { height: 1.0, postEvery: 1.6, yFn: () => 0.24 }
  );
  g.add(meshOf(rails, mats.metal, { shadow: false }));
  group.add(g);
  return g;
}

export { ribbon };
