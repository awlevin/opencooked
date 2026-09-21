// Mobile hardening: kill browser gestures that fight a gamepad, keep the
// screen awake, remember the player name and seat token, and vibrate.
//
// Everything is lazy — no window/document work happens at import time — and
// every listener this module installs can be taken back off again, so React
// StrictMode's mount/unmount/mount cycle leaves nothing behind.

const NAME_KEY = 'opencooked.name';
const ROOM_KEY = 'opencooked.room';
const TOKEN_PREFIX = 'opencooked.token.';
const TUTORIAL_KEY = 'opencooked.tutorial-seen';

/* ------------------------------- storage -------------------------------- */

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode; not important */
  }
}

function dropLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode; not important */
  }
}

export const loadName = (): string => readLocal(NAME_KEY);
export const saveName = (n: string): void => writeLocal(NAME_KEY, n);
export const loadRoom = (): string => readLocal(ROOM_KEY);
export const saveRoom = (r: string): void => writeLocal(ROOM_KEY, r);
export const hasSeenTutorial = (): boolean => readLocal(TUTORIAL_KEY) === '1';
export const markTutorialSeen = (): void => writeLocal(TUTORIAL_KEY, '1');

/* -------------------------------- seat token ----------------------------- */
// The server hands back a token on 'joined'. Replaying it on the next 'join'
// reclaims the same chef — name, colour and whatever is in their hands — after
// a drop. On Vercel every socket dies at the 300 s function cap, so this is the
// normal path mid-round, not an edge case.

const tokenKey = (room: string): string => TOKEN_PREFIX + room.toUpperCase();

export const loadToken = (room: string): string => (room ? readLocal(tokenKey(room)) : '');
export const saveToken = (room: string, token: string): void => {
  if (room && token) writeLocal(tokenKey(room), token);
};
export const clearToken = (room: string): void => {
  if (room) dropLocal(tokenKey(room));
};

/* ------------------------------- haptics -------------------------------- */

/** Longest pattern we will play, so a bad packet cannot buzz for a minute. */
const MAX_BUZZ_STEPS = 9;

/** A button press, or the lighter touch of finding the stick. */
export type TickWeight = 'press' | 'touch';

/**
 * How long each kind of local tap is felt for. Both are far shorter than the
 * shortest thing the server sends (25 ms), so a press reads as a click under
 * the thumb and never as "something happened in the kitchen".
 */
const TICK_MS: Record<TickWeight, number> = { press: 12, touch: 7 };

/** When whatever the server last asked for is due to stop playing. */
let buzzingUntil = 0;

function vibrate(pattern: number | number[]): boolean {
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return false; // iOS Safari: no haptics
  try {
    nav.vibrate(pattern);
  } catch {
    /* unsupported or blocked */
  }
  return true;
}

/**
 * Vibrate. A number is one pulse; an array is a pattern — buzz, pause, buzz,
 * … — which is how a great serve is felt as two pulses and a perfect one as
 * three. Every step is clamped, because this comes off the wire.
 */
export function buzz(ms: number | number[]): void {
  const step = (v: unknown): number =>
    Math.max(1, Math.min(1000, Math.round(typeof v === 'number' && Number.isFinite(v) ? v : 0)));
  const pattern = Array.isArray(ms) ? ms.slice(0, MAX_BUZZ_STEPS).map(step) : step(ms);
  if (Array.isArray(pattern) && pattern.length === 0) return;
  if (!vibrate(pattern)) return;
  const total = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
  buzzingUntil = performance.now() + total;
}

/**
 * The click under a control, fired on pointerdown and never off the wire: the
 * phone answers the thumb before the server has even heard about the press.
 *
 * `navigator.vibrate` replaces whatever is already playing, so a tick that
 * lands during a pattern would cut it short — and trading the three pulses of
 * a perfect serve for "you pressed a button" is a bad trade. While the server's
 * buzz is still running the phone is already talking, so the tick stands down.
 */
export function tick(weight: TickWeight = 'press'): void {
  if (performance.now() < buzzingUntil) return;
  vibrate(TICK_MS[weight]);
}

/* ------------------------------ wake lock ------------------------------- */

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

