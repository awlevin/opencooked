/* ---------------------------------------------------------------
   Brand-asset drawing kit.

   This is a browser-side COPY of the art direction that lives in
   components/host/render/*.ts (theme, players, ingredients, tiles).
   It is deliberately duplicated rather than imported: the brand
   generator must stay a self-contained static page that Playwright
   can open from disk, with no bundler and no dependency on the app.

   If the game art changes, re-sync the primitives below.
   --------------------------------------------------------------- */

export const PAL = {
  ink: '#3b2314',
  inkSoft: '#6b4526',
  cream: '#fff6e3',
  cream2: '#ffeac2',
  butter: '#ffd23f',
  tomato: '#e8503a',
  amber: '#f2a13c',
  green: '#3fbf6f',
  metalDark: '#3c4048',
  pot: '#4a4e57',
  potHi: '#6e737e',
  potRim: '#2f3238',
  plate: '#fdfdfd',
  plateShade: '#dfe6ee',
};

export const INGREDIENT_COLORS = {
  onion: '#f2e2b4',
  tomato: '#e8503a',
  mushroom: '#b4784f',
};

export const PLAYER_COLORS = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f1c40f',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#fd79a8',
];

/* --- colour maths (copied from render/theme.ts) --- */

const lerp = (a, b, t) => a + (b - a) * t;

function parseColor(s) {
  if (s.charCodeAt(0) === 35) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const n = parseInt(hex, 16);
      return [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17];
    }
    const n = parseInt(hex.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/-?\d+(\.\d+)?/g);
  if (!m || m.length < 3) return [0, 0, 0];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

export function mix(a, b, t) {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return `rgb(${Math.round(lerp(pa[0], pb[0], t))}, ${Math.round(
    lerp(pa[1], pb[1], t),
  )}, ${Math.round(lerp(pa[2], pb[2], t))})`;
}
export const shade = (hex, amount) => mix(hex, '#000000', amount);
export const tint = (hex, amount) => mix(hex, '#ffffff', amount);

/* --- path primitives --- */

export function rr(c, x, y, w, h, r) {
  const k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.lineTo(x + w - k, y);
  c.quadraticCurveTo(x + w, y, x + w, y + k);
  c.lineTo(x + w, y + h - k);
  c.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  c.lineTo(x + k, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - k);
  c.lineTo(x, y + k);
  c.quadraticCurveTo(x, y, x + k, y);
  c.closePath();
}

export function fillStroke(c, fill, stroke, width) {
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();
  }
}

export function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.closePath();
}

export function ellipse(c, x, y, rx, ry) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.closePath();
}

/** Inflated-ink silhouette then colour on top: seamless composite shapes. */
function inked(c, path, fill, lw) {
  c.save();
  c.beginPath();
  path();
  c.strokeStyle = PAL.ink;
  c.lineWidth = lw * 2;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.stroke();
  c.fillStyle = PAL.ink;
  c.fill();
  c.beginPath();
  path();
  c.fillStyle = fill;
  c.fill();
  c.restore();
}

/* --- ingredients (copied from render/ingredients.ts) --- */

