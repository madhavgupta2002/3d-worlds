import { clamp, headingToBearing, bearingLabel, bearingTo, TAU } from './utils.js';

const $ = (id) => document.getElementById(id);

/**
 * All the DOM: gauges, compass strip, chart, overlays and toasts.
 * Pure presentation — the app pushes state in once per frame.
 */
export class Hud {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.el = {
      hud: $('hud'),
      loading: $('loading'),
      barFill: $('barFill'),
      loadLabel: $('loadLabel'),
      startBtn: $('startBtn'),
      locName: $('locName'),
      locRegion: $('locRegion'),
      metaBoat: $('metaBoat'),
      metaSky: $('metaSky'),
      metaCam: $('metaCam'),
      compass: $('compass'),
      gSpeed: $('gSpeed'),
      gKnots: $('gKnots'),
      gThrottle: $('gThrottle'),
      gRudder: $('gRudder'),
      gRpm: $('gRpm'),
      gDepth: $('gDepth'),
      depthReadout: $('depthReadout'),
      minimap: $('minimap'),
      minimapWrap: $('minimapWrap'),
      minimapScale: $('minimapScale'),
      poiCard: $('poiCard'),
      poiName: $('poiName'),
      poiText: $('poiText'),
      poiDist: $('poiDist'),
      toasts: $('toasts'),
      photoFrame: $('photoFrame'),
      photoHint: $('photoHint'),
      fps: $('fps'),
      placeCards: $('placeCards'),
      boatCards: $('boatCards'),
      skyCards: $('skyCards'),
      qualitySeg: $('qualitySeg'),
      cameraSeg: $('cameraSeg'),
      qualityNote: $('qualityNote'),
    };
    this.ctxCompass = this.el.compass.getContext('2d');
    this.ctxMap = this.el.minimap.getContext('2d');
    this.pois = [];
    this.minimapVisible = true;
    this.currentPoi = null;
    this._poiTimer = 0;

