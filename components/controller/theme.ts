// Tints the whole UI with the player colour the server assigned, so a person
// can match their phone to their chef on the TV.

export const DEFAULT_ACCENT = '#f1c40f';

const ACCENT_VARS = [
  '--accent',
  '--accent-bright',
  '--accent-deep',
  '--accent-shadow',
  '--accent-wash',
  '--accent-glow',
  '--accent-faint',
  '--accent-hairline',
] as const;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let body = m[1];
  if (body.length === 3) {
    body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  }
  const n = Number.parseInt(body, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function css(c: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

// The root layout ships a <meta name="theme-color">; remember what it said so
// unmounting the controller hands the browser chrome back unchanged.
let priorThemeColor: string | null = null;
let themeColorSaved = false;

function themeColorMeta(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (!themeColorSaved) {
    themeColorSaved = true;
    priorThemeColor = meta.content || null;
  }
  return meta;
}

/** Sets --accent and its derived shades on :root. Ignores bad colours. */
export function applyAccent(color: string): void {
  const rgb = parseHex(color) ?? parseHex(DEFAULT_ACCENT);
  if (!rgb) return;
  const black: Rgb = { r: 6, g: 8, b: 13 };
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const s = document.documentElement.style;
  s.setProperty('--accent', css(rgb));
  s.setProperty('--accent-bright', css(mix(rgb, white, 0.35)));
  s.setProperty('--accent-deep', css(mix(rgb, black, 0.45)));
  s.setProperty('--accent-shadow', css(mix(rgb, black, 0.72)));
  s.setProperty('--accent-wash', css(mix(rgb, black, 0.88)));
  s.setProperty('--accent-glow', css(rgb, 0.42));
  s.setProperty('--accent-faint', css(rgb, 0.16));
  s.setProperty('--accent-hairline', css(rgb, 0.32));

  // Colour the browser chrome too.
  themeColorMeta().content = css(mix(rgb, black, 0.86));
}

/**
 * Undoes applyAccent. The controller lives on a client-navigable route now, so
 * leaving a chef's colour bolted onto :root would follow the player off the page.
 */
export function resetAccent(): void {
  const s = document.documentElement.style;
  for (const v of ACCENT_VARS) s.removeProperty(v);
  if (themeColorSaved) {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta && priorThemeColor !== null) meta.content = priorThemeColor;
    themeColorSaved = false;
    priorThemeColor = null;
  }
}