export function drawWhole(c, type, x, y, r) {
  const lw = r * 0.17;
  const ink = PAL.ink;

  if (type === 'onion') {
    const body = INGREDIENT_COLORS.onion;
    c.beginPath();
    c.moveTo(x, y - r * 0.55);
    c.quadraticCurveTo(x - r * 0.15, y - r * 1.25, x - r * 0.55, y - r * 1.35);
    c.moveTo(x, y - r * 0.55);
    c.quadraticCurveTo(x + r * 0.2, y - r * 1.3, x + r * 0.5, y - r * 1.3);
    c.strokeStyle = '#4fae54';
    c.lineWidth = lw * 1.3;
    c.lineCap = 'round';
    c.stroke();

    ellipse(c, x, y + r * 0.06, r * 0.92, r * 0.94);
    fillStroke(c, body, ink, lw);
    c.save();
    c.beginPath();
    ellipse(c, x, y + r * 0.06, r * 0.92, r * 0.94);
    c.clip();
    c.strokeStyle = shade(body, 0.22);
    c.lineWidth = lw * 0.7;
    for (const o of [-0.42, 0, 0.42]) {
      c.beginPath();
      c.moveTo(x + r * o, y - r * 0.95);
      c.quadraticCurveTo(x + r * o * 2.1, y + r * 0.1, x + r * o, y + r * 1.05);
      c.stroke();
    }
    c.restore();
    return;
  }

  if (type === 'tomato') {
    const body = INGREDIENT_COLORS.tomato;
    ellipse(c, x, y + r * 0.08, r * 0.95, r * 0.88);
    fillStroke(c, body, ink, lw);
    c.save();
    c.globalAlpha = 0.55;
    ellipse(c, x - r * 0.34, y - r * 0.28, r * 0.24, r * 0.16);
    c.fillStyle = '#fff';
    c.fill();
    c.restore();
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      c.moveTo(x, y - r * 0.62);
      c.lineTo(x + Math.cos(a) * r * 0.5, y - r * 0.62 + Math.sin(a) * r * 0.34);
    }
    c.strokeStyle = '#3f9b4b';
    c.lineWidth = lw * 1.5;
    c.lineCap = 'round';
    c.stroke();
    c.beginPath();
    c.moveTo(x, y - r * 0.62);
    c.lineTo(x, y - r * 1.05);
    c.strokeStyle = '#3f9b4b';
    c.lineWidth = lw * 1.3;
    c.stroke();
    return;
  }

  // mushroom
  const cap = INGREDIENT_COLORS.mushroom;
  c.beginPath();
  c.moveTo(x - r * 0.34, y - r * 0.05);
  c.lineTo(x - r * 0.28, y + r * 0.72);
  c.quadraticCurveTo(x, y + r * 1.0, x + r * 0.28, y + r * 0.72);
  c.lineTo(x + r * 0.34, y - r * 0.05);
  c.closePath();
  fillStroke(c, '#f6e9d2', ink, lw);
  c.beginPath();
  c.moveTo(x - r * 0.95, y - r * 0.02);
  c.quadraticCurveTo(x - r * 0.9, y - r * 1.05, x, y - r * 1.02);
  c.quadraticCurveTo(x + r * 0.9, y - r * 1.05, x + r * 0.95, y - r * 0.02);
  c.quadraticCurveTo(x, y + r * 0.26, x - r * 0.95, y - r * 0.02);
  c.closePath();
  fillStroke(c, cap, ink, lw);
  c.fillStyle = tint(cap, 0.5);
  for (const [dx, dy, rr2] of [
    [-0.42, -0.5, 0.16],
    [0.12, -0.68, 0.13],
    [0.5, -0.38, 0.12],
  ]) {
    circle(c, x + r * dx, y + r * dy, r * rr2);
    c.fill();
  }
}

/** Ingredient on a tinted disc — the order-ticket treatment. */
export function drawTicketIcon(c, type, x, y, r) {
  c.save();
  circle(c, x, y, r * 1.16);
  fillStroke(c, tint(INGREDIENT_COLORS[type], 0.72), PAL.ink, r * 0.13);
  drawWhole(c, type, x, y, r * 0.82);
  c.restore();
}

export function soupColor(contents) {
  if (contents.length === 0) return '#e8c88a';
  let acc = INGREDIENT_COLORS[contents[0]];
  for (let i = 1; i < contents.length; i++) {
    acc = mix(acc, INGREDIENT_COLORS[contents[i]], 1 / (i + 1));
  }
  return mix(acc, '#c8843c', 0.32);
}

export function drawPlate(c, x, y, r, soup) {
  const lw = r * 0.14;
  ellipse(c, x, y, r, r * 0.8);
  fillStroke(c, PAL.plate, PAL.ink, lw);
  ellipse(c, x, y, r * 0.72, r * 0.55);
  fillStroke(c, soup ? shade(PAL.plateShade, 0.05) : PAL.plateShade, null, 0);
  if (soup && soup.length > 0) {
    const col = soupColor(soup);
    ellipse(c, x, y, r * 0.66, r * 0.5);
    fillStroke(c, col, shade(col, 0.35), lw * 0.7);
    for (let i = 0; i < soup.length; i++) {
      const a = (i / soup.length) * Math.PI * 2 + 0.6;
      circle(c, x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.2, r * 0.13);
      c.fillStyle = tint(INGREDIENT_COLORS[soup[i]], 0.12);
      c.fill();
    }
  }
  c.save();
  c.globalAlpha = 0.5;
  ellipse(c, x - r * 0.3, y - r * 0.2, r * 0.17, r * 0.08);
  c.fillStyle = '#fff';
  c.fill();
  c.restore();
}

