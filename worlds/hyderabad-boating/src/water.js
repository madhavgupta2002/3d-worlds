import * as THREE from 'three';
import { GerstnerWater, NUM_WAVES } from './vendor/GerstnerWater.js';
import { clamp } from './utils.js';

const G = 9.81;

/**
 * The water surface: a Gerstner-displaced reflective plane that follows the
 * camera, a cheap plane out to the horizon, a CPU copy of the wave function
 * for buoyancy, and a scrolling foam map the boat paints its wake into.
 */
export class WaterSystem {
  constructor(renderer, scene, assets, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.assets = assets;

    this.level = opts.level ?? 0;
    this.extent = opts.extent ?? 620;
    this.segments = opts.segments ?? 360;
    this.flow = new THREE.Vector2(opts.flow?.x ?? 0, opts.flow?.y ?? 0);
    this.waveScale = 1;
    this.waveTime = 0;
    this.time = 0;

    // direction x, direction z, steepness, wavelength (metres)
    this.waves = (opts.waves ?? [
      [1, 0.15, 0.1, 26],
      [0.75, 0.66, 0.075, 15],
      [-0.6, 0.8, 0.05, 8.5],
      [0.25, -0.97, 0.035, 4.5],
    ]).slice(0, NUM_WAVES);

    const geometry = new THREE.PlaneGeometry(this.extent, this.extent, this.segments, this.segments);

    this.mesh = new GerstnerWater(geometry, {
      textureWidth: opts.reflectionRes ?? 1024,
      textureHeight: opts.reflectionRes ?? 1024,
      waterNormals: assets.waterNormals,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: new THREE.Color(opts.deepColor ?? 0x1d4038),
      distortionScale: 3.4,
      fog: true,
      alpha: 1.0,
      clipBias: 0.0003,
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = this.level;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'water';
    this.mesh.renderOrder = 1;
    this.mesh.material.toneMapped = false; // OutputPass does the tone mapping
    scene.add(this.mesh);

    const u = this.mesh.material.uniforms;
    u.size.value = 4.2;
    u.waterLevel.value = this.level;
    u.flow.value.copy(this.flow);
    this.#uploadWaves();

    // ---- horizon filler -----------------------------------------------------
    this.distant = new THREE.Mesh(
      new THREE.PlaneGeometry(26000, 26000, 1, 1),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(opts.deepColor ?? 0x1d4038),
        roughness: 0.07,
        metalness: 0.0,
        envMapIntensity: 1.1,
      })
    );
    this.distant.rotation.x = -Math.PI / 2;
    this.distant.position.y = this.level - 0.06;
    this.distant.renderOrder = -1;
    scene.add(this.distant);

    // ---- dynamic foam map ---------------------------------------------------
    this.foamRes = opts.foamRes ?? 512;
    this.foamExtent = opts.foamExtent ?? 340;
    this.foamCanvas = document.createElement('canvas');
    this.foamCanvas.width = this.foamCanvas.height = this.foamRes;
    this.foamCtx = this.foamCanvas.getContext('2d', { willReadFrequently: false });
    this.foamCtx.fillStyle = 'rgba(0,0,0,0)';
    this.foamCtx.clearRect(0, 0, this.foamRes, this.foamRes);
    this.foamTexture = new THREE.CanvasTexture(this.foamCanvas);
    this.foamTexture.colorSpace = THREE.NoColorSpace;
    this.foamTexture.minFilter = THREE.LinearFilter;
    this.foamTexture.magFilter = THREE.LinearFilter;
    this.foamTexture.wrapS = this.foamTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.foamOrigin = new THREE.Vector2(-this.foamExtent / 2, -this.foamExtent / 2);
    this.foamDirty = true;
    this._tmpCanvas = document.createElement('canvas');
    this._tmpCanvas.width = this._tmpCanvas.height = this.foamRes;
    u.foamMap.value = this.foamTexture;
    u.foamBounds.value.set(this.foamOrigin.x, this.foamOrigin.y, this.foamExtent, this.foamExtent);

    // Keep the horizon plane (and anything else registered) out of the
    // planar reflection pass.
    this.reflectionExcluded = [this.distant];
    const originalOnBefore = this.mesh.onBeforeRender;
    this.mesh.onBeforeRender = (renderer, scene2, camera) => {
      const states = this.reflectionExcluded.map((o) => o.visible);
      this.reflectionExcluded.forEach((o) => (o.visible = false));
      originalOnBefore.call(this.mesh, renderer, scene2, camera);
      this.reflectionExcluded.forEach((o, i) => (o.visible = states[i]));
    };

    this._snap = this.extent / this.segments;
    this._center = new THREE.Vector2(0, 0);
  }

