// The TV lobby card's map: a canvas wrapper around the shared level preview.
//
// The drawing itself lives in `shared/levels/minimap.ts`, because the phone
// chooser shows the same picture and neither screen should own it. All this
// file decides is how many pixels the TV gets.

import type { Level } from '@/shared/levels';
import { themeOf } from '@/shared/levels';
import { drawMiniMap } from '@/shared/levels/minimap';

/**
 * Device pixels per kitchen tile. Big enough that a stove reads as a stove
 * across a living room: the card displays the bitmap at roughly half this, so
 * it stays sharp on a 4K panel too.
 */
const CELL = 30;

/** Paint one kitchen into the lobby card's canvas, at its natural aspect. */
export function paintLevelMap(canvas: HTMLCanvasElement, level: Level): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  canvas.width = level.w * CELL;
  canvas.height = level.h * CELL;
  drawMiniMap(c, level, themeOf(level.worldId), canvas.width, canvas.height);
}