/** Rising wisps. `phase` picks a frozen moment of the animation. */
export function drawSteam(c, x, y, r, phase, color = 'rgba(255,255,255,0.75)') {
  c.save();
  for (let i = 0; i < 3; i++) {
    const t = (phase * 0.55 + i / 3) % 1;
    const yy = y - t * r * 2.4;
    const xx = x + Math.sin((t + i) * 5.2) * r * 0.45 + (i - 1) * r * 0.3;
    const rad = r * (0.2 + t * 0.42);
    c.globalAlpha = Math.max(0, 0.6 * (1 - t));
    circle(c, xx, yy, rad);
    c.fillStyle = color;
    c.fill();
  }
  c.restore();
}

/* --- chef blob (copied from render/players.ts, held to a static pose) --- */

/** Where the chef holds whatever they are carrying, relative to their centre. */
function heldOffset(R, dx, dy, facingAway) {
  return [
    facingAway ? -dy * R * 1.15 + dx * R * 0.3 : dx * R * 1.3,
    (facingAway ? dx * R * 1.15 + dy * R * 0.3 : dy * R * 1.3) + R * 0.1,
  ];
}

/**
 * Just the carried item, in the chef's hands. Split out so a scene can paint
 * it after the counter — otherwise the counter would swallow it.
 */
export function drawChefHeld(c, x, y, opts) {
  const held = opts.held;
  if (!held) return;
  const R = opts.r;
  const angle = opts.angle ?? Math.PI / 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const [ox, oy] = heldOffset(R, dx, dy, dy < -0.35);
  const hx = x + ox;
  const hy = y + oy;
  ellipse(c, hx, hy + R * 0.5, R * 0.5, R * 0.2);
  c.fillStyle = 'rgba(30, 16, 8, 0.22)';
  c.fill();
  if (held.kind === 'plate') drawPlate(c, hx, hy, R * 0.62, held.soup);
  else drawWhole(c, held.type, hx, hy, R * 0.62 * 0.86);
}

/**
 * @param opts.r        body radius in px
 * @param opts.angle    facing direction; Math.PI/2 looks at the camera
 * @param opts.held     null | {kind:'plate', soup:[...]} | {kind:'ing', type}
 * @param opts.deferHeld  skip the carried item; call drawChefHeld later
 */
