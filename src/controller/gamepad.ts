// The playing screen: a floating virtual joystick on the left half and two
// big round buttons on the right. Pointer Events throughout, with pointer ids
// tracked per control so the stick and both buttons work at the same time.

import type { Btn } from '../../shared/protocol';
import type { Vec2 } from '../../shared/types';
import { el } from './dom';

const MOVE_INTERVAL_MS = 33; // ~30 Hz
const DEAD_ZONE_PX = 8;
// Thumb travel. Kept in step with .stick / .stick__thumb in style.css so the
// thumb tops out flush with the base ring.
const MAX_RADIUS_PX = 52;
const EPSILON = 0.02;

export interface GamepadCallbacks {
  onMove: (move: Vec2) => void;
  onPress: (btn: Btn) => void;
  onRelease: (btn: Btn) => void;
}

interface ButtonRef {
  node: HTMLButtonElement;
  pointerId: number | null;
}

export class GamepadView {
  readonly root: HTMLElement;

  private readonly stickZone: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickThumb: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly buttons = new Map<Btn, ButtonRef>();
  private readonly disposers: Array<() => void> = [];

  private stickPointer: number | null = null;
  private origin: Vec2 = { x: 0, y: 0 };
  private lastSent: Vec2 = { x: 0, y: 0 };
  private pending: Vec2 | null = null;
  private lastSendAt = 0;
  private flushTimer: number | null = null;
  private destroyed = false;

  constructor(
    private readonly cb: GamepadCallbacks,
    playerName: string,
  ) {
    this.root = el('div', 'screen screen--pad');

    const hud = el('div', 'pad-hud');
    hud.appendChild(el('span', 'pad-hud__dot'));
    hud.appendChild(el('span', 'pad-hud__name', playerName));
    this.root.appendChild(hud);

    const pad = el('div', 'pad');
    this.root.appendChild(pad);

    // --- left: joystick ---
    this.stickZone = el('div', 'stick-zone');
    this.hint = el('div', 'stick-hint');
    this.hint.appendChild(el('span', 'stick-hint__ring'));
    this.hint.appendChild(el('span', 'stick-hint__label', 'MOVE'));
    this.stickZone.appendChild(this.hint);

    this.stickBase = el('div', 'stick');
    this.stickThumb = el('div', 'stick__thumb');
    this.stickBase.appendChild(el('div', 'stick__ring'));
    this.stickBase.appendChild(this.stickThumb);
    this.stickZone.appendChild(this.stickBase);
    pad.appendChild(this.stickZone);

    // --- right: buttons ---
    const btnZone = el('div', 'btn-zone');
    const b = this.makeButton('b', 'CHOP', 'DASH');
    const a = this.makeButton('a', 'GRAB', 'PUT');
    btnZone.appendChild(b);
    btnZone.appendChild(a);
    pad.appendChild(btnZone);

    this.wireStick();
    this.wireSafetyReleases();
  }

  /* ------------------------------ buttons ------------------------------- */

  private makeButton(btn: Btn, label: string, sub: string): HTMLButtonElement {
    const node = el('button', `pad-btn pad-btn--${btn}`);
    node.type = 'button';
    node.appendChild(el('span', 'pad-btn__label', label));
    node.appendChild(el('span', 'pad-btn__sub', sub));
    const ref: ButtonRef = { node, pointerId: null };
    this.buttons.set(btn, ref);

    const down = (e: PointerEvent) => {
      if (ref.pointerId !== null) return;
      ref.pointerId = e.pointerId;
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      node.classList.add('is-pressed');
      this.cb.onPress(btn);
      e.preventDefault();
      e.stopPropagation();
    };

    const up = (e: PointerEvent) => {
      if (ref.pointerId !== e.pointerId) return;
      this.releaseButton(btn);
      e.preventDefault();
      e.stopPropagation();
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('lostpointercapture', up);
    node.addEventListener('contextmenu', (e) => e.preventDefault());

    this.disposers.push(() => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('lostpointercapture', up);
    });
    return node;
  }

  private releaseButton(btn: Btn): void {
    const ref = this.buttons.get(btn);
    if (!ref || ref.pointerId === null) return;
    const id = ref.pointerId;
    ref.pointerId = null;
    try {
      if (ref.node.hasPointerCapture(id)) ref.node.releasePointerCapture(id);
    } catch {
      /* already released */
    }
    ref.node.classList.remove('is-pressed');
    this.cb.onRelease(btn);
  }

  /* ------------------------------ joystick ------------------------------ */

