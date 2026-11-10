import { clamp } from './utils.js';

/**
 * Keyboard + mouse + touch. Produces a per-frame snapshot:
 *   throttle (-1..1), steer (-1..1), brake, look dx/dy, zoom, and one-shot
 *   actions the app drains each frame.
 */
export class Input {
  constructor(domElement, { onAction } = {}) {
    this.dom = domElement;
    this.keys = new Set();
    this.lookDx = 0;
    this.lookDy = 0;
    this.zoom = 0;
    this.dragging = false;
    this.onAction = onAction ?? (() => {});
    this.enabled = true;
    this.touchThrottle = 0;
    this.touchSteer = 0;
    this.pointerLocked = false;

    this.ACTIONS = {
      KeyC: 'camera',
      KeyV: 'boat',
      KeyT: 'time',
      KeyH: 'help',
      KeyP: 'photo',
      KeyR: 'reset',
      KeyM: 'map',
      KeyF: 'fullscreen',
      KeyN: 'nextLocation',
      KeyX: 'horn',
      Backquote: 'debug',
      Escape: 'escape',
    };

    this.#bind();
  }

  #bind() {
    const d = window;
    d.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!e.repeat) {
        const action = this.ACTIONS[e.code];
        if (action) {
          this.onAction(action, e);
          if (action !== 'escape' && action !== 'fullscreen') e.preventDefault();
        }
        if (e.code.startsWith('Digit')) {
          this.onAction('digit', e);
        }
      }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    d.addEventListener('keyup', (e) => this.keys.delete(e.code));
    d.addEventListener('blur', () => this.keys.clear());

    const canvas = this.dom;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointerup', (e) => {
      this.dragging = false;
      canvas.releasePointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointerleave', () => (this.dragging = false));
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointerLocked) {
        this.lookDx += e.movementX;
        this.lookDy += e.movementY;
        return;
      }
      if (!this.dragging) return;
      this.lookDx += e.clientX - this._lastX;
      this.lookDy += e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.zoom += Math.sign(e.deltaY) * 0.6;
        e.preventDefault();
      },
      { passive: false }
    );

    // --- touch: left half steers, right half is the throttle -------------
    this.touches = new Map();
    const onTouch = (e) => {
      const w = window.innerWidth;
      this.touchSteer = 0;
      this.touchThrottle = 0;
      for (const t of e.touches) {
        const rec = this.touches.get(t.identifier);
        if (!rec) continue;
        if (rec.side === 'left') {
          this.touchSteer = clamp((t.clientX - rec.x0) / 70, -1, 1);
        } else {
          this.touchThrottle = clamp((rec.y0 - t.clientY) / 80, -1, 1);
        }
      }
    };
    canvas.addEventListener(
      'touchstart',
      (e) => {
        for (const t of e.changedTouches) {
          this.touches.set(t.identifier, {
            side: t.clientX < window.innerWidth / 2 ? 'left' : 'right',
            x0: t.clientX,
            y0: t.clientY,
          });
        }
        onTouch(e);
      },
      { passive: true }
    );
    canvas.addEventListener('touchmove', onTouch, { passive: true });
    canvas.addEventListener(
      'touchend',
      (e) => {
        for (const t of e.changedTouches) this.touches.delete(t.identifier);
        onTouch(e);
      },
      { passive: true }
    );
  }

  requestPointerLock() {
    this.dom.requestPointerLock?.();
  }
  exitPointerLock() {
    document.exitPointerLock?.();
  }

  held(code) {
    return this.keys.has(code);
  }

  /** Read and clear the frame's relative inputs. */
  sample() {
    const k = this.keys;
    let throttle = this.touchThrottle;
    let steer = this.touchSteer;
    if (k.has('KeyW') || k.has('ArrowUp')) throttle += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) throttle -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steer += 1;

    const out = {
      throttle: clamp(throttle, -1, 1),
      steer: clamp(steer, -1, 1),
      brake: k.has('Space'),
      boost: k.has('ShiftLeft') || k.has('ShiftRight'),
      up: k.has('KeyE') || k.has('PageUp'),
      down: k.has('KeyQ') || k.has('PageDown'),
      lookDx: this.lookDx,
      lookDy: this.lookDy,
      zoom: this.zoom,
      dragging: this.dragging,
    };
    this.lookDx = 0;
    this.lookDy = 0;
    this.zoom = 0;
    return out;
  }
}