export function drawChef(c, x, y, opts) {
  const R = opts.r;
  const color = opts.color;
  const angle = opts.angle ?? Math.PI / 2;
  const lw = R * 0.13;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  c.save();
  c.translate(x, y);

  // ground shadow
  ellipse(c, 0, R * 0.86, R * 0.92, R * 0.36);
  c.fillStyle = 'rgba(30, 16, 8, 0.35)';
  c.fill();

  const held = opts.deferHeld ? null : (opts.held ?? null);
  const facingAway = dy < -0.35;
  const drawHeld = () => {
    if (!held) return;
    const [ox, oy] = heldOffset(R, dx, dy, facingAway);
    ellipse(c, ox, oy + R * 0.5, R * 0.5, R * 0.2);
    c.fillStyle = 'rgba(30, 16, 8, 0.22)';
    c.fill();
    if (held.kind === 'plate') drawPlate(c, ox, oy, R * 0.62, held.soup);
    else drawWhole(c, held.type, ox, oy, R * 0.62 * 0.86);
  };
  if (facingAway) drawHeld();

  // body
  const g = c.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, tint(color, 0.28));
  g.addColorStop(1, shade(color, 0.2));
  circle(c, 0, 0, R);
  fillStroke(c, g, PAL.ink, lw * 1.5);

  // apron bib
  c.save();
  circle(c, 0, 0, R - lw * 0.6);
  c.clip();
  c.beginPath();
  c.ellipse(dx * R * 0.42, dy * R * 0.42 + R * 0.28, R * 0.62, R * 0.5, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255, 252, 242, 0.34)';
  c.fill();
  c.restore();

  // eyes
  const ex = -dy;
  const ey = dx;
  for (const s of [-1, 1]) {
    const bx = dx * R * 0.3 + ex * s * R * 0.36;
    const by = dy * R * 0.3 + ey * s * R * 0.36;
    circle(c, bx, by, R * 0.24);
    fillStroke(c, '#fffdf7', PAL.ink, lw * 0.9);
    circle(c, bx + dx * R * 0.09, by + dy * R * 0.09, R * 0.11);
    c.fillStyle = PAL.ink;
    c.fill();
  }

  // chef hat
  const hy = -R * 0.92;
  inked(
    c,
    () => {
      c.moveTo(-R * 0.6, hy + R * 0.02);
      c.lineTo(R * 0.6, hy + R * 0.02);
      c.lineTo(R * 0.6, hy + R * 0.34);
      c.lineTo(-R * 0.6, hy + R * 0.34);
      c.closePath();
      for (const [cx, cy, r] of [
        [-R * 0.4, hy - R * 0.16, R * 0.36],
        [R * 0.4, hy - R * 0.16, R * 0.36],
        [0, hy - R * 0.34, R * 0.44],
      ]) {
        c.moveTo(cx + r, cy);
        c.arc(cx, cy, r, 0, Math.PI * 2);
      }
    },
    '#fffdf6',
    lw,
  );
  rr(c, -R * 0.62, hy + R * 0.04, R * 1.24, R * 0.28, R * 0.12);
  fillStroke(c, shade(color, 0.05), PAL.ink, lw);

  if (!facingAway) drawHeld();
  c.restore();
}

/* --- pot (copied from render/tiles.ts, unit space scaled to px) --- */

const OUT = 0.055;

/** Pot of soup, centred on (x, y). `s` is the tile size in px. */
export function drawPot(c, x, y, s, contents = ['tomato', 'onion'], phase = 0.4) {
  c.save();
  c.translate(x - s * 0.5, y - s * 0.5);
  c.scale(s, s);
  c.lineJoin = 'round';
  c.lineCap = 'round';

  const cx = 0.5;
  const cy = 0.5;

  ellipse(c, cx, cy + 0.27, 0.38, 0.12);
  fillStroke(c, PAL.metalDark, PAL.ink, OUT * 0.8);

  for (const sgn of [-1, 1]) {
    rr(c, cx + sgn * 0.3 - (sgn > 0 ? 0 : 0.13), cy - 0.04, 0.13, 0.13, 0.06);
    fillStroke(c, PAL.metalDark, PAL.ink, OUT * 0.8);
  }

  const bg = c.createLinearGradient(0, cy - 0.22, 0, cy + 0.3);
  bg.addColorStop(0, PAL.potHi);
  bg.addColorStop(1, PAL.pot);
  rr(c, cx - 0.33, cy - 0.19, 0.66, 0.47, 0.13);
  fillStroke(c, bg, PAL.ink, OUT);

  ellipse(c, cx, cy - 0.19, 0.34, 0.115);
  fillStroke(c, PAL.potRim, PAL.ink, OUT);

  if (contents.length > 0) {
    const col = soupColor(contents);
    ellipse(c, cx, cy - 0.19, 0.275, 0.088);
    fillStroke(c, col, shade(col, 0.4), OUT * 0.6);
    for (let i = 0; i < contents.length; i++) {
      const a = (i / contents.length) * Math.PI * 2 + phase * 2.4;
      circle(c, cx + Math.cos(a) * 0.125, cy - 0.19 + Math.sin(a) * 0.036, 0.04);
      c.fillStyle = tint(INGREDIENT_COLORS[contents[i]], 0.15);
      c.fill();
    }
  }

  c.restore();

  drawSteam(c, x, y - s * 0.32, s * 0.18, phase, 'rgba(255, 248, 232, 0.95)');
}

/* --- order ticket (copied from render/hud.ts) --- */

