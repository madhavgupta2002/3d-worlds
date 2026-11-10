import * as THREE from 'three';
import { BOAT_BUILDERS } from './boatModels.js';
import { Particles } from './particles.js';
import { clamp, damp, disposeObject, lerp } from './utils.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The boat: hull physics on top of the water's Gerstner surface (buoyancy at
 * four hull points, surge/lateral drag, rudder yaw, planing trim, grounding)
 * plus the effects that sell it — painted wake, spray, prop wash.
 */
export class Boat {
  constructor({ scene, assets, mats, night, water, terrain }) {
    this.scene = scene;
    this.assets = assets;
    this.mats = mats;
    this.night = night;
    this.water = water;
    this.terrain = terrain;

    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.root.name = 'boat';
    scene.add(this.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.heaveVel = 0;
    this.y = 0;
    this.grounded = false;
    this.groundedFor = 0;
    this.distance = 0;
    this.throttle = 0;
    this.steer = 0;
    this.rpm = 0;
    this.events = [];
    this.waterNormal = new THREE.Vector3(0, 1, 0);
    this.topSpeedSeen = 0;

    this._sample = { height: 0, normal: new THREE.Vector3(), slopeX: 0, slopeZ: 0 };
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._lastWaterY = 0;
    this._wakeAccum = 0;
    this._history = [];
    this._propSpin = 0;

    this.spray = new Particles(scene, {
      texture: assets.proc.spark,
      max: 520,
      size: 0.5,
      gravity: -11,
      drag: 1.3,
      color: 0xffffff,
      opacity: 0.85,
      name: 'spray',
    });
    this.mist = new Particles(scene, {
      texture: assets.proc.foam,
      max: 220,
      size: 1.5,
      gravity: -0.4,
      drag: 1.9,
      color: 0xdfeae6,
      opacity: 0.4,
      killBelowWater: false,
      name: 'propwash',
    });
    water.excludeFromReflection(this.spray.points);
    water.excludeFromReflection(this.mist.points);

    this.setKind('speedboat');
  }

  // ------------------------------------------------------------------- model
  setKind(kind) {
    if (this.model) {
      this.root.remove(this.model);
      disposeObject(this.model);
    }
    const build = BOAT_BUILDERS[kind] ?? BOAT_BUILDERS.speedboat;
    const { group, spec } = build({ mats: this.mats, night: this.night });
    this.model = group;
    this.spec = spec;
    this.kind = kind;
    this.root.add(group);

    this.helmAnchor = new THREE.Object3D();
    this.helmAnchor.position.copy(spec.helm);
    group.add(this.helmAnchor);
    this.chaseAnchor = new THREE.Object3D();
    this.chaseAnchor.position.copy(spec.chase);
    group.add(this.chaseAnchor);
    this.deckAnchor = new THREE.Object3D();
    this.deckAnchor.position.set(0, spec.deck + 0.3, -spec.length * 0.1);
    group.add(this.deckAnchor);

    this.dragCoef = spec.thrust / (spec.mass * spec.maxSpeed * spec.maxSpeed);
    this.spray.setWaterLevel(this.water.level);
    this.mist.setWaterLevel(this.water.level - 0.3);
    return this;
  }

  spawn(x, z, heading = 0) {
    this.pos.set(x, this.water.level, z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.heaveVel = 0;
    this.y = this.water.level;
    this.grounded = false;
    this._history.length = 0;
    this.#applyTransform();
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get speedKmh() {
    return this.speed * 3.6;
  }
  get speedKnots() {
    return this.speed * 1.94384;
  }

  forward(out = this._fwd) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }
  right(out = this._right) {
    return out.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }

  // ------------------------------------------------------------------ physics
  update(dt, input) {
    const spec = this.spec;
    const water = this.water;

    const throttleTarget = clamp(input.throttle ?? 0, -1, 1);
    this.throttle = damp(this.throttle, throttleTarget, 3.2, dt);
    this.steer = damp(this.steer, clamp(input.steer ?? 0, -1, 1), 7, dt);

    const fwd = this.forward();
    const right = this.right();

    // ---- hull sampling: four points give us heave, pitch and roll ----------
    const halfL = spec.length * 0.46;
    const halfB = spec.beam * 0.95;
    const sampleAt = (dx, dz) => {
      this._tmp
        .copy(this.pos)
        .addScaledVector(fwd, dz)
        .addScaledVector(right, dx);
      return water.heightAt(this._tmp.x, this._tmp.z);
    };
    const hBow = sampleAt(0, halfL);
    const hStern = sampleAt(0, -halfL);
    const hPort = sampleAt(-halfB, 0);
    const hStbd = sampleAt(halfB, 0);
    water.sample(this.pos.x, this.pos.z, this._sample);
    this.waterNormal.copy(this._sample.normal);
    const waterY = (hBow + hStern + hPort + hStbd) * 0.25;

    // ---- surge / drag -----------------------------------------------------
    const flowX = water.flow.x;
    const flowZ = water.flow.y;
    const relX = this.vel.x - flowX;
    const relZ = this.vel.z - flowZ;
    const fwdSpeed = relX * fwd.x + relZ * fwd.z;
    const latSpeed = relX * right.x + relZ * right.z;

    const throttleSign = this.throttle >= 0 ? 1 : -spec.reverse;
    const thrustAccel = (spec.thrust * this.throttle * (this.throttle >= 0 ? 1 : spec.reverse)) / spec.mass;
    const brake = input.brake ? 2.6 : 0;

    let aFwd = thrustAccel - this.dragCoef * fwdSpeed * Math.abs(fwdSpeed) - brake * fwdSpeed;
    let aLat = -this.dragCoef * 11 * latSpeed * Math.abs(latSpeed) - 1.8 * latSpeed;

    // waves push the hull down their faces
    const slopeAccel = 9.81 * 0.22;
    const aWaveX = -this._sample.slopeX * slopeAccel;
    const aWaveZ = -this._sample.slopeZ * slopeAccel;

    this.vel.x += (aFwd * fwd.x + aLat * right.x + aWaveX) * dt;
    this.vel.z += (aFwd * fwd.z + aLat * right.z + aWaveZ) * dt;

    // river current drags the hull along
    this.vel.x += (flowX - this.vel.x) * 0.25 * dt;
    this.vel.z += (flowZ - this.vel.z) * 0.25 * dt;

    // ---- rudder -----------------------------------------------------------
    const steerAuthority = clamp(Math.abs(fwdSpeed) / 2.6, 0, 1);
    const dirSign = fwdSpeed >= -0.1 ? 1 : -1;
    const targetYaw = this.steer * spec.turn * steerAuthority * dirSign;
    this.yawRate = damp(this.yawRate, targetYaw, 4.0, dt);
    this.heading += this.yawRate * dt;

    // ---- grounding --------------------------------------------------------
    const depth = this.terrain.depth(this.pos.x, this.pos.z);
    const clearance = depth - spec.draft;
    if (clearance < 0.12) {
      const wasGrounded = this.grounded;
      this.grounded = true;
      this.groundedFor += dt;
      // slide back toward deeper water
      const gx = this.terrain.depth(this.pos.x + 2, this.pos.z) - this.terrain.depth(this.pos.x - 2, this.pos.z);
      const gz = this.terrain.depth(this.pos.x, this.pos.z + 2) - this.terrain.depth(this.pos.x, this.pos.z - 2);
      const gl = Math.hypot(gx, gz) || 1;
      const push = clamp(-clearance, 0, 1.5) * 4.5;
      this.vel.x += (gx / gl) * push * dt;
      this.vel.z += (gz / gl) * push * dt;
      const sp = this.speed;
      const decel = Math.exp(-5.5 * dt);
      this.vel.x *= decel;
      this.vel.z *= decel;
      if (!wasGrounded && sp > 1.2) {
        this.events.push({ type: 'ground', intensity: clamp(sp / 8, 0.2, 1) });
        this.#splash(this.pos.x, this.pos.y, this.pos.z, clamp(sp * 3, 4, 26), 1.1);
      }
    } else {
      this.grounded = false;
      this.groundedFor = 0;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.distance += this.speed * dt;
    this.topSpeedSeen = Math.max(this.topSpeedSeen, this.speed);

    // keep inside the map
    const limit = this.terrain.half - 12;
    this.pos.x = clamp(this.pos.x, -limit, limit);
    this.pos.z = clamp(this.pos.z, -limit, limit);

    // ---- heave / attitude -------------------------------------------------
    const speed = this.speed;
    const planing = clamp(speed / Math.max(2, spec.maxSpeed * 0.55), 0, 1);
    const ride = planing * 0.14 + 0.02;
    const targetY = waterY + ride;
    const stiffness = 46;
    const damping = 9.2;
    this.heaveVel += ((targetY - this.y) * stiffness - this.heaveVel * damping) * dt;
    this.y += this.heaveVel * dt;

    // hull slap when the boat lands harder than the water is moving
    const waterVel = (waterY - this._lastWaterY) / Math.max(dt, 1e-4);
    const impact = waterVel - this.heaveVel;
    if (impact > 2.1 && speed > 1.0) {
      this.events.push({ type: 'slap', intensity: clamp(impact / 7, 0.15, 1) });
      this.#splash(this.pos.x, this.y, this.pos.z, clamp(impact * 2.2, 3, 18), 0.8);
    }
    this._lastWaterY = waterY;

    const pitchFromWaves = Math.atan2(hBow - hStern, halfL * 2);
    const trim = planing * spec.trimFactor * 2.6 + clamp(aFwd, -4, 6) * spec.trimFactor * 0.1;
    const targetPitch = -(pitchFromWaves + trim);
    this.pitch = damp(this.pitch, targetPitch, 7, dt);

    const rollFromWaves = Math.atan2(hStbd - hPort, halfB * 2);
    const heel = -spec.heelFactor * this.yawRate * clamp(speed, 0, spec.maxSpeed) * 0.055;
    const targetRoll = rollFromWaves + heel;
    this.roll = damp(this.roll, targetRoll, 6, dt);

    this.#applyTransform();

    // ---- drivetrain animation --------------------------------------------
    this.rpm = clamp(Math.abs(this.throttle) * 0.75 + (speed / spec.maxSpeed) * 0.35, 0, 1);
    if (this.spec.prop) {
      this._propSpin += (2 + this.rpm * 46) * dt;
      this.spec.prop.rotation.z = this._propSpin;
    }
    if (this.spec.wheel) this.spec.wheel.rotation.y = -this.steer * 1.6;
    if (this.spec.oars) {
      const t = performance.now() * 0.001;
      const stroke = Math.sin(t * Math.max(0.6, 1.5 + this.throttle * 2)) * clamp(Math.abs(this.throttle), 0, 1);
      this.spec.oars.forEach((oar, i) => {
        if (!oar) return;
        const s = i === 0 ? 1 : -1;
        oar.rotation.x = stroke * 0.5;
        oar.rotation.y = s * (0.25 + stroke * 0.25);
      });
    }
    if (this.spec.engineTilt) {
      this.spec.engineTilt.rotation.y = -this.steer * 0.45;
    }
    if (this.spec.flag) {
      this.spec.flag.rotation.y = Math.sin(performance.now() * 0.004) * 0.25;
    }

    // ---- wake + spray -----------------------------------------------------
    this.#wake(dt, speed, fwd, right);
    this.#sprayUpdate(dt, speed, planing, fwd, right);
    this.spray.update(dt);
    this.mist.update(dt);
  }

  #applyTransform() {
    this.root.position.set(this.pos.x, this.y, this.pos.z);
    this.root.rotation.y = this.heading;
    this.root.rotation.x = this.pitch;
    this.root.rotation.z = this.roll;
  }

  // -------------------------------------------------------------------- wake
  #wake(dt, speed, fwd, right) {
    const water = this.water;
    const spec = this.spec;
    const sternX = this.pos.x - fwd.x * spec.length * 0.46;
    const sternZ = this.pos.z - fwd.z * spec.length * 0.46;
    const speedN = clamp(speed / spec.maxSpeed, 0, 1);

    // prop churn right behind the transom
    if (speed > 0.2 || Math.abs(this.throttle) > 0.05) {
      water.paintFoam(sternX, sternZ, 1.4 + spec.beam * 1.2, (0.12 + speedN * 0.5) * clamp(dt * 60, 0, 2));
    }

    // history trail → the diverging V
    const now = water.time;
    if (speed > 0.35) {
      const last = this._history[this._history.length - 1];
      if (!last || Math.hypot(last.x - this.pos.x, last.z - this.pos.z) > 1.1) {
        this._history.push({
          x: sternX,
          z: sternZ,
          rx: right.x,
          rz: right.z,
          t: now,
          speed,
        });
        if (this._history.length > 46) this._history.shift();
      }
    }
    while (this._history.length && now - this._history[0].t > 7) this._history.shift();

    const ctx = water.foamCtx;
    const res = water.foamRes;
    const originX = water.foamOrigin.x;
    const originZ = water.foamOrigin.y;
    const scale = res / water.foamExtent;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    for (let i = this._history.length - 1; i >= 0; i -= 2) {
      const h = this._history[i];
      const age = now - h.t;
      if (age > 6.5) continue;
      const spread = spec.beam * 0.9 + age * h.speed * 0.26;
      const fade = Math.max(0, 1 - age / 6.5);
      const alpha = 0.035 * fade * clamp(h.speed / spec.maxSpeed, 0.15, 1) * clamp(dt * 60, 0.4, 2);
      if (alpha < 0.002) continue;
      const rad = (0.55 + age * 0.42) * scale;
      ctx.globalAlpha = alpha;
      for (const sign of [-1, 1]) {
        const wx = h.x + h.rx * spread * sign;
        const wz = h.z + h.rz * spread * sign;
        const px = (wx - originX) * scale;
        const pz = (wz - originZ) * scale;
        if (px < -rad || pz < -rad || px > res + rad || pz > res + rad) continue;
        ctx.beginPath();
        ctx.arc(px, pz, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    water.foamDirty = true;
  }

  // ------------------------------------------------------------------- spray
  #sprayUpdate(dt, speed, planing, fwd, right) {
    const spec = this.spec;
    const speedN = clamp(speed / spec.maxSpeed, 0, 1);

    // bow spray: scales hard with speed
    const rate = speedN * speedN * 110 * (0.4 + planing);
    this._wakeAccum += rate * dt;
    const bowX = this.pos.x + fwd.x * spec.length * 0.44;
    const bowZ = this.pos.z + fwd.z * spec.length * 0.44;
    while (this._wakeAccum >= 1) {
      this._wakeAccum -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const sx = bowX + right.x * side * spec.beam * 0.8 + (Math.random() - 0.5) * 0.3;
      const sz = bowZ + right.z * side * spec.beam * 0.8 + (Math.random() - 0.5) * 0.3;
      const out = 1.6 + speed * 0.22;
      this.spray.spawn(
        sx,
        this.y + 0.1,
        sz,
        right.x * side * out + fwd.x * speed * 0.35 + (Math.random() - 0.5),
        1.6 + Math.random() * 2.4 + speed * 0.12,
        right.z * side * out + fwd.z * speed * 0.35 + (Math.random() - 0.5),
        0.5 + Math.random() * 0.6,
        0.5 + Math.random() * 0.9
      );
    }

    // prop wash mist behind the transom
    if (Math.abs(this.throttle) > 0.08 && Math.random() < 0.9) {
      const sx = this.pos.x - fwd.x * spec.length * 0.5;
      const sz = this.pos.z - fwd.z * spec.length * 0.5;
      this.mist.spawn(
        sx + (Math.random() - 0.5) * spec.beam,
        this.water.level + 0.08,
        sz + (Math.random() - 0.5) * spec.beam,
        -fwd.x * (0.8 + speed * 0.1) + (Math.random() - 0.5) * 0.6,
        0.25 + Math.random() * 0.4,
        -fwd.z * (0.8 + speed * 0.1) + (Math.random() - 0.5) * 0.6,
        0.7 + Math.random() * 0.8,
        1.2 + Math.random() * 1.6
      );
    }
  }

  #splash(x, y, z, count, power) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.2 + 0.3;
      this.spray.spawn(
        x + Math.cos(a) * r,
        y + 0.1,
        z + Math.sin(a) * r,
        Math.cos(a) * (1.2 + Math.random() * 2.2) * power,
        1.8 + Math.random() * 3.4 * power,
        Math.sin(a) * (1.2 + Math.random() * 2.2) * power,
        0.5 + Math.random() * 0.7,
        0.6 + Math.random() * 1.1
      );
    }
    this.water.paintFoam(x, z, 2.2 * power, 0.5);
  }

  consumeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  dispose() {
    this.scene.remove(this.root);
    if (this.model) disposeObject(this.model);
    this.spray.dispose();
    this.mist.dispose();
  }
}
