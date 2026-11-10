import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, damp, lerp, TAU } from './utils.js';

export const CAMERA_MODES = ['chase', 'helm', 'orbit', 'cinematic', 'fly'];
export const CAMERA_LABELS = {
  chase: 'Chase',
  helm: 'At the helm',
  orbit: 'Orbit',
  cinematic: 'Cinematic',
  fly: 'Free fly',
};

/**
 * Camera rig: chase spring, first-person helm, orbit, a self-directing
 * cinematic mode, and a free-fly camera for sightseeing. Keeps the camera out
 * of the water and out of the hillsides.
 */
export class CameraRig {
  constructor(camera, { boat, water, terrain, domElement }) {
    this.camera = camera;
    this.boat = boat;
    this.water = water;
    this.terrain = terrain;
    this.mode = 'chase';

    this.yawOffset = 0;
    this.pitchOffset = 0;
    this.zoom = 1;
    this.shake = 0;

    this.pos = new THREE.Vector3(0, 6, -12);
    this.look = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qLocal = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.enabled = false;

    this.flyPos = new THREE.Vector3(0, 20, -40);
    this.flyYaw = 0;
    this.flyPitch = -0.2;

    this.cineTimer = 0;
    this.cineShot = null;
    this.pois = [];
    this.targetFov = 62;
  }

  setPointsOfInterest(pois) {
    this.pois = pois;
  }

