import * as THREE from 'three';
import { box, cylinder, mergeGeometries, tube, catenaryPoints } from './geom.js';

/**
 * Hull lofting: stations along the length (z, half-beam, keel depth, deck
 * height) are stitched into a hull surface with flare, a rounded forefoot and
 * a flat transom. Boats are modelled bow -> +Z, port -> -X, waterline at y=0.
 */
export function loftHull({
  stations,
  sectionSegs = 10,
  sectionPower = 0.62,
  closeTransom = true,
  closeDeck = false,
}) {
  const rings = [];
  for (const st of stations) {
    const ring = [];
    const depth = st.keel;
    const height = st.deck;
    for (let s = -sectionSegs; s <= sectionSegs; s++) {
      const t = Math.abs(s) / sectionSegs; // 0 at keel, 1 at gunwale
      const sign = s < 0 ? -1 : 1;
      const y = -depth + (height + depth) * t;
      const x = sign * st.beam * Math.pow(Math.sin((t * Math.PI) / 2), sectionPower);
      ring.push(new THREE.Vector3(x, y, st.z));
    }
    rings.push(ring);
  }

  const positions = [];
  const uvs = [];
  const push = (a, b, c, uva, uvb, uvc) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    uvs.push(uva[0], uva[1], uvb[0], uvb[1], uvc[0], uvc[1]);
  };

  const ringLen = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) {
    const v0 = i / (rings.length - 1);
    const v1 = (i + 1) / (rings.length - 1);
    for (let j = 0; j < ringLen - 1; j++) {
      const u0 = j / (ringLen - 1);
      const u1 = (j + 1) / (ringLen - 1);
      const a = rings[i][j];
      const b = rings[i][j + 1];
      const c = rings[i + 1][j];
      const d = rings[i + 1][j + 1];
      push(a, c, b, [u0, v0], [u0, v1], [u1, v0]);
      push(b, c, d, [u1, v0], [u0, v1], [u1, v1]);
    }
  }

  if (closeTransom) {
    const ring = rings[0];
    const centre = new THREE.Vector3(0, ring[0].y + 0.2, ring[0].z);
    for (let j = 0; j < ringLen - 1; j++) {
      push(ring[j], centre, ring[j + 1], [0, 0], [0.5, 0.5], [1, 0]);
    }
  }
  if (closeDeck) {
    const last = rings[rings.length - 1];
    const centre = new THREE.Vector3(0, last[0].y, last[0].z);
    for (let j = 0; j < ringLen - 1; j++) {
      push(last[j + 1], centre, last[j], [0, 0], [0.5, 0.5], [1, 0]);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** Interior floor/deck surface so you can't see through the hull. */
function deckSlab(stations, y, inset = 0.86) {
  const positions = [];
  const uvs = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    const quad = [
      [-a.beam * inset, a.z],
      [a.beam * inset, a.z],
      [b.beam * inset, b.z],
      [-b.beam * inset, b.z],
    ];
    const tri = (p, q, r) => {
      positions.push(p[0], y, p[1], q[0], y, q[1], r[0], y, r[1]);
      uvs.push(p[0], p[1], q[0], q[1], r[0], r[1]);
    };
    tri(quad[0], quad[2], quad[1]);
    tri(quad[0], quad[3], quad[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

function mesh(geometry, material, { shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/** Red/green/white navigation lights that come on at night. */
function navLights(group, spec, mats, night) {
  const make = (color, x, y, z) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0,
      roughness: 0.4,
    });
    night?.register(m, 2.2);
    const s = mesh(new THREE.SphereGeometry(0.055, 8, 6), m, { shadow: false });
    s.position.set(x, y, z);
    group.add(s);
    return s;
  };
  make(0xff2a2a, -spec.beam * 0.86, spec.deck + 0.1, spec.length * 0.32);
  make(0x22ff55, spec.beam * 0.86, spec.deck + 0.1, spec.length * 0.32);
  make(0xffffff, 0, spec.deck + 0.55, -spec.length * 0.44);
}

// ---------------------------------------------------------------- speedboat
export function buildSpeedboat({ mats, night }) {
  const group = new THREE.Group();
  const L = 6.4;
  const stations = [
    { z: -L * 0.5, beam: 1.02, keel: 0.42, deck: 0.72 },
    { z: -L * 0.34, beam: 1.1, keel: 0.46, deck: 0.74 },
    { z: -L * 0.16, beam: 1.12, keel: 0.47, deck: 0.76 },
    { z: 0, beam: 1.08, keel: 0.45, deck: 0.8 },
    { z: L * 0.18, beam: 0.98, keel: 0.4, deck: 0.86 },
    { z: L * 0.33, beam: 0.78, keel: 0.32, deck: 0.94 },
    { z: L * 0.44, beam: 0.48, keel: 0.2, deck: 1.0 },
    { z: L * 0.5, beam: 0.08, keel: 0.05, deck: 1.02 },
  ];

  const hullMat = mats.hullPaint(0xf4f6f5);
  const hull = mesh(loftHull({ stations, sectionSegs: 12 }), hullMat);
  group.add(hull);

  // navy boot-stripe just above the waterline
  const stripeStations = stations.map((s) => ({
    z: s.z,
    beam: s.beam * 1.004,
    keel: 0.04,
    deck: 0.2,
  }));
  const stripe = mesh(loftHull({ stations: stripeStations, sectionSegs: 8, closeTransom: false }), mats.hullPaint(0x1b3a63));
  group.add(stripe);

  // teak deck + cockpit floor
  const deck = mesh(deckSlab(stations, 0.56, 0.9), mats.planks);
  group.add(deck);
  const sole = mesh(deckSlab(stations.slice(1, 5), 0.3, 0.78), mats.darkPlanks);
  group.add(sole);

  // foredeck
  const fore = mesh(deckSlab(stations.slice(4), 0.82, 0.92), mats.fibreglass);
  group.add(fore);

  // cockpit coaming
  const coaming = [];
  for (let i = 1; i < 5; i++) {
    const s = stations[i];
    for (const sign of [-1, 1]) {
      const g = box(0.1, 0.16, Math.abs(stations[i + 1].z - s.z) + 0.02, {
        x: sign * s.beam * 0.9,
        y: 0.56,
        z: (s.z + stations[i + 1].z) / 2,
      });
      coaming.push(g);
    }
  }
  group.add(mesh(mergeGeometries(coaming), mats.fibreglass));

  // console + windshield
  const console3d = mesh(box(1.5, 0.52, 0.42, { y: 0.56, z: 0.72 }), mats.fibreglass);
  group.add(console3d);
  const wsMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe2ea,
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.32,
    envMapIntensity: 2,
    side: THREE.DoubleSide,
  });
  const ws = mesh(box(1.46, 0.4, 0.04, { y: 1.08, z: 0.9 }), wsMat, { shadow: false });
  ws.rotation.x = -0.32;
  group.add(ws);
  const wsFrame = mesh(box(1.52, 0.46, 0.06, { y: 1.07, z: 0.88 }), mats.chrome, { shadow: false });
  wsFrame.rotation.x = -0.32;
  wsFrame.scale.set(1, 1, 1);
  group.add(wsFrame);
  ws.renderOrder = 2;

  // dials
  const dialMat = new THREE.MeshStandardMaterial({
    color: 0x101418,
    emissive: 0x2a6f8a,
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  night?.register(dialMat, 1.2);
  for (const x of [-0.3, 0.1]) {
    const d = mesh(cylinder(0.11, 0.11, 0.03, 14, { y: 0.9, z: 0.88 }), dialMat, { shadow: false });
    d.rotation.x = Math.PI / 2 - 0.3;
    d.position.set(x, 0.9, 0.9);
    group.add(d);
  }

  // wheel
  const wheel = new THREE.Group();
  wheel.position.set(-0.32, 0.95, 0.63);
  wheel.rotation.x = -0.42;
  const rim = mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 22), mats.darkMetal, { shadow: false });
  wheel.add(rim);
  for (let i = 0; i < 3; i++) {
    const spoke = mesh(cylinder(0.012, 0.012, 0.165, 6), mats.chrome, { shadow: false });
    spoke.rotation.z = (i / 3) * Math.PI * 2;
    spoke.position.set(0, 0, 0);
    spoke.geometry.translate(0, 0.08, 0);
    wheel.add(spoke);
  }
  wheel.add(mesh(cylinder(0.035, 0.035, 0.06, 10), mats.chrome, { shadow: false }));
  group.add(wheel);

  // seats
  const seatMat = mats.flat(0x25313a, { roughness: 0.6 });
  for (const x of [-0.42, 0.42]) {
    const base = mesh(box(0.56, 0.34, 0.5, { x, y: 0.3, z: 0.1 }), seatMat);
    const back = mesh(box(0.56, 0.44, 0.12, { x, y: 0.64, z: -0.12 }), seatMat);
    back.rotation.x = 0.12;
    group.add(base, back);
  }
  const bench = mesh(box(1.7, 0.3, 0.5, { y: 0.3, z: -1.35 }), seatMat);
  group.add(bench);

  // grab rails + cleats
  const rails = [];
  for (const sign of [-1, 1]) {
    const pts = [
      new THREE.Vector3(sign * 0.9, 0.78, 1.4),
      new THREE.Vector3(sign * 0.98, 0.8, 2.1),
      new THREE.Vector3(sign * 0.72, 0.84, 2.8),
    ];
    rails.push(tube(pts, 0.028, 6));
  }
  rails.push(cylinder(0.05, 0.05, 0.22, 8, { y: 0.86, z: 2.95 }));
  group.add(mesh(mergeGeometries(rails), mats.chrome, { shadow: false }));

  // outboard engine
  const engine = new THREE.Group();
  engine.position.set(0, 0.1, -L * 0.52);
  const cowl = mesh(box(0.5, 0.62, 0.66, { y: 0.42 }), mats.flat(0x1a1d20, { roughness: 0.35, metalness: 0.4 }));
  const leg = mesh(box(0.22, 0.62, 0.3, { y: -0.2 }), mats.darkMetal);
  const cav = mesh(box(0.34, 0.05, 0.42, { y: -0.52 }), mats.darkMetal);
  const prop = new THREE.Group();
  prop.position.set(0, -0.62, 0.04);
  for (let i = 0; i < 3; i++) {
    const blade = mesh(box(0.045, 0.2, 0.1, { y: 0.1 }), mats.chrome, { shadow: false });
    blade.rotation.z = (i / 3) * Math.PI * 2;
    blade.rotation.y = 0.5;
    prop.add(blade);
  }
  engine.add(cowl, leg, cav, prop);
  group.add(engine);

  const spec = {
    id: 'speedboat',
    label: 'Deccan Dart',
    blurb: 'Fibreglass runabout with a 90 hp outboard — the fastest thing on the tank.',
    length: L,
    beam: 1.12,
    deck: 0.8,
    draft: 0.45,
    mass: 900,
    thrust: 10500,
    reverse: 0.34,
    maxSpeed: 17.5,
    turn: 1.25,
    heelFactor: 0.55,
    trimFactor: 0.09,
    helm: new THREE.Vector3(-0.34, 1.32, 0.18),
    chase: new THREE.Vector3(0, 2.6, -8.6),
    wakeOrigins: [
      [-1.0, -L * 0.45],
      [1.0, -L * 0.45],
    ],
    sprayOrigin: [0, 0.1, L * 0.42],
    engine: { type: 'outboard', idle: 44, rev: 230, growl: 0.5 },
    prop,
    wheel,
    engineTilt: engine,
  };
  navLights(group, spec, mats, night);
  return { group, spec };
}

// -------------------------------------------------------------- country boat
export function buildCountryBoat({ mats, night }) {
  const group = new THREE.Group();
  const L = 5.6;
  const stations = [
    { z: -L * 0.5, beam: 0.42, keel: 0.26, deck: 0.58 },
    { z: -L * 0.34, beam: 0.72, keel: 0.34, deck: 0.6 },
    { z: -L * 0.12, beam: 0.88, keel: 0.38, deck: 0.62 },
    { z: L * 0.1, beam: 0.9, keel: 0.38, deck: 0.64 },
    { z: L * 0.3, beam: 0.74, keel: 0.32, deck: 0.68 },
    { z: L * 0.43, beam: 0.46, keel: 0.22, deck: 0.74 },
    { z: L * 0.5, beam: 0.1, keel: 0.08, deck: 0.8 },
  ];
  const hullMat = mats.darkPlanks.clone();
  hullMat.color.setHex(0x7d5733);
  group.add(mesh(loftHull({ stations, sectionSegs: 9, sectionPower: 0.75 }), hullMat));
  group.add(mesh(deckSlab(stations, -0.16, 0.8), mats.darkPlanks));

  // gunwale rail + ribs
  const bits = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    for (const sign of [-1, 1]) {
      const dz = b.z - a.z;
      const dx = (b.beam - a.beam) * sign;
      const len = Math.hypot(dz, dx);
      const g = box(0.08, 0.1, len, { centred: true });
      g.rotateY(Math.atan2(dx, dz));
      g.translate((sign * (a.beam + b.beam)) / 2, (a.deck + b.deck) / 2, (a.z + b.z) / 2);
      bits.push(g);
    }
  }
  // thwarts (cross benches)
  for (const z of [-1.3, 0.1, 1.4]) {
    bits.push(box(1.74, 0.07, 0.26, { y: 0.26, z }));
  }
  group.add(mesh(mergeGeometries(bits), mats.planks));

  // bamboo-and-cloth canopy amidships
  const canopy = new THREE.Group();
  const hoops = [];
  for (const z of [-0.6, 0.3, 1.2]) {
    const pts = catenaryPoints(
      new THREE.Vector3(-0.82, 0.6, z),
      new THREE.Vector3(0.82, 0.6, z),
      -0.68,
      12
    );
    hoops.push(tube(pts, 0.035, 5));
  }
  canopy.add(mesh(mergeGeometries(hoops), mats.flat(0xb9a06a, { roughness: 0.9 })));
  const cloth = mesh(
    new THREE.CylinderGeometry(0.95, 0.95, 1.9, 16, 1, true, Math.PI * 0.08, Math.PI * 0.84),
    mats.cloth,
    { shadow: true }
  );
  cloth.rotation.z = Math.PI / 2;
  cloth.position.set(0, 0.52, 0.3);
  canopy.add(cloth);
  group.add(canopy);

  // oars resting in the rowlocks
  const oarMat = mats.flat(0xa98253, { roughness: 0.9 });
  for (const sign of [-1, 1]) {
    const oar = new THREE.Group();
    const shaft = mesh(cylinder(0.035, 0.028, 2.6, 7), oarMat);
    shaft.rotation.z = Math.PI / 2;
    const blade = mesh(box(0.02, 0.18, 0.5, { z: 0 }), oarMat);
    blade.position.set(sign * 1.45, 0, 0);
    oar.add(shaft, blade);
    oar.position.set(sign * 0.35, 0.42, -0.4);
    oar.rotation.y = sign * 0.25;
    oar.rotation.z = sign * 0.1;
    group.add(oar);
    if (sign === 1) group.userData.oarRight = oar;
    else group.userData.oarLeft = oar;
  }

  // clutter: rope coil, bucket, net bundle
  const rope = mesh(new THREE.TorusGeometry(0.22, 0.045, 6, 16), mats.flat(0xd9c49a), { shadow: true });
  rope.rotation.x = Math.PI / 2;
  rope.position.set(0.4, -0.1, 2.0);
  const bucket = mesh(cylinder(0.14, 0.17, 0.26, 10, { y: -0.14, x: -0.42, z: 1.7 }), mats.flat(0x3d6e8c));
  group.add(rope, bucket);

  const spec = {
    id: 'country',
    label: 'Naav (country boat)',
    blurb: 'Plank-built rowing boat with a bamboo canopy — what the fishermen use.',
    length: L,
    beam: 0.9,
    deck: 0.64,
    draft: 0.38,
    mass: 420,
    thrust: 1500,
    reverse: 0.45,
    maxSpeed: 4.2,
    turn: 1.0,
    heelFactor: 0.9,
    trimFactor: 0.03,
    helm: new THREE.Vector3(0, 1.0, -0.55),
    chase: new THREE.Vector3(0, 2.3, -7.2),
    wakeOrigins: [
      [-0.75, -L * 0.42],
      [0.75, -L * 0.42],
    ],
    sprayOrigin: [0, 0.05, L * 0.4],
    engine: { type: 'oars', idle: 0, rev: 0, growl: 0 },
    oars: [group.userData.oarLeft, group.userData.oarRight],
  };
  navLights(group, spec, mats, night);
  return { group, spec };
}

// ---------------------------------------------------------------- swan boat
export function buildSwanBoat({ mats, night }) {
  const group = new THREE.Group();
  const L = 3.4;
  const stations = [
    { z: -L * 0.5, beam: 0.78, keel: 0.3, deck: 0.5 },
    { z: -L * 0.26, beam: 0.9, keel: 0.34, deck: 0.52 },
    { z: 0, beam: 0.92, keel: 0.34, deck: 0.54 },
    { z: L * 0.26, beam: 0.84, keel: 0.3, deck: 0.56 },
    { z: L * 0.44, beam: 0.56, keel: 0.22, deck: 0.58 },
    { z: L * 0.5, beam: 0.16, keel: 0.1, deck: 0.6 },
  ];
  const white = mats.hullPaint(0xfdfdfb);
  group.add(mesh(loftHull({ stations, sectionSegs: 10, sectionPower: 0.7 }), white));
  group.add(mesh(deckSlab(stations, 0.1, 0.84), mats.flat(0x2f6f74, { roughness: 0.5 })));

  // swan neck + head at the bow
  const neckPts = [
    new THREE.Vector3(0, 0.45, L * 0.4),
    new THREE.Vector3(0, 0.95, L * 0.52),
    new THREE.Vector3(0, 1.45, L * 0.46),
    new THREE.Vector3(0, 1.72, L * 0.3),
    new THREE.Vector3(0, 1.82, L * 0.42),
  ];
  const neck = mesh(tube(neckPts, 0.14, 9), white);
  group.add(neck);
  const head = mesh(new THREE.SphereGeometry(0.2, 14, 12), white);
  head.position.set(0, 1.86, L * 0.46);
  head.scale.set(1, 0.9, 1.25);
  group.add(head);
  const beak = mesh(new THREE.ConeGeometry(0.075, 0.3, 10), mats.flat(0xe8a33d, { roughness: 0.5 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 1.84, L * 0.46 + 0.26);
  group.add(beak);
  for (const sign of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.03, 8, 6), mats.flat(0x15181b), { shadow: false });
    eye.position.set(sign * 0.1, 1.92, L * 0.46 + 0.14);
    group.add(eye);
    // wings along the sides
    const wing = mesh(new THREE.SphereGeometry(0.62, 14, 10), white);
    wing.scale.set(0.22, 0.52, 1.0);
    wing.position.set(sign * 0.86, 0.5, 0.1);
    group.add(wing);
    // tail feathers
    const tail = mesh(new THREE.ConeGeometry(0.26, 0.8, 8), white);
    tail.rotation.x = -1.9;
    tail.position.set(sign * 0.2, 0.72, -L * 0.5 - 0.1);
    group.add(tail);
  }

  // bench seats + pedals
  const seatMat = mats.flat(0xc0392b, { roughness: 0.65 });
  for (const x of [-0.4, 0.4]) {
    group.add(mesh(box(0.5, 0.28, 0.42, { x, y: 0.12, z: -0.3 }), seatMat));
    const back = mesh(box(0.5, 0.42, 0.1, { x, y: 0.4, z: -0.52 }), seatMat);
    back.rotation.x = 0.14;
    group.add(back);
    const pedal = mesh(box(0.14, 0.05, 0.2, { x, y: 0.14, z: 0.45 }), mats.darkMetal, { shadow: false });
    group.add(pedal);
  }
  const canopyPole = [];
  for (const sign of [-1, 1]) {
    canopyPole.push(cylinder(0.025, 0.025, 1.1, 6, { x: sign * 0.72, y: 0.5, z: -0.3 }));
  }
  group.add(mesh(mergeGeometries(canopyPole), mats.chrome, { shadow: false }));
  const shade = mesh(box(1.7, 0.05, 1.1, { y: 1.6, z: -0.3 }), mats.flat(0xe0533f, { roughness: 0.8 }));
  group.add(shade);

  const spec = {
    id: 'swan',
    label: 'Swan pedal boat',
    blurb: 'Lumbini Park classic. Pedal power only, and it pitches like a cork.',
    length: L,
    beam: 0.92,
    deck: 0.54,
    draft: 0.32,
    mass: 260,
    thrust: 950,
    reverse: 0.5,
    maxSpeed: 3.0,
    turn: 1.5,
    heelFactor: 1.1,
    trimFactor: 0.02,
    helm: new THREE.Vector3(0, 0.95, -0.25),
    chase: new THREE.Vector3(0, 2.0, -6.0),
    wakeOrigins: [
      [-0.8, -L * 0.42],
      [0.8, -L * 0.42],
    ],
    sprayOrigin: [0, 0.05, L * 0.4],
    engine: { type: 'pedal', idle: 0, rev: 0, growl: 0 },
  };
  navLights(group, spec, mats, night);
  return { group, spec };
}

// ------------------------------------------------------------ tourist launch
export function buildLaunch({ mats, night }) {
  const group = new THREE.Group();
  const L = 11.5;
  const stations = [
    { z: -L * 0.5, beam: 1.7, keel: 0.62, deck: 1.0 },
    { z: -L * 0.3, beam: 1.86, keel: 0.68, deck: 1.02 },
    { z: -L * 0.08, beam: 1.9, keel: 0.7, deck: 1.04 },
    { z: L * 0.14, beam: 1.78, keel: 0.66, deck: 1.1 },
    { z: L * 0.32, beam: 1.46, keel: 0.56, deck: 1.18 },
    { z: L * 0.44, beam: 0.9, keel: 0.38, deck: 1.26 },
    { z: L * 0.5, beam: 0.16, keel: 0.12, deck: 1.3 },
  ];
  const hull = mats.hullPaint(0xf7f3e8);
  group.add(mesh(loftHull({ stations, sectionSegs: 12, sectionPower: 0.66 }), hull));
  const stripeStations = stations.map((s) => ({ z: s.z, beam: s.beam * 1.004, keel: 0.1, deck: 0.34 }));
  group.add(mesh(loftHull({ stations: stripeStations, sectionSegs: 8, closeTransom: false }), mats.hullPaint(0x15506b)));
  group.add(mesh(deckSlab(stations, 0.72, 0.9), mats.planks));

  // bulwark
  const walls = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    for (const sign of [-1, 1]) {
      const dz = b.z - a.z;
      const dx = (b.beam - a.beam) * sign;
      const len = Math.hypot(dz, dx);
      const g = box(0.08, 0.5, len, { y: 0.72, centred: false });
      g.rotateY(Math.atan2(dx, dz));
      g.translate((sign * (a.beam + b.beam)) / 2, 0, (a.z + b.z) / 2);
      walls.push(g);
    }
  }
  group.add(mesh(mergeGeometries(walls), hull));

  // cabin + canopy roof on posts
  const cabin = mesh(box(2.7, 1.5, 3.4, { y: 0.9, z: -2.2 }), mats.whitewash);
  group.add(cabin);
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x16242c,
    emissive: 0xffd9a0,
    emissiveIntensity: 0,
    roughness: 0.15,
    metalness: 0.4,
  });
  night?.register(winMat, 0.9);
  for (const sign of [-1, 1]) {
    const w = mesh(box(0.06, 0.6, 2.4, { x: sign * 1.37, y: 1.55, z: -2.2 }), winMat, { shadow: false });
    group.add(w);
  }
  group.add(mesh(box(2.2, 0.6, 0.06, { y: 1.55, z: -0.52 }), winMat, { shadow: false }));

  const posts = [];
  for (const x of [-1.6, 1.6]) {
    for (const z of [-0.2, 1.6, 3.2]) posts.push(cylinder(0.055, 0.055, 1.9, 8, { x, y: 0.72, z }));
  }
  group.add(mesh(mergeGeometries(posts), mats.chrome, { shadow: false }));
  const roof = mesh(box(3.7, 0.12, 4.6, { y: 2.62, z: 1.5 }), mats.flat(0x2f6f74, { roughness: 0.6 }));
  group.add(roof);
  const roof2 = mesh(box(3.0, 0.12, 3.8, { y: 2.46, z: -2.2 }), mats.flat(0x2f6f74, { roughness: 0.6 }));
  group.add(roof2);

  // passenger benches
  const bench = mats.flat(0x1f6b74, { roughness: 0.7 });
  for (const z of [0.2, 1.3, 2.4]) {
    group.add(mesh(box(2.9, 0.1, 0.44, { y: 1.08, z }), bench));
    group.add(mesh(box(2.9, 0.4, 0.08, { y: 1.18, z: z - 0.26 }), bench));
  }

  // helm position inside the cabin
  const wheelG = new THREE.Group();
  wheelG.position.set(0, 1.5, -0.95);
  wheelG.rotation.x = -0.35;
  wheelG.add(mesh(new THREE.TorusGeometry(0.22, 0.026, 8, 20), mats.darkMetal, { shadow: false }));
  group.add(wheelG);

  // lifebuoys on the bulwark
  for (const sign of [-1, 1]) {
    const buoy = mesh(new THREE.TorusGeometry(0.28, 0.08, 8, 16), mats.flat(0xe8552c), { shadow: false });
    buoy.position.set(sign * 1.45, 1.1, 2.9);
    buoy.rotation.y = Math.PI / 2;
    group.add(buoy);
  }
  // mast + flag
  const mast = mesh(cylinder(0.05, 0.04, 2.2, 8, { y: 2.6, z: -3.4 }), mats.chrome, { shadow: false });
  group.add(mast);
  const flag = mesh(box(0.9, 0.6, 0.02, { x: 0.45, y: 4.3, z: -3.4 }), mats.flat(0xe08a2e), { shadow: false });
  group.add(flag);

  const spec = {
    id: 'launch',
    label: 'Tourist launch',
    blurb: 'Diesel launch of the sort that runs tourists out to the Buddha statue.',
    length: L,
    beam: 1.9,
    deck: 1.1,
    draft: 0.68,
    mass: 7200,
    thrust: 42000,
    reverse: 0.3,
    maxSpeed: 8.4,
    turn: 0.5,
    heelFactor: 0.3,
    trimFactor: 0.04,
    helm: new THREE.Vector3(0, 1.95, -1.5),
    chase: new THREE.Vector3(0, 4.4, -15),
    wakeOrigins: [
      [-1.7, -L * 0.46],
      [1.7, -L * 0.46],
    ],
    sprayOrigin: [0, 0.2, L * 0.44],
    engine: { type: 'diesel', idle: 26, rev: 95, growl: 0.85 },
    flag,
  };
  navLights(group, spec, mats, night);
  return { group, spec };
}

export const BOAT_BUILDERS = {
  speedboat: buildSpeedboat,
  country: buildCountryBoat,
  swan: buildSwanBoat,
  launch: buildLaunch,
};

export const BOAT_ORDER = ['speedboat', 'country', 'swan', 'launch'];

/** Menu metadata, so the UI never has to build a hull just to label it. */
export const BOAT_INFO = {
  speedboat: {
    label: 'Deccan Dart',
    blurb: 'Fibreglass runabout, 90 hp outboard. 63 km/h, planes hard, slides in the turns.',
  },
  country: {
    label: 'Naav (country boat)',
    blurb: 'Plank-built rowing boat with a bamboo canopy. Slow, wet, and rolls with everything.',
  },
  swan: {
    label: 'Swan pedal boat',
    blurb: 'Lumbini Park classic. Pedal power, 3 m long, pitches like a cork.',
  },
  launch: {
    label: 'Tourist launch',
    blurb: '11.5 m diesel launch — 7 tonnes, turns like a barge, rides the chop well.',
  },
};
