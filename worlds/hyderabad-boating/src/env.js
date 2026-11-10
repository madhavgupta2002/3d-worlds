import * as THREE from 'three';
import { SKY_PRESETS, sunDirection } from './assets.js';
import { damp } from './utils.js';

/**
 * Sky, sun, ambient fill, haze and exposure. One directional light with a
 * shadow camera that follows the boat (cheap single-cascade shadows).
 */
export class Environment {
  constructor(scene, renderer, assets) {
    this.scene = scene;
    this.renderer = renderer;
    this.assets = assets;
    this.presetName = 'day';
    this.preset = SKY_PRESETS.day;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.listeners = new Set();
    this.shadowRadius = 150;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.sun.target = new THREE.Object3D();
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4e6, 0x4a4433, 0.35);
    scene.add(this.hemi);

    // Warm bounce from the sunlit haze — fakes a bit of GI off the water.
    this.bounce = new THREE.DirectionalLight(0xffe2b0, 0.25);
    this.bounce.position.set(-0.4, -0.6, 0.3);
    scene.add(this.bounce);

    scene.fog = new THREE.FogExp2(0xb9c9d4, 0.0016);
    this.setShadowRadius(this.shadowRadius);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get isNight() {
    return this.presetName === 'night';
  }

  get nightFactor() {
    return this.presetName === 'night' ? 1 : this.presetName === 'sunset' ? 0.45 : 0;
  }

  setShadowRadius(r) {
    this.shadowRadius = r;
    const c = this.sun.shadow.camera;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.updateProjectionMatrix();
  }

  async setPreset(name) {
    const preset = SKY_PRESETS[name];
    if (!preset) return;
    this.presetName = name;
    this.preset = preset;

    const { envMap, background } = await this.assets.env(preset.hdri);
    this.scene.environment = envMap;
    this.scene.background = background;
    this.scene.environmentIntensity = preset.envIntensity;
    this.scene.backgroundIntensity = preset.envIntensity * 0.95;

    sunDirection(preset, this.sunDir);
    this.sun.color.setHex(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.hemi.intensity = preset.ambient;
    this.hemi.color.setHex(this.isNight ? 0x24344f : 0xbcd4e6);
    this.bounce.intensity = this.isNight ? 0.05 : 0.25;
    this.bounce.color.setHex(this.isNight ? 0x4a5f8a : 0xffe2b0);

    this.scene.fog.color.setHex(preset.fog.color);
    this.scene.fog.density = preset.fog.density;
    this.renderer.toneMappingExposure = preset.exposure;

    for (const fn of this.listeners) fn(this);
  }

  /** Keep the shadow frustum (and sun position) centred on the action. */
  update(dt, focus) {
    const d = this.shadowRadius * 2.2;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, d);
    this.hemi.position.copy(focus);
  }

  /** Smooth exposure changes (used by photo mode / underwater dips). */
  nudgeExposure(target, dt, speed = 4) {
    this.renderer.toneMappingExposure = damp(
      this.renderer.toneMappingExposure,
      target,
      speed,
      dt
    );
  }
}