/** Paper order ticket. `u` scales the internal furniture (1 = 1080p). */
export function drawTicket(c, x, y, w, h, recipe, u, rotate = 0, frac = 0.66) {
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate(rotate);
  c.translate(-w / 2, -h / 2);

  rr(c, 0, u * 5, w, h, u * 10);
  c.fillStyle = 'rgba(20, 11, 6, 0.5)';
  c.fill();

  rr(c, 0, 0, w, h, u * 10);
  fillStroke(c, '#fff6e3', PAL.ink, Math.max(2, u * 4));

  rr(c, u * 7, u * 7, w - u * 14, u * 8, u * 4);
  c.fillStyle = 'rgba(107, 69, 38, 0.22)';
  c.fill();

  const n = Math.max(1, recipe.length);
  const iconR = Math.min(u * 21, (w - u * 18) / (n * 2.25));
  const step = (w - u * 16) / n;
  for (let i = 0; i < n; i++) {
    drawTicketIcon(c, recipe[i], u * 8 + step * (i + 0.5), h * 0.46, iconR);
  }

  const bx = u * 10;
  const bw = w - u * 20;
  const bh = u * 13;
  const by = h - bh - u * 10;
  rr(c, bx, by, bw, bh, bh / 2);
  fillStroke(c, 'rgba(59, 35, 20, 0.22)', null, 0);
  const fw = frac * (bw - bh * 0.2);
  rr(c, bx + bh * 0.1, by + bh * 0.16, Math.max(fw, bh * 0.8), bh * 0.68, bh * 0.34);
  c.fillStyle = frac < 0.5 ? PAL.amber : PAL.green;
  c.fill();

  c.restore();
}

/* --- decorative QR --- */

/**
 * A QR-SHAPED ORNAMENT. The modules come from a fixed seeded PRNG, so this
 * is not a scannable code and encodes no URL. It only carries the visual
 * motif of the lobby's "scan to play" card.
 */
export function drawFakeQr(c, x, y, size, opts = {}) {
  const modules = opts.modules ?? 25;
  const dark = opts.dark ?? '#2a1710';
  const light = opts.light ?? '#ffffff';
  const m = size / modules;

  c.save();
  c.fillStyle = light;
  c.fillRect(x, y, size, size);

  // deterministic noise
  let seed = 0x1f2e3d4c;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1000) / 1000;
  };

  const inFinder = (i, j) =>
    (i < 8 && j < 8) ||
    (i >= modules - 8 && j < 8) ||
    (i < 8 && j >= modules - 8);

  c.fillStyle = dark;
  for (let j = 0; j < modules; j++) {
    for (let i = 0; i < modules; i++) {
      if (inFinder(i, j)) continue;
      if (rand() > 0.52) c.fillRect(x + i * m, y + j * m, m + 0.4, m + 0.4);
    }
  }

  // three finder eyes
  const finder = (i, j) => {
    c.fillStyle = dark;
    c.fillRect(x + i * m, y + j * m, m * 7, m * 7);
    c.fillStyle = light;
    c.fillRect(x + (i + 1) * m, y + (j + 1) * m, m * 5, m * 5);
    c.fillStyle = dark;
    c.fillRect(x + (i + 2) * m, y + (j + 2) * m, m * 3, m * 3);
  };
  finder(0, 0);
  finder(modules - 7, 0);
  finder(0, modules - 7);

  // alignment square, bottom-right
  const a = modules - 9;
  c.fillStyle = dark;
  c.fillRect(x + a * m, y + a * m, m * 5, m * 5);
  c.fillStyle = light;
  c.fillRect(x + (a + 1) * m, y + (a + 1) * m, m * 3, m * 3);
  c.fillStyle = dark;
  c.fillRect(x + (a + 2) * m, y + (a + 2) * m, m, m);

  c.restore();
}

/* --- backdrop --- */

/** The lobby's warm radial kitchen backdrop, painted into a canvas. */
export function drawBackdrop(c, w, h, opts = {}) {
  const g = c.createRadialGradient(
    w * 0.5,
    h * -0.1,
    0,
    w * 0.5,
    h * -0.1,
    Math.max(w, h) * (opts.spread ?? 1.05),
  );
  g.addColorStop(0, '#7a3f1c');
  g.addColorStop(0.45, '#4a2412');
  g.addColorStop(1, '#23140c');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}