  setMode(mode) {
    if (!CAMERA_MODES.includes(mode)) return;
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      const b = this.boat.root.position;
      this.controls.target.copy(b);
      this.camera.position.copy(b).add(new THREE.Vector3(12, 8, -14));
      this.controls.update();
    }
    if (mode === 'fly') {
      this.flyPos.copy(this.camera.position);
      const dir = this.camera.getWorldDirection(this._tmp);
      this.flyYaw = Math.atan2(dir.x, dir.z);
      this.flyPitch = Math.asin(clamp(dir.y, -1, 1));
    }
    if (mode === 'cinematic') this.cineTimer = 0;
    this.targetFov = mode === 'cinematic' ? 44 : mode === 'helm' ? 72 : 62;
  }

  cycle() {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  update(dt, input) {
    const boat = this.boat;
    const camera = this.camera;

    if (this.mode !== 'orbit') {
      this.yawOffset -= input.lookDx * 0.0032;
      this.pitchOffset = clamp(this.pitchOffset - input.lookDy * 0.0028, -1.1, 1.0);
      this.zoom = clamp(this.zoom + input.zoom * 0.08, 0.45, 3.0);
    }

    switch (this.mode) {
      case 'chase':
        this.#chase(dt);
        break;
      case 'helm':
        this.#helm(dt);
        break;
      case 'orbit':
        this.controls.target.lerp(boat.root.position, 1 - Math.exp(-6 * dt));
        this.controls.update();
        break;
      case 'cinematic':
        this.#cinematic(dt);
        break;
      case 'fly':
        this.#fly(dt, input);
        break;
    }

    // camera shake from impacts
    if (this.shake > 0.001 && this.mode !== 'orbit') {
      const s = this.shake;
      camera.position.x += (Math.random() - 0.5) * s * 0.26;
      camera.position.y += (Math.random() - 0.5) * s * 0.22;
      camera.position.z += (Math.random() - 0.5) * s * 0.26;
      this.shake = damp(this.shake, 0, 5.5, dt);
    }

    // never dunk the camera or bury it in a hillside
    if (this.mode !== 'fly') {
      const minWater = this.water.heightAt(camera.position.x, camera.position.z) + 0.45;
      const minGround = this.terrain.height(camera.position.x, camera.position.z) + 0.6;
      camera.position.y = Math.max(camera.position.y, minWater, minGround);
    }

    if (Math.abs(camera.fov - this.targetFov) > 0.01) {
      camera.fov = damp(camera.fov, this.targetFov, 4, dt);
      camera.updateProjectionMatrix();
    }
  }

  #chase(dt) {
    const boat = this.boat;
    const spec = boat.spec;
    const speedN = clamp(boat.speed / spec.maxSpeed, 0, 1);
    const dist = -spec.chase.z * this.zoom * (1 + speedN * 0.18);
    const height = spec.chase.y * this.zoom * (1 - speedN * 0.1);

    const yaw = boat.heading + this.yawOffset;
    const pitch = this.pitchOffset;
    const horiz = Math.cos(pitch);
    this._desired.set(
      boat.root.position.x - Math.sin(yaw) * dist * horiz,
      boat.root.position.y + height + Math.sin(pitch) * dist + 0.4,
      boat.root.position.z - Math.cos(yaw) * dist * horiz
    );

    const follow = 1 - Math.exp(-(3.2 + speedN * 3.5) * dt);
    this.camera.position.lerp(this._desired, follow);

    // look a little ahead of the bow so fast runs feel fast
    this._tmp
      .copy(boat.root.position)
      .add(this._tmp2.set(Math.sin(boat.heading), 0, Math.cos(boat.heading)).multiplyScalar(4 + speedN * 14));
    this._tmp.y = boat.root.position.y + 1.3;
    this.look.lerp(this._tmp, 1 - Math.exp(-5 * dt));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.camera.rotation.z += boat.roll * 0.12;
    this.targetFov = 62 + speedN * 8;
  }

  #helm(dt) {
    const boat = this.boat;
    boat.helmAnchor.getWorldPosition(this.camera.position);
    boat.model.getWorldQuaternion(this._q);
    this._e.set(this.pitchOffset, this.yawOffset, 0);
    this._qLocal.setFromEuler(this._e);
    this.camera.quaternion.copy(this._q).multiply(this._qLocal);
    this.targetFov = 72 + clamp(boat.speed / boat.spec.maxSpeed, 0, 1) * 6;
  }

  #fly(dt, input) {
    this.flyYaw -= input.lookDx * 0.0032;
    this.flyPitch = clamp(this.flyPitch - input.lookDy * 0.0028, -1.45, 1.45);
    const speed = (input.boost ? 70 : 22) * dt;
    const fwd = this._tmp.set(
      Math.sin(this.flyYaw) * Math.cos(this.flyPitch),
      Math.sin(this.flyPitch),
      Math.cos(this.flyYaw) * Math.cos(this.flyPitch)
    );
    const right = this._tmp2.set(Math.cos(this.flyYaw), 0, -Math.sin(this.flyYaw));
    if (input.throttle) this.flyPos.addScaledVector(fwd, speed * input.throttle);
    if (input.steer) this.flyPos.addScaledVector(right, speed * input.steer);
    if (input.up) this.flyPos.y += speed;
    if (input.down) this.flyPos.y -= speed;
    this.flyPos.y = Math.max(this.flyPos.y, this.terrain.height(this.flyPos.x, this.flyPos.z) + 1.2, 0.6);
    this.camera.position.copy(this.flyPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(
      this.flyPos.x + fwd.x * 10,
      this.flyPos.y + fwd.y * 10,
      this.flyPos.z + fwd.z * 10
    );
    this.targetFov = 66;
  }

  #cinematic(dt) {
    const boat = this.boat;
    this.cineTimer -= dt;
    if (this.cineTimer <= 0 || !this.cineShot) this.#newShot();
    const shot = this.cineShot;
    const b = boat.root.position;

    switch (shot.kind) {
      case 'orbit': {
        shot.angle += shot.speed * dt;
        this._desired.set(
          b.x + Math.cos(shot.angle) * shot.radius,
          b.y + shot.height,
          b.z + Math.sin(shot.angle) * shot.radius
        );
        this.camera.position.lerp(this._desired, 1 - Math.exp(-3 * dt));
        this.look.lerp(b, 1 - Math.exp(-4 * dt));
        this.targetFov = 42;
        break;
      }
      case 'flyby': {
        // static low camera; the boat sweeps past it
        this.camera.position.lerp(shot.point, 1 - Math.exp(-1.6 * dt));
        this.look.lerp(b, 1 - Math.exp(-3 * dt));
        this.targetFov = 38;
        break;
      }
      case 'drone': {
        shot.angle += shot.speed * dt;
        this._desired.set(
          b.x - Math.sin(boat.heading) * shot.radius + Math.cos(shot.angle) * 6,
          b.y + shot.height,
          b.z - Math.cos(boat.heading) * shot.radius + Math.sin(shot.angle) * 6
        );
        this.camera.position.lerp(this._desired, 1 - Math.exp(-2.2 * dt));
        this._tmp.copy(b);
        this._tmp.y += 1.0;
        this.look.lerp(this._tmp, 1 - Math.exp(-3.5 * dt));
        this.targetFov = 50;
        break;
      }
      case 'landmark': {
        this._desired.copy(shot.point);
        this.camera.position.lerp(this._desired, 1 - Math.exp(-1.2 * dt));
        this.look.lerp(b, 1 - Math.exp(-2.5 * dt));
        this.targetFov = 46;
        break;
      }
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
  }

  #newShot() {
    const boat = this.boat;
    const b = boat.root.position;
    const kinds = ['orbit', 'flyby', 'drone'];
    if (this.pois.length) kinds.push('landmark', 'landmark');
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    this.cineTimer = 9 + Math.random() * 7;

    if (kind === 'orbit') {
      this.cineShot = {
        kind,
        angle: Math.random() * TAU,
        radius: 14 + Math.random() * 26,
        height: 3 + Math.random() * 12,
        speed: (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.1),
      };
    } else if (kind === 'flyby') {
      const ahead = 26 + Math.random() * 30;
      const side = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 14);
      const point = new THREE.Vector3(
        b.x + Math.sin(boat.heading) * ahead + Math.cos(boat.heading) * side,
        this.water.level + 0.8 + Math.random() * 2.2,
        b.z + Math.cos(boat.heading) * ahead - Math.sin(boat.heading) * side
      );
      this.cineShot = { kind, point };
      this.camera.position.copy(point);
      this.cineTimer = 7 + Math.random() * 4;
    } else if (kind === 'drone') {
      this.cineShot = {
        kind,
        radius: 12 + Math.random() * 10,
        height: 6 + Math.random() * 10,
        angle: Math.random() * TAU,
        speed: 0.12,
      };
    } else {
      const poi = this.pois[Math.floor(Math.random() * this.pois.length)];
      const dir = new THREE.Vector3(b.x - poi.x, 0, b.z - poi.z).normalize();
      const point = new THREE.Vector3(
        poi.x + dir.x * 18,
        (poi.y ?? this.water.level) + 8 + Math.random() * 14,
        poi.z + dir.z * 18
      );
      this.cineShot = { kind: 'landmark', point };
      this.cineTimer = 8 + Math.random() * 5;
    }
  }
}