    this.#wireButtons();
  }

  #wireButtons() {
    const open = (id) => {
      for (const o of document.querySelectorAll('.overlay')) o.classList.add('hidden');
      $(id).classList.remove('hidden');
    };
    this.closeOverlays = () => {
      for (const o of document.querySelectorAll('.overlay')) o.classList.add('hidden');
    };
    this.openOverlay = open;
    this.anyOverlayOpen = () =>
      [...document.querySelectorAll('.overlay')].some((o) => !o.classList.contains('hidden'));

    $('btnPlaces').onclick = () => open('placesOverlay');
    $('btnBoats').onclick = () => open('boatsOverlay');
    $('btnLight').onclick = () => open('lightOverlay');
    $('btnSettings').onclick = () => open('settingsOverlay');
    $('btnHelp').onclick = () => open('helpOverlay');
    $('btnCam').onclick = () => this.cb.onCameraCycle?.();
    $('btnPhoto').onclick = () => this.cb.onPhoto?.();
    $('btnSound').onclick = (e) => {
      const muted = this.cb.onSoundToggle?.();
      e.currentTarget.classList.toggle('on', !muted);
      e.currentTarget.firstChild.textContent = muted ? 'Sound off' : 'Sound';
    };
    for (const b of document.querySelectorAll('[data-close]')) {
      b.onclick = () => $(b.dataset.close).classList.add('hidden');
    }
    for (const o of document.querySelectorAll('.overlay')) {
      o.addEventListener('click', (e) => {
        if (e.target === o) o.classList.add('hidden');
      });
    }

    $('volume').oninput = (e) => this.cb.onVolume?.(e.target.value / 100);
    $('waveScale').oninput = (e) => this.cb.onWaveScale?.(e.target.value / 100);
    $('fov').oninput = (e) => this.cb.onFov?.(+e.target.value);
    $('bloom').oninput = (e) => this.cb.onBloom?.(e.target.value / 100);

    this.el.startBtn.onclick = () => this.cb.onStart?.();
  }

  // ------------------------------------------------------------------ menus
  buildMenus({ places, boats, skies, cameras, qualities }) {
    const cardList = (host, items, onPick) => {
      host.innerHTML = '';
      for (const it of items) {
        const b = document.createElement('button');
        b.className = 'card';
        b.dataset.id = it.id;
        b.innerHTML = `<div class="t">${it.title}</div><div class="s">${it.subtitle}</div>`;
        b.onclick = () => {
          onPick(it.id);
          this.closeOverlays();
        };
        host.appendChild(b);
      }
    };
    cardList(this.el.placeCards, places, (id) => this.cb.onPlace?.(id));
    cardList(this.el.boatCards, boats, (id) => this.cb.onBoat?.(id));
    cardList(this.el.skyCards, skies, (id) => this.cb.onSky?.(id));

    const seg = (host, items, onPick) => {
      host.innerHTML = '';
      for (const it of items) {
        const b = document.createElement('button');
        b.dataset.id = it.id;
        b.textContent = it.title;
        b.onclick = () => onPick(it.id);
        host.appendChild(b);
      }
    };
    seg(this.el.qualitySeg, qualities, (id) => this.cb.onQuality?.(id));
    seg(this.el.cameraSeg, cameras, (id) => this.cb.onCamera?.(id));
    this.menuData = { places, boats, skies, cameras, qualities };
  }

  #markActive(host, id) {
    for (const b of host.children) b.classList.toggle('active', b.dataset.id === id);
  }

  setLocation(scene) {
    this.el.locName.textContent = scene.name;
    this.el.locRegion.textContent = scene.region;
    this.#markActive(this.el.placeCards, scene.id);
  }
  setBoat(spec) {
    this.el.metaBoat.textContent = spec.label;
    this.#markActive(this.el.boatCards, spec.id);
  }
  setSky(id, label) {
    this.el.metaSky.textContent = label;
    this.#markActive(this.el.skyCards, id);
  }
  setCamera(mode, label) {
    this.el.metaCam.textContent = label;
    this.#markActive(this.el.cameraSeg, mode);
  }
  setQuality(id, note) {
    this.#markActive(this.el.qualitySeg, id);
    if (note) this.el.qualityNote.textContent = note;
  }

  // ----------------------------------------------------------------- chart
  setMinimapSource(canvas, half) {
    this.mapSource = canvas;
    this.mapHalf = half;
    this.el.minimapScale.textContent = `${Math.round(half * 2)} m across`;
  }
  setPois(pois) {
    this.pois = pois;
  }
  toggleMinimap() {
    this.minimapVisible = !this.minimapVisible;
    this.el.minimapWrap.style.display = this.minimapVisible ? '' : 'none';
  }

  #drawMinimap(state) {
    if (!this.mapSource || !this.minimapVisible) return;
    const c = this.ctxMap;
    const s = this.el.minimap.width;
    c.clearRect(0, 0, s, s);
    c.save();
    c.beginPath();
    c.roundRect?.(0, 0, s, s, 10);
    if (c.roundRect) c.clip();
    c.drawImage(this.mapSource, 0, 0, s, s);

    const toPix = (x, z) => [
      ((x + this.mapHalf) / (this.mapHalf * 2)) * s,
      ((z + this.mapHalf) / (this.mapHalf * 2)) * s,
    ];

    // points of interest
    c.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    for (const p of this.pois) {
      const [px, pz] = toPix(p.x, p.z);
      c.fillStyle = 'rgba(240,178,84,0.95)';
      c.beginPath();
      c.arc(px, pz, 3.6, 0, TAU);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 1;
      c.stroke();
    }

    // wake trail
    if (state.trail?.length > 1) {
      c.strokeStyle = 'rgba(255,255,255,0.4)';
      c.lineWidth = 1.6;
      c.beginPath();
      state.trail.forEach(([tx, tz], i) => {
        const [px, pz] = toPix(tx, tz);
        if (i === 0) c.moveTo(px, pz);
        else c.lineTo(px, pz);
      });
      c.stroke();
    }

    // the boat
    const [bx, bz] = toPix(state.pos.x, state.pos.z);
    c.save();
    c.translate(bx, bz);
    c.rotate(state.heading + Math.PI);
    c.fillStyle = '#58c7bd';
    c.strokeStyle = 'rgba(0,0,0,0.65)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6, 8);
    c.lineTo(0, 4.5);
    c.lineTo(-6, 8);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    c.restore();
  }

  // --------------------------------------------------------------- compass
  #drawCompass(state) {
    const c = this.ctxCompass;
    const w = this.el.compass.width;
    const h = this.el.compass.height;
    c.clearRect(0, 0, w, h);
    const bearing = headingToBearing(state.heading);
    const pxPerDeg = w / 150; // 150° of arc visible

    c.save();
    c.translate(w / 2, 0);
    for (let d = -80; d <= 80; d += 5) {
      const deg = bearing + d;
      const x = d * pxPerDeg;
      if (Math.abs(x) > w / 2) continue;
      const major = Math.round(((deg % 360) + 360) % 360) % 45 < 2.5;
      const fade = 1 - Math.abs(x) / (w / 2);
      c.strokeStyle = `rgba(232,238,240,${0.2 + fade * 0.55})`;
      c.lineWidth = major ? 1.6 : 1;
      c.beginPath();
      c.moveTo(x, h * 0.52);
      c.lineTo(x, h * 0.52 + (major ? 13 : 7));
      c.stroke();
      if (major) {
        c.fillStyle = `rgba(232,238,240,${0.35 + fade * 0.6})`;
        c.font = '600 15px ui-sans-serif, system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText(bearingLabel(((deg % 360) + 360) % 360), x, h * 0.42);
      }
    }

    // POI bearings
    for (const p of this.pois) {
      const b = bearingTo(state.pos.x, state.pos.z, p.x, p.z);
      let delta = b - bearing;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      const x = delta * pxPerDeg;
      if (Math.abs(x) > w / 2 - 6) continue;
      c.fillStyle = 'rgba(240,178,84,0.95)';
      c.beginPath();
      c.moveTo(x, h * 0.9);
      c.lineTo(x - 4.5, h);
      c.lineTo(x + 4.5, h);
      c.closePath();
      c.fill();
    }

    c.fillStyle = '#58c7bd';
    c.beginPath();
    c.moveTo(0, h * 0.5);
    c.lineTo(-5, h * 0.5 - 9);
    c.lineTo(5, h * 0.5 - 9);
    c.closePath();
    c.fill();
    c.restore();
  }

  // ---------------------------------------------------------------- update
  update(dt, state) {
    this.el.gSpeed.textContent = state.speedKmh.toFixed(1);
    this.el.gKnots.textContent = state.knots.toFixed(1);
    const thr = clamp(state.throttle, -1, 1);
    const rud = clamp(state.steer, -1, 1);
    this.el.gThrottle.style.left = thr >= 0 ? '50%' : `${50 + thr * 50}%`;
    this.el.gThrottle.style.width = `${Math.abs(thr) * 50}%`;
    this.el.gRudder.style.left = rud >= 0 ? '50%' : `${50 + rud * 50}%`;
    this.el.gRudder.style.width = `${Math.abs(rud) * 50}%`;
    this.el.gRpm.style.left = '50%';
    this.el.gRpm.style.width = `${clamp(state.rpm, 0, 1) * 50}%`;

    const d = state.depth;
    this.el.gDepth.textContent = d > 20 ? '20+' : d.toFixed(1);
    this.el.depthReadout.classList.toggle('warn', d < 0.6);

    this.#drawCompass(state);
    this.#drawMinimap(state);

    if (this._poiTimer > 0) {
      this._poiTimer -= dt;
      if (this._poiTimer <= 0) this.hidePoi();
    }
  }

  // ------------------------------------------------------------------- bits
  showPoi(poi, distance) {
    if (this.currentPoi?.name !== poi.name) {
      this.el.poiName.textContent = poi.name;
      this.el.poiText.textContent = poi.text;
      this.currentPoi = poi;
    }
    this.el.poiDist.textContent = `${Math.round(distance)} m away`;
    this.el.poiCard.classList.add('show');
    this._poiTimer = 9;
  }
  hidePoi() {
    this.el.poiCard.classList.remove('show');
    this.currentPoi = null;
    this._poiTimer = 0;
  }

  toast(text, { warn = false, ms = 2600 } = {}) {
    const el = document.createElement('div');
    el.className = 'toast' + (warn ? ' warn' : '');
    el.textContent = text;
    this.el.toasts.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .4s ease, transform .4s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      setTimeout(() => el.remove(), 420);
    }, ms);
  }

  setLoading(progress, label) {
    this.el.barFill.style.width = `${clamp(progress, 0, 1) * 100}%`;
    if (label) this.el.loadLabel.textContent = label;
  }
  loadingReady() {
    this.el.startBtn.classList.add('show');
    this.el.loadLabel.textContent = 'ready';
  }
  hideLoading() {
    this.el.loading.classList.add('done');
    setTimeout(() => (this.el.loading.style.display = 'none'), 900);
  }
  showLoadingAgain(label) {
    this.el.loading.style.display = '';
    this.el.loading.classList.remove('done');
    this.el.startBtn.classList.remove('show');
    this.setLoading(0.05, label);
  }

  photoMode(on) {
    this.el.hud.classList.toggle('hidden', on);
    this.el.photoFrame.classList.toggle('show', on);
    this.el.photoHint.classList.toggle('show', on);
  }

  setFps(text) {
    this.el.fps.textContent = text;
  }
  toggleFps() {
    this.el.fps.classList.toggle('show');
  }
}
