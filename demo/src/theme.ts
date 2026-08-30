// Art direction, lifted straight from components/host/host.css so the video
// and the game read as one thing.

export const PAL = {
  ink: '#3b2314',
  inkSoft: '#6b4526',
  cream: '#fff6e3',
  cream2: '#ffeac2',
  butter: '#ffd23f',
  tomato: '#e8503a',
  mint: '#2ec4a0',
  wood: '#b8763c',
  night: '#1c110a',
} as const;

/** The lobby's warm kitchen backdrop. */
export const BACKDROP =
  'radial-gradient(120% 80% at 50% -10%, #7a3f1c 0%, #4a2412 45%, #23140c 100%)';

/** The faint diagonal weave the lobby lays over that backdrop. */
export const WEAVE =
  'repeating-linear-gradient(-45deg, rgba(255,226,168,0.045) 0 22px, rgba(0,0,0,0) 22px 64px)';

/** Chunky cartoon outline + drop shadow, the way the host draws text. */
export const outlined = (em: number, shadow = 0.09): React.CSSProperties => ({
  WebkitTextStroke: `${em}em ${PAL.ink}`,
  paintOrder: 'stroke fill',
  textShadow: `0 ${shadow}em 0 rgba(59, 35, 20, 0.55)`,
});
