import * as THREE from 'three';

/**
 * Shared material library. Everything structural in the scenes pulls from
 * here so the whole world stays consistent (and we keep the draw-call and
 * texture count low).
 */
export function buildMaterials(assets) {
  const m = {};

  m.concrete = assets.material('concrete', { repeat: 0.25, roughness: 1 });
  m.concrete.color.setHex(0xcfc8bb);

  m.stone = assets.material('sandstone', { repeat: 0.18, roughness: 1 });
  m.stone.color.setHex(0xc9ad84);

  m.granite = assets.material('granite', { repeat: 0.12, roughness: 1 });
  m.granite.color.setHex(0x9a938c);

  m.planks = assets.material('planks', { repeat: 0.5, roughness: 0.92 });
  m.planks.color.setHex(0xb08b5e);

  m.darkPlanks = assets.material('planks', { repeat: 0.5, roughness: 0.9 });
  m.darkPlanks.color.setHex(0x6a4c31);

  m.metal = assets.material('metal', { repeat: 0.5, roughness: 0.75, metalness: 1 });
  m.metal.color.setHex(0x9fa3a6);

  m.rust = assets.material('metal', { repeat: 0.8, roughness: 0.85, metalness: 0.9 });
  m.rust.color.setHex(0x8a6448);

  m.mud = assets.material('mud', { repeat: 0.3, roughness: 1 });

  m.whitewash = new THREE.MeshStandardMaterial({ color: 0xece6dc, roughness: 0.85, metalness: 0 });
  m.plaster = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.9, metalness: 0 });
  m.saffron = new THREE.MeshStandardMaterial({ color: 0xe08a2e, roughness: 0.7, metalness: 0 });
  m.teal = new THREE.MeshStandardMaterial({ color: 0x2f6f74, roughness: 0.6, metalness: 0.1 });
  m.darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.55, metalness: 0.85 });
  m.chrome = new THREE.MeshStandardMaterial({ color: 0xd6dade, roughness: 0.18, metalness: 1 });
  m.glass = new THREE.MeshPhysicalMaterial({
    color: 0x1f2d35,
    roughness: 0.08,
    metalness: 0.0,
    transmission: 0,
    envMapIntensity: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  m.glassTower = new THREE.MeshStandardMaterial({
    color: 0x2a3a46,
    roughness: 0.12,
    metalness: 0.65,
    envMapIntensity: 1.5,
  });
  m.facade = new THREE.MeshStandardMaterial({
    map: assets.proc.facade,
    roughness: 0.85,
    metalness: 0,
  });
  m.facadeLit = new THREE.MeshStandardMaterial({
    map: assets.proc.facade,
    emissiveMap: assets.proc.facadeLit,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.85,
    metalness: 0,
  });
  m.cloth = new THREE.MeshStandardMaterial({
    map: assets.proc.cloth,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
  });
  m.lampGlass = new THREE.MeshStandardMaterial({
    color: 0xfff3d6,
    emissive: 0xffd9a0,
    emissiveIntensity: 0,
    roughness: 0.3,
    metalness: 0,
  });
  m.fibreglass = new THREE.MeshPhysicalMaterial({
    color: 0xf2f4f3,
    roughness: 0.22,
    metalness: 0.05,
    envMapIntensity: 1.2,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  m.hullPaint = (color) =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.25,
      metalness: 0.0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.3,
    });
  m.flat = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts });

  return m;
}

/**
 * Registry for things that light up after dark (lamps, windows, car lights).
 * Scenes register materials, the environment flips them.
 */
export class NightLights {
  constructor() {
    this.entries = [];
  }
  register(material, intensity = 1, { nightColor } = {}) {
    this.entries.push({ material, intensity, nightColor });
    return material;
  }
  apply(factor) {
    for (const e of this.entries) {
      e.material.emissiveIntensity = e.intensity * factor;
      if (e.nightColor && factor > 0) e.material.emissive.setHex(e.nightColor);
      e.material.needsUpdate = false;
    }
  }
}
