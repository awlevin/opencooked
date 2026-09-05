// The lobby's level card: which kitchen the room is about to cook in.
//
// The map is drawn from the same ASCII the sim plays, in the same world
// palette the kitchen will be drawn in — so choosing a level on a phone shows
// its shape and its mood on the TV before anyone commits to it.

import { DISHES } from '@/shared/catalogue';
import type { WorldTheme } from '@/shared/levels';
import { levelById, themeOf } from '@/shared/levels';
import type { Tile } from '@/shared/types';

/** Station colours for the minimap. Equipment, so they do not vary by world. */
const STATION: Partial<Record<Tile['t'], string>> = {
  crate: '#b9793d',
  board: '#d3a165',
  stove: '#5b5f68',
  plates: '#fdfdfd',
  trash: '#4f6157',
  extinguisher: '#c0392b',
};

/** How many dishes to name before falling back to "+n more". */
const MENU_SHOWN = 3;

/** One kitchen, drawn small. `cell` is in device pixels. */
export function drawMiniMap(canvas: HTMLCanvasElement, levelId: string, cell = 16): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  let level;
  try {
    level = levelById(levelId);
  } catch {
    return; // an id we do not ship: leave whatever was there
  }
  const theme: WorldTheme = themeOf(level.worldId);
  canvas.width = level.w * cell;
  canvas.height = level.h * cell;

  // Floor first, in the world's own colour: what the map is *for* is telling
  // the room apart from the walls at a glance.
  c.fillStyle = theme.floorA;
  c.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const tile = level.tiles[y * level.w + x]!;
      if (tile.t === 'floor') continue;
      c.fillStyle = tile.t === 'serve' ? theme.accent : (STATION[tile.t] ?? theme.counterTop);
      c.fillRect(x * cell, y * cell, cell, cell);
      c.strokeStyle = theme.counterBottom;
      c.lineWidth = 1;
      c.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    }
  }

  // Spawn dots: where the chefs will be standing.
  c.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (const s of level.spawns) {
    c.beginPath();
    c.arc((s.x + 0.5) * cell, (s.y + 0.5) * cell, cell * 0.16, 0, Math.PI * 2);
    c.fill();
  }

  c.strokeStyle = theme.frame;
  c.lineWidth = Math.max(2, cell * 0.16);
  c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, canvas.width - c.lineWidth, canvas.height - c.lineWidth);
}

/** "Onion Soup · Burger · Cheeseburger +2 more" — what this level serves. */
export function menuLine(levelId: string): string {
  let level;
  try {
    level = levelById(levelId);
  } catch {
    return '';
  }
  const names = level.menu.map((id) => DISHES[id].name);
  const shown = names.slice(0, MENU_SHOWN).join(' · ');
  const rest = names.length - MENU_SHOWN;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}