  private wireStick(): void {
    const zone = this.stickZone;

    const down = (e: PointerEvent) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      const rect = zone.getBoundingClientRect();
      this.origin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX - rect.left}px`;
      this.stickBase.style.top = `${e.clientY - rect.top}px`;
      this.stickBase.classList.add('is-active');
      this.hint.classList.add('is-hidden');
      this.moveThumb({ x: 0, y: 0 });
      this.queueMove({ x: 0, y: 0 }, true);
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (this.stickPointer !== e.pointerId) return;
      const v = this.vectorFor(e.clientX, e.clientY);
      this.moveThumb(v);
      this.queueMove(v, false);
      e.preventDefault();
    };

    const up = (e: PointerEvent) => {
      if (this.stickPointer !== e.pointerId) return;
      this.stickPointer = null;
      try {
        if (zone.hasPointerCapture(e.pointerId)) zone.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      this.stickBase.classList.remove('is-active');
      this.hint.classList.remove('is-hidden');
      this.moveThumb({ x: 0, y: 0 });
      this.queueMove({ x: 0, y: 0 }, true); // the stop must always land
      e.preventDefault();
    };

    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    zone.addEventListener('lostpointercapture', up);

    this.disposers.push(() => {
      zone.removeEventListener('pointerdown', down);
      zone.removeEventListener('pointermove', move);
      zone.removeEventListener('pointerup', up);
      zone.removeEventListener('pointercancel', up);
      zone.removeEventListener('lostpointercapture', up);
    });
  }

  /** Screen delta -> normalized vector. +y is down, matching the tile grid. */
  private vectorFor(clientX: number, clientY: number): Vec2 {
    let dx = clientX - this.origin.x;
    let dy = clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len <= DEAD_ZONE_PX) return { x: 0, y: 0 };
    const usable = Math.min(len, MAX_RADIUS_PX) - DEAD_ZONE_PX;
    const scale = usable / (MAX_RADIUS_PX - DEAD_ZONE_PX) / len;
    dx *= scale;
    dy *= scale;
    return { x: dx, y: dy };
  }

  private moveThumb(v: Vec2): void {
    const x = v.x * MAX_RADIUS_PX;
    const y = v.y * MAX_RADIUS_PX;
    this.stickThumb.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }

  /* ------------------------- throttled move send ------------------------ */

  private queueMove(v: Vec2, force: boolean): void {
    if (this.destroyed) return;
    if (!force && Math.abs(v.x - this.lastSent.x) < EPSILON && Math.abs(v.y - this.lastSent.y) < EPSILON) {
      return;
    }
    if (force) {
      this.cancelFlush();
      this.emit(v);
      return;
    }
    const now = performance.now();
    const wait = MOVE_INTERVAL_MS - (now - this.lastSendAt);
    if (wait <= 0) {
      this.emit(v);
      return;
    }
    this.pending = v;
    if (this.flushTimer === null) {
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = null;
        const p = this.pending;
        this.pending = null;
        if (p) this.emit(p);
      }, wait);
    }
  }

  private emit(v: Vec2): void {
    this.lastSent = v;
    this.lastSendAt = performance.now();
    this.cb.onMove(v);
  }

  private cancelFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending = null;
  }

  /* ------------------------------ safety -------------------------------- */

  private wireSafetyReleases(): void {
    const panic = () => this.releaseAll();
    window.addEventListener('blur', panic);
    document.addEventListener('visibilitychange', panic);
    this.disposers.push(() => {
      window.removeEventListener('blur', panic);
      document.removeEventListener('visibilitychange', panic);
    });
  }

  /** Drops every held control. Safe to call at any time. */
  releaseAll(): void {
    for (const btn of this.buttons.keys()) this.releaseButton(btn);
    if (this.stickPointer !== null) {
      this.stickPointer = null;
      this.stickBase.classList.remove('is-active');
      this.hint.classList.remove('is-hidden');
      this.moveThumb({ x: 0, y: 0 });
    }
    this.cancelFlush();
    if (this.lastSent.x !== 0 || this.lastSent.y !== 0) this.emit({ x: 0, y: 0 });
  }

  /** Re-sends the current control state after a reconnect. */
  resync(): void {
    this.cancelFlush();
    this.emit({ x: 0, y: 0 });
    for (const [btn, ref] of this.buttons) {
      if (ref.pointerId !== null) this.cb.onPress(btn);
    }
  }

  destroy(): void {
    this.releaseAll();
    this.destroyed = true;
    this.cancelFlush();
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.root.remove();
  }
}
