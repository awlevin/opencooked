// Mobile hardening: kill browser gestures that fight a gamepad, keep the
// screen awake, remember the player name and seat token, and vibrate.
//
// Everything is lazy — no window/document work happens at import time — and
// every listener this module installs can be taken back off again, so React
// StrictMode's mount/unmount/mount cycle leaves nothing behind.

const NAME_KEY = 'ocp.name';
const ROOM_KEY = 'ocp.room';
const TOKEN_PREFIX = 'ocp.token.';

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

export function buzz(ms: number): void {
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(Math.max(1, Math.min(1000, Math.round(ms))));
  } catch {
    /* unsupported or blocked */
  }
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

  // Keep the viewport pinned if the keyboard or a stray gesture moves it.
  on(window, 'scroll', () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  });

  return () => {
    for (const d of off) d();
    off.length = 0;
  };
}
