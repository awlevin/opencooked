// The paused kitchen, on the TV.
//
// Everything under this is a frozen frame — the renderer stops its animation
// clock while `snap.paused` is set — so the overlay is the only thing moving.
// It animates from `paused.sinceMs`, which the sim counts up, plus the frame's
// own `age`: that makes the scale-in smooth at display rate without the module
// keeping a clock of its own, and it looks identical on a host that just
// reconnected mid-pause.

import type { WorldTheme } from '@/shared/levels';
import type { PauseState } from '@/shared/types';
import { PAL, circle, clamp, fillStroke, font, rr, text } from './theme';

/** Scale-in of the card, in ms. */
const IN_MS = 260;

/** Ease-out-back: the card overshoots a touch and settles. */
function pop(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 + 2.2 * u * u * u - 3.0 * u * u;
}

export function drawPauseOverlay(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  u: number,
  hudH: number,
  paused: PauseState,
  theme: WorldTheme,
  ageMs: number,
): void {
  const since = paused.sinceMs + ageMs;
  const t = clamp(since / IN_MS, 0, 1);

  // Dim the whole screen, HUD included: the score and the clock stay readable
  // but plainly out of play, which is exactly what a pause is.
  c.save();
  c.globalAlpha = 0.55 * t;
  c.fillStyle = '#140b06';
  c.fillRect(0, 0, W, H);
  c.restore();

  const cardW = Math.min(W - u * 120, u * 900);
  const cardH = u * 330;
  const cx = W / 2;
  // Centred in the room below the HUD band, not on the glass: a card in the
  // true centre of a 16:9 screen sits low once the band is taken out.
  const cy = hudH + (H - hudH) / 2;

  c.save();
  c.translate(cx, cy);
  c.scale(pop(t), pop(t));
  c.globalAlpha = t;
  c.translate(-cardW / 2, -cardH / 2);

  c.save();
  c.shadowColor = 'rgba(0,0,0,0.6)';
  c.shadowBlur = u * 50;
  c.shadowOffsetY = u * 16;
  rr(c, 0, 0, cardW, cardH, u * 34);
  c.fillStyle = theme.hudBg;
  c.fill();
  c.restore();

  rr(c, 0, 0, cardW, cardH, u * 34);
  fillStroke(c, null, theme.accent, u * 5);

  // A slow breath on the word itself, so a still screen is not a dead one.
  const breath = 0.5 + 0.5 * Math.sin(since / 520);
  text(c, 'PAUSED', cardW / 2, u * 86, {
    size: u * 88,
    fill: PAL.cream,
    outline: PAL.ink,
    outlineWidth: u * 88 * 0.09,
    letterSpacing: u * 10,
  });

  // Who did it: their colour disc and their name, on one line, sized so it
  // reads from a sofa rather than from a desk.
  const nameSize = u * 40;
  const discR = u * 19;
  const gap = u * 18;
  const label = paused.name || 'A chef';
  // `text()` centres what it draws, so the disc and the name are laid out
  // together around the measured width to keep the pair centred as one.
  c.save();
  c.font = font(nameSize);
  const nameW = c.measureText(label).width;
  c.restore();
  const rowW = discR * 2 + gap + nameW;
  const rowX = cardW / 2 - rowW / 2;
  const rowY = u * 168;

  circle(c, rowX + discR, rowY, discR);
  fillStroke(c, paused.color || PAL.cream, PAL.ink, u * 4);
  text(c, label, rowX + discR * 2 + gap, rowY, {
    size: nameSize,
    fill: PAL.cream,
    outline: PAL.ink,
    outlineWidth: nameSize * 0.09,
    align: 'left',
  });

  text(c, 'paused the game', cardW / 2, u * 220, {
    size: u * 30,
    weight: 700,
    fill: 'rgba(255,246,227,0.72)',
  });

  text(c, 'ANY CHEF CAN PRESS RESUME', cardW / 2, u * 278, {
    size: u * 26,
    weight: 700,
    fill: `rgba(255,246,227,${(0.34 + breath * 0.28).toFixed(3)})`,
    letterSpacing: u * 5,
  });

  c.restore();
}
