// Full-screen kitchen renderer: devicePixelRatio-aware, letterboxed so tiles
// stay square, redrawing every animation frame from interpolated snapshots.

import { themeOf } from '@/shared/levels';
import type { SnapshotBuffer } from '../state';
import { chefGlow, drawChefGlow, drawServeFx, fxNow } from './fx';
import { drawHud } from './hud';
import { drawPauseOverlay } from './pause';
import { drawAim, drawPlayer, drawPlayerLabel } from './players';
import { drawKitchen } from './tiles';
import { rr, text, worldToPx } from './theme';

export class GameView {
  private readonly c: CanvasRenderingContext2D;
  private readonly onResize = () => this.resize();
  private raf = 0;
  private running = false;
  private cssW = 0;
  private cssH = 0;
  private dpr = 0;
  /**
   * The animation clock every draw call is handed. It stops while the kitchen
   * is paused, so flames, steam, the chop sparks and the ticket shake all hold
   * still under the overlay — a "frozen" screen that keeps flickering does not
   * read as frozen.
   */
  private clockMs = 0;
  private lastFrameMs = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly buf: SnapshotBuffer,
    private readonly debug: boolean,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas is not available');
    this.c = ctx;
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Stop the loop and drop every listener. Safe to call twice. */
  destroy(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  private frame(nowMs: number): void {
    this.resize();
    const c = this.c;
    const W = this.cssW;
    const H = this.cssH;

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const frame = this.buf.sample(nowMs);
    const paused = frame?.snap.paused ?? null;
    const dtMs = this.lastFrameMs === 0 ? 0 : Math.min(nowMs - this.lastFrameMs, 250);
    this.lastFrameMs = nowMs;
    if (!paused) this.clockMs += dtMs;
    const time = this.clockMs / 1000;
    // One resolve per frame: every draw call below is handed the world's
    // colours, so none of them has to know which world it is drawing.
    const theme = themeOf(frame?.snap.worldId ?? '');

    // backdrop
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, theme.backdropTop);
    bg.addColorStop(1, theme.backdropBottom);
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    const u = Math.min(W / 1920, H / 1080);
    const hudH = 158 * u;

    if (!frame) {
      text(c, 'Warming up the kitchen…', W / 2, H / 2, {
        size: Math.max(20, 46 * u),
        fill: 'rgba(255,246,227,0.7)',
      });
      return;
    }

    const { snap, players, age } = frame;
    const pad = 18 * u;
    const T = Math.min(
      (W - pad * 2) / snap.w,
      (H - hudH - pad * 2) / snap.h,
    );
    const bw = T * snap.w;
    const bh = T * snap.h;
    const bx = Math.round((W - bw) / 2);
    const by = Math.round(hudH + (H - hudH - bh) / 2);

    // kitchen tray: drop shadow, clipped floor, chunky border
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 40 * u;
    c.shadowOffsetY = 14 * u;
    rr(c, bx, by, bw, bh, 22 * u);
    c.fillStyle = theme.floorA;
    c.fill();
    c.restore();

    c.save();
    rr(c, bx, by, bw, bh, 22 * u);
    c.clip();
    c.translate(bx, by);
    drawKitchen(c, snap, T, time, theme);

    if (this.debug) {
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.lineWidth = 1;
      c.beginPath();
      for (let x = 0; x <= snap.w; x++) {
        c.moveTo(x * T, 0);
        c.lineTo(x * T, bh);
      }
      for (let y = 0; y <= snap.h; y++) {
        c.moveTo(0, y * T);
        c.lineTo(bw, y * T);
      }
      c.stroke();
      const fs = Math.max(9, T * 0.15);
      for (let y = 0; y < snap.h; y++) {
        for (let x = 0; x < snap.w; x++) {
          text(c, `${x},${y}`, x * T + T * 0.06, y * T + T * 0.1, {
            size: fs,
            weight: 700,
            align: 'left',
            fill: 'rgba(255,255,255,0.85)',
            outline: 'rgba(0,0,0,0.8)',
            outlineWidth: fs * 0.3,
          });
        }
      }
    }

    // chefs, painted back to front so overlaps read correctly
    const now = fxNow(snap, age);
    const ordered = [...players].sort((a, b) => a.y - b.y);
    // What each chef is about to act on, over the stations and under everyone,
    // so a highlight can never cover a face or a held item.
    drawAim(c, ordered, T, time);
    // A halo under the chef who just landed a perfect one, so the celebration
    // points at a person and not only at the window.
    for (const p of ordered) {
      drawChefGlow(c, worldToPx(p.x, T), worldToPx(p.y, T), T, p.color, chefGlow(snap, now, p.id));
    }
    for (const p of ordered) drawPlayer(c, p, T, time);
    for (const p of ordered) drawPlayerLabel(c, p, T, u);
    c.restore();

    rr(c, bx, by, bw, bh, 22 * u);
    c.strokeStyle = theme.frame;
    c.lineWidth = Math.max(3, 9 * u);
    c.stroke();

    // Celebrations sit over the kitchen but under the HUD, and clip themselves
    // to the play area: nothing but a departing ticket may touch the rail.
    drawServeFx(c, snap, now, { W, H, u, hudH, bx, by, bw, bh, T });

    // Paused, no clock is draining, so the HUD gets no smoothing age at all:
    // the round timer and every ticket bar hold exactly where they stopped.
    const hudAge = paused ? 0 : age;
    drawHud(c, { W, H, u, hudH }, snap, Math.max(0, snap.msLeft - hudAge), hudAge, time, theme, now);

    if (paused) drawPauseOverlay(c, W, H, u, hudH, paused, theme, age);
  }
}
