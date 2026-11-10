import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Assets, SKY_PRESETS, SKY_ORDER } from './assets.js';
import { Environment } from './env.js';
import { Terrain } from './terrain.js';
import { WaterSystem } from './water.js';
import { Foliage } from './foliage.js';
import { Props } from './props.js';
import { Boat } from './boat.js';
import { BOAT_BUILDERS, BOAT_ORDER, BOAT_INFO } from './boatModels.js';
import { buildMaterials, NightLights } from './materials.js';
import { CameraRig, CAMERA_MODES, CAMERA_LABELS } from './cameras.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { WindClock } from './shaders/waves.js';
import { SCENES, SCENE_BY_ID } from './scenes/index.js';
import { Rng, clamp, disposeObject, TAU } from './utils.js';

const QUALITY = {
  low: {
    id: 'low',
    title: 'Low',
    note: 'Half-resolution reflections rendered every other frame, soft shadows off, no bloom. For laptops on battery.',
    pixelRatio: 1,
    shadowMap: 1024,
    reflectionRes: 512,
    reflectEveryNFrames: 2,
    bloom: 0,
    shadows: true,
    msaa: 0,
  },
  medium: {
    id: 'medium',
    title: 'Medium',
    note: '1k planar reflections every frame, 2k shadow map, light bloom. The default.',
    pixelRatio: 1.5,
    shadowMap: 2048,
    reflectionRes: 1024,
    reflectEveryNFrames: 1,
    bloom: 1,
    shadows: true,
    msaa: 4,
  },
  high: {
    id: 'high',
    title: 'High',
    note: '1.5k reflections, 2.5k shadows, full bloom and 4× MSAA. Wants a discrete GPU.',
    pixelRatio: 2,
    shadowMap: 2560,
    reflectionRes: 1536,
    reflectEveryNFrames: 1,
    bloom: 1,
    shadows: true,
    msaa: 4,
  },
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 9000);
    this.camera.position.set(0, 8, -20);

    this.clock = new THREE.Clock();
    this.windClock = new WindClock();
    this.quality = QUALITY.medium;
    this.paused = true;
    this.photo = false;
    this.skyName = 'day';
    this.boatKind = 'speedboat';
    this.waveScaleUser = 1;
    this.bloomUser = 1;
    this.fovUser = 62;
    this.trail = [];
    this._trailTimer = 0;
    this.discovered = new Set();
    this.updaters = [];
    this.frameTimes = [];

    this.assets = new Assets(this.renderer);
    this.audio = new AudioEngine();
    this.hud = new Hud({
      onStart: () => this.start(),
      onPlace: (id) => this.loadScene(SCENE_BY_ID[id]),
      onBoat: (id) => this.setBoat(id),
      onSky: (id) => this.setSky(id),
      onCamera: (id) => this.setCamera(id),
      onCameraCycle: () => this.cycleCamera(),
      onQuality: (id) => this.setQuality(id),
      onPhoto: () => this.togglePhoto(),
      onSoundToggle: () => {
        this.audio.setMuted(!this.audio.muted);
        return this.audio.muted;
      },
      onVolume: (v) => this.audio.setVolume(v),
      onWaveScale: (v) => {
        this.waveScaleUser = v;
        if (this.water) this.water.configure({ waveScale: (this.sceneDef.water.waveScale ?? 1) * v });
      },
      onFov: (v) => {
        this.fovUser = v;
        this.rig.targetFov = v;
      },
      onBloom: (v) => {
        this.bloomUser = v;
        this.#applyBloom();
      },
    });

    this.input = new Input(this.canvas, { onAction: (a, e) => this.#action(a, e) });
    this.#composer();
    window.addEventListener('resize', () => this.#resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.paused = true;
      else if (this.started) this.paused = false;
    });
  }

  // ------------------------------------------------------------- rendering
  #composer() {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.quality.msaa,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.28, 0.72, 0.86);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
  }

  #applyBloom() {
    const preset = SKY_PRESETS[this.skyName];
    this.bloomPass.strength = preset.bloom * this.bloomUser * this.quality.bloom;
    this.bloomPass.enabled = this.bloomPass.strength > 0.001;
  }

  #resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  setQuality(id) {
    const q = QUALITY[id] ?? QUALITY.medium;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    if (this.env) {
      this.env.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (this.env.sun.shadow.map) {
        this.env.sun.shadow.map.dispose();
        this.env.sun.shadow.map = null;
      }
    }
    if (this.water) this.water.setQuality(q);
    this.#applyBloom();
    this.#resize();
    this.hud.setQuality(q.id, q.note);
    this.hud.toast(`Quality: ${q.title}`);
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    this.hud.buildMenus({
      places: SCENES.map((s) => ({ id: s.id, title: s.name, subtitle: s.blurb })),
      boats: BOAT_ORDER.map((id) => ({
        id,
        title: BOAT_INFO[id].label,
        subtitle: BOAT_INFO[id].blurb,
      })),
      skies: SKY_ORDER.map((id) => ({
        id,
        title: SKY_PRESETS[id].label,
        subtitle: skyBlurb(id),
      })),
      cameras: CAMERA_MODES.map((id) => ({ id, title: CAMERA_LABELS[id] })),
      qualities: Object.values(QUALITY).map((q) => ({ id: q.id, title: q.title })),
    });
    this.hud.setQuality(this.quality.id, this.quality.note);

    await this.assets.init((p, label) => this.hud.setLoading(p * 0.55, `loading ${label}`));
    this.mats = buildMaterials(this.assets);
    this.env = new Environment(this.scene, this.renderer, this.assets);
    this.env.onChange(() => {
      this.night?.apply(this.env.nightFactor);
      if (this.water) this.water.applySky(this.env.preset, this.env.sunDir);
      this.foliage?.applySky(this.env.preset);
      this.#applyBloom();
      this.hud.setSky(this.env.presetName, this.env.preset.label);
    });

    this.hud.setLoading(0.6, 'building the lake');
    await this.loadScene(SCENES[0], { initial: true });
    this.hud.setLoading(1, 'ready');
    this.hud.loadingReady();
  }

  start() {
    this.started = true;
    this.paused = false;
    this.hud.hideLoading();
    this.audio.start().then(() => {
      this.audio.setAmbience(this.sceneDef.ambience);
      this.audio.setVolume(0.7);
    });
    this.clock.start();
    if (!this._looping) {
      this._looping = true;
      this.renderer.setAnimationLoop(() => this.#frame());
    }
    this.hud.toast('W/S throttle · A/D rudder · C to change view', { ms: 5200 });
  }

  // ------------------------------------------------------------ scene build
  async loadScene(sceneDef, { initial = false } = {}) {
    if (!sceneDef || this.loadingScene) return;
    this.loadingScene = true;
    const wasStarted = this.started;
    this.paused = true;
    if (!initial) {
      this.hud.showLoadingAgain(`heading to ${sceneDef.name}…`);
      await nextFrame();
    }

    this.#unloadScene();
    this.sceneDef = sceneDef;
    this.rng = new Rng(hashString(sceneDef.id));
    this.night = new NightLights();
    this.updaters = [];
    this.discovered = new Set();
    this.pois = [];
    this.trail = [];

    // --- terrain ---
    this.hud.setLoading(0.62, 'carving the terrain');
    await nextFrame();
    const t = sceneDef.terrain;
    this.terrain = new Terrain(this.assets, {
      size: t.size,
      segments: t.segments,
      level: sceneDef.water.level ?? 0,
      depthScale: t.depthScale,
      layers: t.layers,
      heightFn: (x, z) => sceneDef.height(x, z),
    });
    this.scene.add(this.terrain.mesh);

    // --- water ---
    this.hud.setLoading(0.7, 'filling it with water');
    await nextFrame();
    const w = sceneDef.water;
    this.water = new WaterSystem(this.renderer, this.scene, this.assets, {
      level: w.level ?? 0,
      extent: 640,
      segments: 360,
      reflectionRes: this.quality.reflectionRes,
      deepColor: w.deepColor,
      waves: w.waves,
      flow: w.flow ? { x: w.flow.x, y: w.flow.z } : { x: 0, y: 0 },
    });
    this.water.configure({
      deepColor: w.deepColor,
      shallowColor: w.shallowColor,
      foamColor: w.foamColor,
      foamWidth: w.foamWidth,
      murk: w.murk,
      shoreAlpha: w.shoreAlpha,
      size: w.size,
      waves: w.waves,
      waveScale: (w.waveScale ?? 1) * this.waveScaleUser,
      flow: w.flow ? { x: w.flow.x, z: w.flow.z } : { x: 0, z: 0 },
    });
    this.water.setDepthMap(this.terrain.depthTexture, this.terrain.depthBounds, this.terrain.depthScale);
    this.water.setQuality(this.quality);

    // --- world contents ---
    this.hud.setLoading(0.78, 'planting trees and building the city');
    await nextFrame();
    this.world = new THREE.Group();
    this.world.name = 'world';
    this.scene.add(this.world);

    this.foliage = new Foliage({
      scene: this.scene,
      assets: this.assets,
      terrain: this.terrain,
      water: this.water,
      windClock: this.windClock,
      seed: hashString(sceneDef.id) + 11,
    });

    const ctx = {
      scene: this.scene,
      group: this.world,
      assets: this.assets,
      mats: this.mats,
      night: this.night,
      terrain: this.terrain,
      water: this.water,
      foliage: this.foliage,
      rng: this.rng,
      updaters: this.updaters,
      env: this.env,
      windClock: this.windClock,
      addPOI: (poi) => this.pois.push({ y: 0, radius: 80, ...poi }),
    };
    ctx.props = new Props(ctx);
    this.props = ctx.props;
    sceneDef.build(ctx);

    this.hud.setLoading(0.88, 'growing the vegetation');
    await nextFrame();
    this.foliage.build();

    // --- boat + camera ---
    this.hud.setLoading(0.93, 'launching the boat');
    await nextFrame();
    this.boat = new Boat({
      scene: this.scene,
      assets: this.assets,
      mats: this.mats,
      night: this.night,
      water: this.water,
      terrain: this.terrain,
    });
    this.boatKind = sceneDef.defaultBoat ?? this.boatKind;
    this.boat.setKind(this.boatKind);
    this.#respawn();

    this.rig = new CameraRig(this.camera, {
      boat: this.boat,
      water: this.water,
      terrain: this.terrain,
      domElement: this.canvas,
    });
    this.rig.setPointsOfInterest(this.pois);
    this.rig.setMode('chase');
    this.rig.targetFov = this.fovUser;

    // --- sky + hud ---
    this.hud.setLoading(0.97, 'setting the light');
    await nextFrame();
    this.skyName = sceneDef.sky ?? 'day';
    await this.env.setPreset(this.skyName);
    this.env.setShadowRadius(this.sceneDef.id === 'village-pond' ? 95 : 150);

    this.hud.setLocation(sceneDef);
    this.hud.setBoat(this.boat.spec);
    this.hud.setCamera(this.rig.mode, CAMERA_LABELS[this.rig.mode]);
    this.hud.setPois(this.pois);
    this.hud.setMinimapSource(this.terrain.minimapCanvas, this.terrain.half);
    this.audio.setAmbience(sceneDef.ambience);
    this.audio.setBoat(this.boat.spec);

    this.loadingScene = false;
    if (!initial) {
      this.hud.hideLoading();
      this.paused = false;
      this.hud.toast(`${sceneDef.name} — ${sceneDef.region}`, { ms: 4200 });
    } else if (wasStarted) {
      this.paused = false;
    }
  }

  #unloadScene() {
    if (this.boat) {
      this.boat.dispose();
      this.boat = null;
    }
    if (this.foliage) {
      this.scene.remove(this.foliage.group);
      disposeObject(this.foliage.group);
      this.foliage = null;
    }
    if (this.world) {
      this.scene.remove(this.world);
      disposeObject(this.world);
      this.world = null;
    }
    if (this.water) {
      this.water.dispose();
      this.water = null;
    }
    if (this.terrain) {
      this.scene.remove(this.terrain.mesh);
      this.terrain.dispose();
      this.terrain = null;
    }
    if (this.rig) {
      this.rig.controls.dispose();
      this.rig = null;
    }
    this.updaters = [];
  }

  /** Put the boat on navigable water near the scene's spawn point. */
  #respawn() {
    const s = this.sceneDef.spawn;
    const draft = this.boat.spec.draft + 0.3;
    let best = { x: s.x, z: s.z, d: this.terrain.depth(s.x, s.z) };
    if (best.d < draft) {
      for (let r = 6; r <= 160 && best.d < draft; r += 6) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          const x = s.x + Math.cos(a) * r;
          const z = s.z + Math.sin(a) * r;
          const d = this.terrain.depth(x, z);
          if (d > best.d) best = { x, z, d };
          if (d >= draft) break;
        }
      }
    }
    this.boat.spawn(best.x, best.z, s.heading ?? 0);
    this.trail = [];
  }

  // ------------------------------------------------------------- app state
  setBoat(kind) {
    if (!BOAT_BUILDERS[kind] || !this.boat) return;
    this.boatKind = kind;
    const { x, z } = this.boat.pos;
    const heading = this.boat.heading;
    this.boat.setKind(kind);
    this.boat.spawn(x, z, heading);
    this.night.apply(this.env.nightFactor);
    this.hud.setBoat(this.boat.spec);
    this.audio.setBoat(this.boat.spec);
    this.hud.toast(`${this.boat.spec.label} — ${this.boat.spec.blurb}`, { ms: 4200 });
    if (this.terrain.depth(x, z) < this.boat.spec.draft + 0.2) this.#respawn();
  }

  cycleBoat() {
    const i = BOAT_ORDER.indexOf(this.boatKind);
    this.setBoat(BOAT_ORDER[(i + 1) % BOAT_ORDER.length]);
  }

  async setSky(id) {
    if (!SKY_PRESETS[id]) return;
    this.skyName = id;
    this.hud.setLoading(0.5, 'changing the light');
    await this.env.setPreset(id);
    this.hud.toast(SKY_PRESETS[id].label);
  }

  cycleSky() {
    const i = SKY_ORDER.indexOf(this.skyName);
    this.setSky(SKY_ORDER[(i + 1) % SKY_ORDER.length]);
  }

  setCamera(mode) {
    this.rig.setMode(mode);
    this.hud.setCamera(mode, CAMERA_LABELS[mode]);
    if (mode === 'fly') this.hud.toast('Free fly — WASD, E/Q for height, Shift to hurry', { ms: 4200 });
  }

  cycleCamera() {
    const mode = this.rig.cycle();
    this.hud.setCamera(mode, CAMERA_LABELS[mode]);
  }

  togglePhoto() {
    this.photo = !this.photo;
    this.hud.photoMode(this.photo);
  }

  #action(action, event) {
    if (!this.started) {
      if (action === 'escape') return;
      this.start();
      return;
    }
    switch (action) {
      case 'camera':
        this.cycleCamera();
        break;
      case 'boat':
        this.cycleBoat();
        break;
      case 'time':
        this.cycleSky();
        break;
      case 'nextLocation': {
        const i = SCENES.findIndex((s) => s.id === this.sceneDef.id);
        this.loadScene(SCENES[(i + 1) % SCENES.length]);
        break;
      }
      case 'help':
        if (this.hud.anyOverlayOpen()) this.hud.closeOverlays();
        else this.hud.openOverlay('helpOverlay');
        break;
      case 'photo':
        this.togglePhoto();
        break;
      case 'map':
        this.hud.toggleMinimap();
        break;
      case 'reset':
        this.#respawn();
        this.hud.toast('Back at the slipway');
        break;
      case 'horn':
        this.audio.event('horn');
        break;
      case 'debug':
        this.hud.toggleFps();
        break;
      case 'fullscreen':
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
        break;
      case 'escape':
        if (this.hud.anyOverlayOpen()) this.hud.closeOverlays();
        else if (this.photo) this.togglePhoto();
        break;
      case 'digit': {
        const n = +event.code.replace('Digit', '');
        if (n >= 1 && n <= SCENES.length) this.loadScene(SCENES[n - 1]);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ frame
  #frame() {
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    const input = this.input.sample();

    if (this.paused || !this.boat) {
      this.composer.render();
      return;
    }

    const uiOpen = this.hud.anyOverlayOpen();
    const controlInput = uiOpen
      ? { throttle: 0, steer: 0, brake: false, lookDx: 0, lookDy: 0, zoom: 0 }
      : input;

    // world
    this.water.update(dt, this.boat.pos);
    this.windClock.update(dt);

    if (this.rig.mode === 'fly') {
      // keep the boat ticking, but don't steer it while flying the camera
      this.boat.update(dt, { throttle: this.boat.throttle, steer: 0, brake: false });
    } else {
      this.boat.update(dt, controlInput);
    }
    if (this.water.foamDirty) {
      this.water.foamTexture.needsUpdate = true;
      this.water.foamDirty = false;
    }

    const t = this.water.time;
    for (const fn of this.updaters) fn(dt, t);

    this.env.update(dt, this.boat.root.position);

    // camera
    this.rig.update(dt, controlInput);

    // events → audio + shake
    for (const e of this.boat.consumeEvents()) {
      this.audio.event(e.type, e.intensity);
      if (e.type === 'slap') this.rig.addShake(e.intensity * 0.35);
      if (e.type === 'ground') {
        this.rig.addShake(e.intensity * 0.9);
        this.hud.toast('Aground — reverse off the bank', { warn: true });
      }
    }

    this.audio.update(dt, {
      speed: this.boat.speed,
      rpm: this.boat.rpm,
      throttle: this.boat.throttle,
      grounded: this.boat.grounded,
      spec: this.boat.spec,
    });

    // trail for the chart
    this._trailTimer -= dt;
    if (this._trailTimer <= 0) {
      this._trailTimer = 0.45;
      this.trail.push([this.boat.pos.x, this.boat.pos.z]);
      if (this.trail.length > 220) this.trail.shift();
    }

    // points of interest
    this.#checkPois();

    // hud
    const depth = this.terrain.depth(this.boat.pos.x, this.boat.pos.z) - this.boat.spec.draft;
    this.hud.update(dt, {
      speedKmh: this.boat.speedKmh,
      knots: this.boat.speedKnots,
      throttle: this.boat.throttle,
      steer: this.boat.steer,
      rpm: this.boat.rpm,
      depth: Math.max(0, depth),
      heading: this.boat.heading,
      pos: this.boat.pos,
      trail: this.trail,
    });

    this.composer.render();

    if (this._shot) {
      this._shot = false;
      this.#saveShot();
    }

    // perf readout
    this.frameTimes.push(raw);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (this.hud.el.fps.classList.contains('show')) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const info = this.renderer.info;
      this.hud.setFps(
        `${(1 / avg).toFixed(0)} fps   ${(avg * 1000).toFixed(1)} ms\n` +
          `draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k\n` +
          `geom ${info.memory.geometries}  tex ${info.memory.textures}\n` +
          `spray ${this.boat.spray.liveCount}  quality ${this.quality.id}`
      );
    }
  }

  #checkPois() {
    let best = null;
    let bestD = Infinity;
    for (const poi of this.pois) {
      const d = Math.hypot(poi.x - this.boat.pos.x, poi.z - this.boat.pos.z);
      if (d < poi.radius && d < bestD) {
        best = poi;
        bestD = d;
      }
    }
    if (best) {
      this.hud.showPoi(best, bestD);
      if (!this.discovered.has(best.name)) {
        this.discovered.add(best.name);
        this.hud.toast(`Found: ${best.name}  (${this.discovered.size}/${this.pois.length})`, { ms: 3400 });
      }
    }
  }

  #saveShot() {
    try {
      const url = this.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `hyderabad-boating-${this.sceneDef.id}-${Date.now()}.png`;
      a.click();
      this.hud.toast('Screenshot saved');
    } catch (err) {
      this.hud.toast('Could not save the screenshot', { warn: true });
    }
  }
}

function skyBlurb(id) {
  return {
    morning: 'Low sun and river haze, the air still cool.',
    day: 'Hard Deccan light, deep shadows, glare off the water.',
    overcast: 'Monsoon cloud. Flat light, grey-green water, choppy.',
    sunset: 'Twenty minutes of gold, then the city lights come on.',
    night: 'Lamps, lit windows, reflections and a long exposure feel.',
  }[id];
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const app = new App();
window.app = app;
app.boot().catch((err) => {
  console.error(err);
  document.getElementById('loadLabel').textContent = 'Failed to start: ' + err.message;
});

// Enter saves a screenshot while in photo mode
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && app.photo) app._shot = true;
});