  get uniforms() {
    return this.mesh.material.uniforms;
  }

  excludeFromReflection(obj) {
    this.reflectionExcluded.push(obj);
  }

  #uploadWaves() {
    const u = this.uniforms;
    for (let i = 0; i < NUM_WAVES; i++) {
      const w = this.waves[i] ?? [1, 0, 0, 10];
      const len = Math.hypot(w[0], w[1]) || 1;
      u.waves.value[i].set(w[0] / len, w[1] / len, w[2], w[3]);
    }
  }

  setWaves(waves, scale = 1) {
    this.waves = waves.slice(0, NUM_WAVES);
    this.waveScale = scale;
    this.#uploadWaves();
    this.uniforms.waveScale.value = scale;
  }

  setFlow(x, z) {
    this.flow.set(x, z);
    this.uniforms.flow.value.copy(this.flow);
  }

  /** Scene-specific look: murky colours, foam width, swell size. */
  configure({
    deepColor,
    shallowColor,
    foamColor,
    foamWidth,
    murk,
    shoreAlpha,
    waveScale,
    waves,
    flow,
    size,
    crestFoam,
  } = {}) {
    const u = this.uniforms;
    if (deepColor !== undefined) {
      u.waterColor.value.setHex(deepColor);
      this.distant.material.color.setHex(deepColor);
    }
    if (shallowColor !== undefined) u.shallowColor.value.setHex(shallowColor);
    if (foamColor !== undefined) u.foamColor.value.setHex(foamColor);
    if (foamWidth !== undefined) u.foamWidth.value = foamWidth;
    if (murk !== undefined) u.murk.value = murk;
    if (shoreAlpha !== undefined) u.shoreAlpha.value = shoreAlpha;
    if (crestFoam !== undefined) u.crestFoam.value = crestFoam;
    if (size !== undefined) u.size.value = size;
    if (waves) this.setWaves(waves, waveScale ?? this.waveScale);
    else if (waveScale !== undefined) {
      this.waveScale = waveScale;
      u.waveScale.value = waveScale;
    }
    if (flow) this.setFlow(flow.x ?? flow[0] ?? 0, flow.z ?? flow[1] ?? 0);
  }

  setDepthMap(texture, bounds, scale) {
    const u = this.uniforms;
    u.depthMap.value = texture;
    u.depthBounds.value.set(bounds.minX, bounds.minZ, bounds.sizeX, bounds.sizeZ);
    u.depthScale.value = scale;
  }

  applySky(preset, sunDir) {
    const u = this.uniforms;
    u.sunDirection.value.copy(sunDir);
    u.sunColor.value.setHex(preset.sunColor);
    u.distortionScale.value = preset.water.distortion;
    u.waterColor.value.setHex(preset.water.color);
    u.shallowColor.value.setHex(preset.water.shallow);
    this.distant.material.color.setHex(preset.water.color);
    this.distant.material.roughness = preset.hdri === 'overcast' ? 0.16 : 0.07;
  }

  setQuality(q) {
    this.mesh.setReflectionSize(q.reflectionRes, q.reflectionRes);
    this.mesh.reflectEveryNFrames = q.reflectEveryNFrames;
  }

  // --------------------------------------------------------------- CPU waves
  /**
   * Same summed-Gerstner evaluation as the vertex shader, used for buoyancy.
   * Returns the surface height and normal at a world xz.
   */
  sample(x, z, out = { height: 0, normal: new THREE.Vector3(), slopeX: 0, slopeZ: 0 }) {
    let dy = 0;
    let tx = 1,
      ty = 0,
      tz = 0;
    let bx = 0,
      by = 0,
      bz = 1;

    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const len = Math.hypot(w[0], w[1]) || 1;
      const dirX = w[0] / len;
      const dirZ = w[1] / len;
      const steepness = w[2] * this.waveScale;
      const wavelength = Math.max(0.5, w[3]);
      const k = (Math.PI * 2) / wavelength;
      const c = Math.sqrt(G / k);
      const a = steepness / k;
      const f = k * (dirX * x + dirZ * z - c * this.waveTime);
      const sinF = Math.sin(f);
      const cosF = Math.cos(f);

      dy += a * sinF;

      tx += -dirX * dirX * steepness * sinF;
      ty += dirX * steepness * cosF;
      tz += -dirX * dirZ * steepness * sinF;

      bx += -dirX * dirZ * steepness * sinF;
      by += dirZ * steepness * cosF;
      bz += -dirZ * dirZ * steepness * sinF;
    }

    // normal = cross(binormal, tangent)
    const nx = by * tz - bz * ty;
    const ny = bz * tx - bx * tz;
    const nz = bx * ty - by * tx;
    const nl = Math.hypot(nx, ny, nz) || 1;

    out.height = this.level + dy;
    out.normal.set(nx / nl, ny / nl, nz / nl);
    out.slopeX = out.normal.x / Math.max(0.2, out.normal.y);
    out.slopeZ = out.normal.z / Math.max(0.2, out.normal.y);
    return out;
  }

  heightAt(x, z) {
    let dy = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const len = Math.hypot(w[0], w[1]) || 1;
      const dirX = w[0] / len;
      const dirZ = w[1] / len;
      const steepness = w[2] * this.waveScale;
      const wavelength = Math.max(0.5, w[3]);
      const k = (Math.PI * 2) / wavelength;
      const c = Math.sqrt(G / k);
      const a = steepness / k;
      dy += a * Math.sin(k * (dirX * x + dirZ * z - c * this.waveTime));
    }
    return this.level + dy;
  }

  // ---------------------------------------------------------------- foam map
  /** Paint churn into the scrolling foam map. radius/strength in metres/0-1. */
  paintFoam(x, z, radius, strength) {
    const px = ((x - this.foamOrigin.x) / this.foamExtent) * this.foamRes;
    const pz = ((z - this.foamOrigin.y) / this.foamExtent) * this.foamRes;
    if (px < -20 || pz < -20 || px > this.foamRes + 20 || pz > this.foamRes + 20) return;
    const pr = Math.max(1.2, (radius / this.foamExtent) * this.foamRes);
    const ctx = this.foamCtx;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(px, pz, 0, px, pz, pr);
    const a = clamp(strength, 0, 1);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - pr, pz - pr, pr * 2, pr * 2);
    this.foamDirty = true;
  }

  #fadeFoam(dt) {
    const ctx = this.foamCtx;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${clamp(dt * 0.42, 0, 0.3)})`;
    ctx.fillRect(0, 0, this.foamRes, this.foamRes);
    ctx.globalCompositeOperation = 'source-over';
    this.foamDirty = true;
  }

  #recenterFoam(cx, cz) {
    const want = new THREE.Vector2(cx - this.foamExtent / 2, cz - this.foamExtent / 2);
    const dx = want.x - this.foamOrigin.x;
    const dz = want.y - this.foamOrigin.y;
    const threshold = this.foamExtent * 0.18;
    if (Math.abs(dx) < threshold && Math.abs(dz) < threshold) return;

    const pxShift = Math.round((dx / this.foamExtent) * this.foamRes);
    const pzShift = Math.round((dz / this.foamExtent) * this.foamRes);
    const tmp = this._tmpCanvas.getContext('2d');
    tmp.clearRect(0, 0, this.foamRes, this.foamRes);
    tmp.drawImage(this.foamCanvas, 0, 0);
    this.foamCtx.clearRect(0, 0, this.foamRes, this.foamRes);
    this.foamCtx.globalCompositeOperation = 'source-over';
    this.foamCtx.drawImage(this._tmpCanvas, -pxShift, -pzShift);

    this.foamOrigin.x += (pxShift / this.foamRes) * this.foamExtent;
    this.foamOrigin.y += (pzShift / this.foamRes) * this.foamExtent;
    this.uniforms.foamBounds.value.set(
      this.foamOrigin.x,
      this.foamOrigin.y,
      this.foamExtent,
      this.foamExtent
    );
    this.foamDirty = true;
  }

  // ------------------------------------------------------------------ update
  update(dt, focus) {
    this.time += dt;
    this.waveTime += dt;
    const u = this.uniforms;
    u.time.value = this.time;
    u.waveTime.value = this.waveTime;

    // Follow the action, snapped to the vertex grid so waves never "swim".
    const sx = Math.round(focus.x / this._snap) * this._snap;
    const sz = Math.round(focus.z / this._snap) * this._snap;
    this.mesh.position.set(sx, this.level, sz);
    this.distant.position.set(sx, this.level - 0.06, sz);
    this._center.set(sx, sz);

    this.#fadeFoam(dt);
    this.#recenterFoam(focus.x, focus.z);
    if (this.foamDirty) {
      this.foamTexture.needsUpdate = true;
      this.foamDirty = false;
    }
  }

  dispose() {
    this.scene.remove(this.mesh, this.distant);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.renderTarget.dispose();
    this.distant.geometry.dispose();
    this.distant.material.dispose();
    this.foamTexture.dispose();
  }
}
