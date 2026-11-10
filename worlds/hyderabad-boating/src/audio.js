import { clamp, lerp } from './utils.js';

/**
 * Everything you hear is synthesised at runtime — outboard engine, water
 * rush, hull slaps, cicadas, birds, distant traffic and temple bells. No
 * audio files to download, and the engine note tracks the throttle exactly.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volume = 0.7;
    this.ambience = { traffic: 0, birds: 0.4, cicadas: 0, temple: 0, wind: 0.3, lapping: 0.5 };
    this._birdTimer = 2;
    this._bellTimer = 25;
    this._hornTimer = 14;
  }

  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // gentle limiter so engine + splashes never clip
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 6;
    this.comp.connect(this.master);

    this.noiseBuffer = this.#makeNoise(3);

    // ---- engine ---------------------------------------------------------
    this.engine = {};
    const e = this.engine;
    e.gain = ctx.createGain();
    e.gain.gain.value = 0;
    e.filter = ctx.createBiquadFilter();
    e.filter.type = 'lowpass';
    e.filter.frequency.value = 500;
    e.filter.Q.value = 2;
    e.gain.connect(e.filter);
    e.filter.connect(this.comp);

    e.osc1 = ctx.createOscillator();
    e.osc1.type = 'sawtooth';
    e.osc1.frequency.value = 44;
    e.osc2 = ctx.createOscillator();
    e.osc2.type = 'square';
    e.osc2.frequency.value = 88;
    e.osc3 = ctx.createOscillator();
    e.osc3.type = 'sawtooth';
    e.osc3.frequency.value = 22;
    e.g1 = ctx.createGain();
    e.g1.gain.value = 0.5;
    e.g2 = ctx.createGain();
    e.g2.gain.value = 0.16;
    e.g3 = ctx.createGain();
    e.g3.gain.value = 0.3;
    e.osc1.connect(e.g1).connect(e.gain);
    e.osc2.connect(e.g2).connect(e.gain);
    e.osc3.connect(e.g3).connect(e.gain);

    e.rough = ctx.createBufferSource();
    e.rough.buffer = this.noiseBuffer;
    e.rough.loop = true;
    e.roughFilter = ctx.createBiquadFilter();
    e.roughFilter.type = 'bandpass';
    e.roughFilter.frequency.value = 180;
    e.roughFilter.Q.value = 0.9;
    e.roughGain = ctx.createGain();
    e.roughGain.gain.value = 0.25;
    e.rough.connect(e.roughFilter).connect(e.roughGain).connect(e.gain);

    e.osc1.start();
    e.osc2.start();
    e.osc3.start();
    e.rough.start();

    // ---- water rush -----------------------------------------------------
    this.water = {};
    const w = this.water;
    w.src = ctx.createBufferSource();
    w.src.buffer = this.noiseBuffer;
    w.src.loop = true;
    w.filter = ctx.createBiquadFilter();
    w.filter.type = 'bandpass';
    w.filter.frequency.value = 500;
    w.filter.Q.value = 0.7;
    w.gain = ctx.createGain();
    w.gain.gain.value = 0;
    w.src.connect(w.filter).connect(w.gain).connect(this.comp);
    w.src.start();

    // ---- lapping / ambient water ---------------------------------------
    this.lapping = this.#noiseLoop({ type: 'lowpass', freq: 420, q: 0.6, gain: 0.05 });
    this.#lfo(this.lapping.gain.gain, 0.19, 0.035, 0.05);

    // ---- wind -----------------------------------------------------------
    this.wind = this.#noiseLoop({ type: 'highpass', freq: 520, q: 0.4, gain: 0.03 });
    this.#lfo(this.wind.filter.frequency, 0.07, 240, 700);

    // ---- distant city traffic ------------------------------------------
    this.traffic = this.#noiseLoop({ type: 'lowpass', freq: 220, q: 0.5, gain: 0.0 });
    this.#lfo(this.traffic.gain.gain, 0.05, 0.012, 0.03);

    // ---- cicadas --------------------------------------------------------
    this.cicada = {};
    const c = this.cicada;
    c.gain = ctx.createGain();
    c.gain.gain.value = 0;
    c.band = ctx.createBiquadFilter();
    c.band.type = 'bandpass';
    c.band.frequency.value = 4800;
    c.band.Q.value = 6;
    c.src = ctx.createBufferSource();
    c.src.buffer = this.noiseBuffer;
    c.src.loop = true;
    c.trem = ctx.createGain();
    c.trem.gain.value = 0.5;
    const tremOsc = ctx.createOscillator();
    tremOsc.type = 'sine';
    tremOsc.frequency.value = 42;
    const tremAmt = ctx.createGain();
    tremAmt.gain.value = 0.5;
    tremOsc.connect(tremAmt).connect(c.trem.gain);
    tremOsc.start();
    c.src.connect(c.band).connect(c.trem).connect(c.gain).connect(this.comp);
    c.src.start();

    this.ready = true;
  }

  #makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = white * 0.6 + last * 2.4;
    }
    return buf;
  }

  #noiseLoop({ type, freq, q, gain }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.comp);
    src.start();
    return { src, filter, gain: g };
  }

  #lfo(param, rate, depth, base) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = rate;
    const amp = ctx.createGain();
    amp.gain.value = depth;
    osc.connect(amp).connect(param);
    param.value = base;
    osc.start();
    return osc;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  setAmbience(a) {
    Object.assign(this.ambience, a);
  }

  setBoat(spec) {
    this.boatSpec = spec;
  }

  /** Per-frame: engine note, water rush, ambience beds, random one-shots. */
  update(dt, state) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const spec = state.spec;
    const speedN = clamp(state.speed / Math.max(1, spec.maxSpeed), 0, 1);
    const eng = spec.engine ?? { type: 'outboard', idle: 44, rev: 220 };

    // --- engine ---
    const e = this.engine;
    if (eng.type === 'oars' || eng.type === 'pedal') {
      e.gain.gain.setTargetAtTime(0.0, now, 0.2);
    } else {
      const rpm = clamp(state.rpm, 0, 1);
      const f = lerp(eng.idle, eng.rev, Math.pow(rpm, 0.85));
      e.osc1.frequency.setTargetAtTime(f, now, 0.08);
      e.osc2.frequency.setTargetAtTime(f * 2.02, now, 0.08);
      e.osc3.frequency.setTargetAtTime(f * 0.5, now, 0.1);
      e.filter.frequency.setTargetAtTime(380 + rpm * 2600, now, 0.12);
      e.roughGain.gain.setTargetAtTime(0.1 + (eng.growl ?? 0.4) * rpm * 0.5, now, 0.15);
      const vol = (0.05 + rpm * 0.3) * (state.grounded ? 0.6 : 1);
      e.gain.gain.setTargetAtTime(vol, now, 0.12);
    }

    // --- water rush over the hull ---
    const w = this.water;
    w.filter.frequency.setTargetAtTime(380 + speedN * 1500, now, 0.12);
    w.gain.gain.setTargetAtTime(speedN * speedN * 0.38, now, 0.1);

    // --- ambience beds ---
    const amb = this.ambience;
    this.traffic.gain.gain.setTargetAtTime(amb.traffic * 0.05, now, 0.6);
    this.cicada.gain.gain.setTargetAtTime(amb.cicadas * 0.035, now, 0.8);
    this.wind.gain.gain.setTargetAtTime(0.012 + amb.wind * 0.03, now, 0.6);
    this.lapping.gain.gain.setTargetAtTime(0.02 + amb.lapping * 0.05, now, 0.6);

    // --- random one-shots ---
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 1.4 + Math.random() * 7 / Math.max(0.15, amb.birds);
      if (amb.birds > 0.05) this.#chirp(amb.birds);
    }
    this._bellTimer -= dt;
    if (this._bellTimer <= 0) {
      this._bellTimer = 45 + Math.random() * 70;
      if (amb.temple > 0.05) this.#bell(amb.temple);
    }
    this._hornTimer -= dt;
    if (this._hornTimer <= 0) {
      this._hornTimer = 7 + Math.random() * 22;
      if (amb.traffic > 0.15) this.#carHorn(amb.traffic);
    }

    if (eng.type === 'oars' || eng.type === 'pedal') {
      this._strokeTimer = (this._strokeTimer ?? 0) - dt * (0.6 + Math.abs(state.throttle) * 1.6);
      if (this._strokeTimer <= 0 && Math.abs(state.throttle) > 0.1) {
        this._strokeTimer = 1.0;
        this.#splash(0.25 + Math.abs(state.throttle) * 0.3);
      }
    }
  }

  event(type, intensity = 0.5) {
    if (!this.ready) return;
    if (type === 'slap') this.#splash(0.3 + intensity * 0.7);
    else if (type === 'ground') this.#thud(intensity);
    else if (type === 'horn') this.#boatHorn();
  }

  #splash(amount) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900 + Math.random() * 500, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.35);
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(clamp(amount, 0, 1) * 0.5, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.42);
    src.connect(filter).connect(g).connect(this.comp);
    src.start(now, Math.random() * 2, 0.5);
    src.stop(now + 0.5);
  }

  #thud(amount) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(clamp(amount, 0, 1) * 0.6, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(g).connect(this.comp);
    osc.start(now);
    osc.stop(now + 0.5);
    this.#splash(amount * 0.8);
  }

  #chirp(strength) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const t = now + i * (0.07 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const base = 2200 + Math.random() * 2400;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * (0.6 + Math.random() * 0.9), t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035 * strength, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      osc.connect(g).connect(this.comp);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  #bell(strength) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const partials = [1, 2.01, 2.78, 4.12, 5.43];
    partials.forEach((p, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 262 * p;
      const g = ctx.createGain();
      const amp = (0.06 * strength) / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0004, now + 2.6 + i * 0.3);
      osc.connect(g).connect(this.comp);
      osc.start(now);
      osc.stop(now + 3.4);
    });
  }

  #carHorn(strength) {
    const ctx = this.ctx;
    const now = ctx.currentTime + Math.random() * 0.4;
    const dur = 0.18 + Math.random() * 0.3;
    for (const mult of [1, 1.26]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = (340 + Math.random() * 120) * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.012 * strength, now + 0.02);
      g.gain.setValueAtTime(0.012 * strength, now + dur);
      g.gain.exponentialRampToValueAtTime(0.0003, now + dur + 0.08);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      osc.connect(lp).connect(g).connect(this.comp);
      osc.start(now);
      osc.stop(now + dur + 0.12);
    }
  }

  #boatHorn() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    for (const f of [150, 226]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.14, now + 0.06);
      g.gain.setValueAtTime(0.14, now + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 1.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      osc.connect(lp).connect(g).connect(this.comp);
      osc.start(now);
      osc.stop(now + 1.6);
    }
  }
}
