// Tints the whole UI with the player colour the server assigned, so a person
// can match their phone to their chef on the TV.

export const DEFAULT_ACCENT = '#f1c40f';

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
  return alpha >= 1
    ? `rgb(${c.r}, ${c.g}, ${c.b})`
    : `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
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
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = css(mix(rgb, black, 0.86));
}