let sentinel: WakeLockSentinelLike | null = null;
let wakeLockWanted = false;
let wakeLockVisListener: (() => void) | null = null;

function wakeLockApi(): WakeLockLike | null {
  const nav = navigator as Navigator & { wakeLock?: WakeLockLike };
  return nav.wakeLock ?? null;
}

function acquireWakeLock(): void {
  const api = wakeLockApi();
  if (!api || !wakeLockWanted || document.visibilityState !== 'visible') return;
  if (sentinel && !sentinel.released) return;
  api
    .request('screen')
    .then((s) => {
      // The controller may have gone away while the request was in flight.
      if (!wakeLockWanted) {
        void s.release().catch(() => {});
        return;
      }
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
      });
    })
    .catch(() => {
      sentinel = null;
    });
}

/** Best effort. Every failure mode here is fine to ignore. */
export function requestWakeLock(): void {
  wakeLockWanted = true;
  if (!wakeLockVisListener) {
    wakeLockVisListener = () => {
      if (document.visibilityState === 'visible') acquireWakeLock();
    };
    document.addEventListener('visibilitychange', wakeLockVisListener);
  }
  acquireWakeLock();
}

/** Hands the screen back to the OS. Idempotent. */
export function releaseWakeLock(): void {
  wakeLockWanted = false;
  if (wakeLockVisListener) {
    document.removeEventListener('visibilitychange', wakeLockVisListener);
    wakeLockVisListener = null;
  }
  const s = sentinel;
  sentinel = null;
  if (s && !s.released) void s.release().catch(() => {});
}

/* ----------------------------- orientation ------------------------------ */

interface OrientationLike {
  lock?: (o: string) => Promise<void>;
  unlock?: () => void;
}

function orientationApi(): OrientationLike | null {
  const s = screen as Screen & { orientation?: OrientationLike };
  return s.orientation ?? null;
}

/**
 * Ask the OS to hold the phone in landscape. Browsers only grant this to a
 * fullscreen page, and iOS Safari not at all, so it is a gift from the phones
 * that allow it rather than the answer to one held upright — that is what the
 * rotate hint is for. Every refusal is expected, and silent.
 */
export function lockLandscape(): void {
  const api = orientationApi();
  if (typeof api?.lock !== 'function') return;
  try {
    void api.lock('landscape').catch(() => {});
  } catch {
    /* not allowed outside fullscreen */
  }
}

/** Hands the orientation back to the OS. Idempotent, and safe if never locked. */
export function unlockOrientation(): void {
  const api = orientationApi();
  if (typeof api?.unlock !== 'function') return;
  try {
    api.unlock();
  } catch {
    /* nothing was locked */
  }
}

/* ------------------------------- gestures ------------------------------- */

function isTextField(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.closest('input, textarea, [contenteditable="true"]') !== null;
}

function isScrollable(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.closest('[data-scroll]') !== null;
}

/**
 * Stops scroll, rubber-band bounce, pinch zoom, double-tap zoom, callouts and
 * text selection everywhere except text fields and opt-in scroll regions.
 *
 * Returns a disposer: the controller is a route now, not a whole document, so
 * these must come off when the player leaves.
 */
export function lockGestures(): () => void {
  const off: Array<() => void> = [];

  const on = <T extends EventTarget>(
    target: T,
    type: string,
    handler: EventListener,
    opts?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, handler, opts);
    off.push(() => target.removeEventListener(type, handler, opts));
  };

  on(
    document,
    'touchmove',
    (e) => {
      if (isScrollable(e.target)) return;
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );

  // Safari pinch gestures.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    on(
      document,
      type,
      (e) => {
        if (e.cancelable) e.preventDefault();
      },
      { passive: false },
    );
  }

  on(document, 'contextmenu', (e) => e.preventDefault());
  on(document, 'dblclick', (e) => e.preventDefault());

  on(document, 'selectstart', (e) => {
    if (!isTextField(e.target)) e.preventDefault();
  });

  // Belt and braces for double-tap zoom on older iOS.
  let lastTouchEnd = 0;
  on(
    document,
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 320 && !isTextField(e.target) && e.cancelable) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false },
  );

  return () => {
    for (const d of off) d();
    off.length = 0;
  };
}
