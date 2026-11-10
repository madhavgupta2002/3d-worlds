import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { canvasTexture, Rng, clamp, TAU } from './utils.js';

const BASE = 'assets/';

/**
 * Loads the downloaded CC0 asset pack (Poly Haven textures + HDRI skies,
 * three.js water normals) and builds the procedural textures that are cheaper
 * to generate than to download (foliage alpha cards, foam, window lights...).
 */
export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.texLoader = new THREE.TextureLoader();
    this.hdrLoader = new RGBELoader();
    this.manifest = null;
    this.raw = new Map(); // path -> Texture
    this.sets = new Map(); // cacheKey -> {map, normalMap, armMap}
    this.envs = new Map(); // name -> {envMap, background}
    this.proc = {};
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  async init(onProgress = () => {}) {
    this.manifest = await fetch(BASE + 'manifest.json').then((r) => r.json());

    const texNames = Object.keys(this.manifest.textures);
    const jobs = [];
    for (const name of texNames) {
      const maps = this.manifest.textures[name].maps;
      for (const key of Object.keys(maps)) jobs.push(maps[key]);
    }
    jobs.push(this.manifest.water.normals);

    let done = 0;
    const total = jobs.length + 1;
    await Promise.all(
      jobs.map(async (rel) => {
        const tex = await this.#loadTexture(rel);
        this.raw.set(rel, tex);
        onProgress(++done / total, rel.split('/').pop());
      })
    );

    this.waterNormals = this.raw.get(this.manifest.water.normals);
    this.waterNormals.wrapS = this.waterNormals.wrapT = THREE.RepeatWrapping;
    this.waterNormals.colorSpace = THREE.NoColorSpace;

    this.#buildProcedural();
    onProgress(1, 'ready');
  }

  #loadTexture(rel) {
    return new Promise((resolve, reject) => {
      this.texLoader.load(
        BASE + rel,
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = rel.includes('_diff') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.anisotropy = Math.min(8, this.maxAniso);
          tex.userData.shared = true;
          resolve(tex);
        },
        undefined,
        reject
      );
    });
  }

  /** Lazily build + cache a PMREM environment from one of the HDRI skies. */
  async env(name) {
    if (this.envs.has(name)) return this.envs.get(name);
    const entry = this.manifest.hdris[name];
    if (!entry) throw new Error('unknown sky: ' + name);
    const hdr = await this.hdrLoader.loadAsync(BASE + entry.file);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const envMap = this.pmrem.fromEquirectangular(hdr).texture;
    const res = { envMap, background: hdr };
    this.envs.set(name, res);
    return res;
  }

  /**
   * A Poly Haven texture set with world-space tiling.
   * `repeat` is in tiles per metre-ish (we scale by the mesh's UV convention).
   */
  set(name, repeat = 1) {
    const key = `${name}|${repeat}`;
    if (this.sets.has(key)) return this.sets.get(key);
    const entry = this.manifest.textures[name];
    if (!entry) throw new Error('unknown texture set: ' + name);
    const out = {};
    const pick = (short, target) => {
      const rel = entry.maps[short];
      if (!rel) return;
      const tex = this.raw.get(rel).clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.setScalar(repeat);
      tex.userData.shared = true;
      out[target] = tex;
    };
    pick('diff', 'map');
    pick('nor', 'normalMap');
    pick('arm', 'armMap');
    this.sets.set(key, out);
    return out;
  }

  /** MeshStandardMaterial wired up for a Poly Haven ORM ("arm") set. */
  material(name, { repeat = 1, roughness = 1, metalness = 1, color = 0xffffff, ...rest } = {}) {
    const s = this.set(name, repeat);
    const mat = new THREE.MeshStandardMaterial({
      map: s.map,
      normalMap: s.normalMap,
      aoMap: s.armMap,
      roughnessMap: s.armMap,
      metalnessMap: s.armMap,
      color,
      roughness,
      metalness,
      ...rest,
    });
    return mat;
  }

  // ---------------------------------------------------------------- procedural
  #buildProcedural() {
    const rng = new Rng(9271);

    // Broad leaf cluster card (neem / banyan / jacaranda foliage).
    this.proc.leaf = canvasTexture(512, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const leaf = (cx, cy, len, wid, ang, hue, light) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        const g = ctx.createLinearGradient(0, -len / 2, 0, len / 2);
        g.addColorStop(0, `hsl(${hue},${45 + light * 10}%,${16 + light * 10}%)`);
        g.addColorStop(0.5, `hsl(${hue},${52 + light * 8}%,${26 + light * 14}%)`);
        g.addColorStop(1, `hsl(${hue + 8},45%,${20 + light * 8}%)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -len / 2);
        ctx.quadraticCurveTo(wid / 2, 0, 0, len / 2);
        ctx.quadraticCurveTo(-wid / 2, 0, 0, -len / 2);
        ctx.fill();
        ctx.strokeStyle = `hsla(${hue + 15},35%,${30 + light * 10}%,0.55)`;
        ctx.lineWidth = Math.max(1, len * 0.012);
        ctx.beginPath();
        ctx.moveTo(0, -len / 2);
        ctx.lineTo(0, len / 2);
        ctx.stroke();
        ctx.restore();
      };
      // dense blob of leaves so the card reads as a canopy chunk
      for (let i = 0; i < 230; i++) {
        const r = Math.pow(rng.float(0, 1), 0.65) * s * 0.47;
        const a = rng.float(0, TAU);
        const cx = s / 2 + Math.cos(a) * r;
        const cy = s / 2 + Math.sin(a) * r * 0.9;
        leaf(
          cx,
          cy,
          rng.float(46, 104),
          rng.float(16, 36),
          rng.float(0, TAU),
          rng.float(78, 108),
          rng.float(0, 1)
        );
      }
    });
    this.proc.leafAlpha = this.proc.leaf;

    // Palm / coconut frond, one half-leaf per card.
    this.proc.frond = canvasTexture(512, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.save();
      ctx.translate(s * 0.08, s / 2);
      const len = s * 0.86;
      // rachis
      ctx.strokeStyle = '#4d5a24';
      ctx.lineWidth = s * 0.016;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.5, -s * 0.03, len, s * 0.07);
      ctx.stroke();
      for (let i = 0; i < 64; i++) {
        const t = i / 63;
        const x = len * t;
        const y = -s * 0.03 * Math.sin(t * Math.PI) + s * 0.07 * t * t;
        const bladeLen = s * 0.3 * Math.sin(Math.min(1, t * 1.25) * Math.PI) ** 0.6 * rng.float(0.8, 1.1);
        for (const dir of [-1, 1]) {
          const hue = rng.float(74, 104);
          const lightness = 18 + rng.float(0, 16) + (dir > 0 ? 4 : 0);
          ctx.strokeStyle = `hsl(${hue},${rng.float(38, 60)}%,${lightness}%)`;
          ctx.lineWidth = s * rng.float(0.006, 0.012);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(
            x + bladeLen * 0.4,
            y + dir * bladeLen * 0.45,
            x + bladeLen * 0.55,
            y + dir * bladeLen
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    // Soft foam blob for the wake ribbon / shore foam particles.
    this.proc.foam = canvasTexture(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      // bubbly speckle
      for (let i = 0; i < 900; i++) {
        const a = rng.float(0, TAU);
        const r = Math.pow(rng.float(0, 1), 0.5) * s * 0.48;
        const x = s / 2 + Math.cos(a) * r;
        const y = s / 2 + Math.sin(a) * r;
        const rad = rng.float(0.6, 3.4);
        ctx.fillStyle = `rgba(255,255,255,${rng.float(0.05, 0.5) * (1 - r / (s * 0.5))})`;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU);
        ctx.fill();
      }
    });

    // Streaky wake texture (used along the trail ribbon).
    this.proc.wake = canvasTexture(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        const y = rng.float(0, s);
        const h = rng.float(0.5, 2.6);
        const w = rng.float(s * 0.1, s * 0.9);
        const x = rng.float(-w * 0.2, s);
        ctx.fillStyle = `rgba(255,255,255,${rng.float(0.05, 0.42)})`;
        ctx.fillRect(x, y, w, h);
      }
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });

    // Soft round sprite for spray / dust / insects.
    this.proc.spark = canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });

    // City facade: windows, some lit. Used as emissive + map for skyline blocks.
    const facade = (lit) =>
      canvasTexture(512, (ctx, s) => {
        ctx.fillStyle = lit ? '#05070c' : '#6d6a63';
        ctx.fillRect(0, 0, s, s);
        const cols = 12,
          rows = 24;
        const pad = s * 0.012;
        const cw = s / cols,
          ch = s / rows;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const on = rng.next() < (lit ? 0.42 : 1);
            if (lit && !on) continue;
            const warm = rng.next();
            ctx.fillStyle = lit
              ? `hsl(${warm < 0.7 ? 42 : 196},${warm < 0.7 ? 85 : 55}%,${rng.float(55, 78)}%)`
              : `hsl(205,${rng.float(8, 24)}%,${rng.float(28, 46)}%)`;
            ctx.fillRect(x * cw + pad, y * ch + pad, cw - pad * 2, ch * 0.62);
          }
        }
      });
    this.proc.facade = facade(false);
    this.proc.facadeLit = facade(true);

    // Lily pad / lotus leaf, top-down with a notch.
    this.proc.lilypad = canvasTexture(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const r = s * 0.47;
      const g = ctx.createRadialGradient(s / 2, s / 2, r * 0.15, s / 2, s / 2, r);
      g.addColorStop(0, '#5c7f33');
      g.addColorStop(0.7, '#3f5f24');
      g.addColorStop(1, '#2c4a1c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, r, 0.42, TAU - 0.42);
      ctx.lineTo(s / 2, s / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(150,190,110,0.45)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 16; i++) {
        const a = 0.42 + (i / 15) * (TAU - 0.84);
        ctx.beginPath();
        ctx.moveTo(s / 2, s / 2);
        ctx.lineTo(s / 2 + Math.cos(a) * r * 0.96, s / 2 + Math.sin(a) * r * 0.96);
        ctx.stroke();
      }
    });

    // Water hyacinth clump (the stuff choking Hussain Sagar), top-down.
    this.proc.hyacinth = canvasTexture(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {
        const a = rng.float(0, TAU);
        const r = Math.pow(rng.float(0, 1), 0.6) * s * 0.45;
        const x = s / 2 + Math.cos(a) * r;
        const y = s / 2 + Math.sin(a) * r;
        const rad = rng.float(6, 22);
        ctx.fillStyle = `hsl(${rng.float(88, 118)},${rng.float(35, 62)}%,${rng.float(18, 38)}%)`;
        ctx.beginPath();
        ctx.ellipse(x, y, rad, rad * rng.float(0.6, 1), rng.float(0, TAU), 0, TAU);
        ctx.fill();
      }
      for (let i = 0; i < 8; i++) {
        const x = rng.float(s * 0.2, s * 0.8);
        const y = rng.float(s * 0.2, s * 0.8);
        ctx.fillStyle = `hsl(${rng.float(270, 290)},45%,${rng.float(58, 74)}%)`;
        ctx.beginPath();
        ctx.arc(x, y, rng.float(3, 6), 0, TAU);
        ctx.fill();
      }
    });

    // Laundry / sari cloth strip for the Musi dhobi ghat.
    this.proc.cloth = canvasTexture(128, (ctx, s) => {
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = `hsl(${rng.float(0, 360)},${rng.float(45, 90)}%,${rng.float(45, 72)}%)`;
        ctx.fillRect(0, (i * s) / 10, s, s / 10);
      }
    });

    this.proc.caustics = canvasTexture(
      256,
      (ctx, s) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, s, s);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 160; i++) {
          const x = rng.float(0, s),
            y = rng.float(0, s);
          const r = rng.float(6, 26);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(255,255,255,${rng.float(0.1, 0.35)})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      },
      { srgb: false }
    );

    for (const key of Object.keys(this.proc)) this.proc[key].userData.shared = true;
  }
}

/** Sun placement + atmosphere per sky preset (hand-matched to each HDRI). */
export const SKY_PRESETS = {
  morning: {
    label: 'Morning haze',
    hdri: 'morning',
    sun: { elevation: 16, azimuth: 95 },
    sunColor: 0xffd9a0,
    sunIntensity: 2.4,
    ambient: 0.35,
    envIntensity: 1.0,
    fog: { color: 0xc9d6dc, density: 0.0028 },
    water: { color: 0x2c4a3a, shallow: 0x5a6b45, distortion: 3.0 },
    exposure: 0.95,
    bloom: 0.35,
  },
  day: {
    label: 'Clear afternoon',
    hdri: 'day',
    sun: { elevation: 56, azimuth: 150 },
    sunColor: 0xfff4e0,
    sunIntensity: 3.1,
    ambient: 0.3,
    envIntensity: 1.0,
    fog: { color: 0xb9c9d4, density: 0.0016 },
    water: { color: 0x1d4038, shallow: 0x4e6b46, distortion: 3.6 },
    exposure: 0.82,
    bloom: 0.22,
  },
  overcast: {
    label: 'Monsoon overcast',
    hdri: 'overcast',
    sun: { elevation: 42, azimuth: 175 },
    sunColor: 0xd8dde4,
    sunIntensity: 1.1,
    ambient: 0.75,
    envIntensity: 1.15,
    fog: { color: 0xa9b3bb, density: 0.0052 },
    water: { color: 0x24352f, shallow: 0x44503c, distortion: 4.4 },
    exposure: 0.95,
    bloom: 0.18,
  },
  sunset: {
    label: 'Sunset',
    hdri: 'sunset',
    sun: { elevation: 4.5, azimuth: 268 },
    sunColor: 0xffb061,
    sunIntensity: 2.6,
    ambient: 0.3,
    envIntensity: 1.1,
    fog: { color: 0xd79a6a, density: 0.0034 },
    water: { color: 0x25302c, shallow: 0x4a4733, distortion: 3.2 },
    exposure: 1.0,
    bloom: 0.55,
  },
  night: {
    label: 'Night',
    hdri: 'night',
    sun: { elevation: 32, azimuth: 300 },
    sunColor: 0x9fb6e0,
    sunIntensity: 0.35,
    ambient: 0.16,
    envIntensity: 1.6,
    fog: { color: 0x0b1018, density: 0.0042 },
    water: { color: 0x070d14, shallow: 0x0d161a, distortion: 2.4 },
    exposure: 1.25,
    bloom: 0.9,
  },
};

export function sunDirection(preset, out = new THREE.Vector3()) {
  const el = THREE.MathUtils.degToRad(preset.sun.elevation);
  const az = THREE.MathUtils.degToRad(preset.sun.azimuth);
  out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  return out.normalize();
}

export const SKY_ORDER = ['morning', 'day', 'overcast', 'sunset', 'night'];

export function lerpPresetAmount(a, b, t) {
  return clamp(t, 0, 1) * (b - a) + a;
}
