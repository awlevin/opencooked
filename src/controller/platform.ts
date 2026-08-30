// Mobile hardening: kill browser gestures that fight a gamepad, keep the
// screen awake, remember the player name, and vibrate.

const NAME_KEY = 'ocp.name';
const ROOM_KEY = 'ocp.room';

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

export const loadName = (): string => readLocal(NAME_KEY);
export const saveName = (n: string): void => writeLocal(NAME_KEY, n);
export const loadRoom = (): string => readLocal(ROOM_KEY);
export const saveRoom = (r: string): void => writeLocal(ROOM_KEY, r);

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
let wakeLockWired = false;

function wakeLockApi(): WakeLockLike | null {
  const nav = navigator as Navigator & { wakeLock?: WakeLockLike };
  return nav.wakeLock ?? null;
}

/** Best effort. Every failure mode here is fine to ignore. */
export function requestWakeLock(): void {
  const api = wakeLockApi();
  if (!api || document.visibilityState !== 'visible') return;
  if (sentinel && !sentinel.released) return;
  api
    .request('screen')
    .then((s) => {
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
      });
    })
    .catch(() => {
      sentinel = null;
    });

  if (!wakeLockWired) {
    wakeLockWired = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    });
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
 */
export function lockGestures(): void {
  document.addEventListener(
    'touchmove',
    (e) => {
      if (isScrollable(e.target)) return;
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );

  // Safari pinch gestures.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(
      type,
      (e) => {
        if (e.cancelable) e.preventDefault();
      },
      { passive: false },
    );
  }

  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  document.addEventListener('selectstart', (e) => {
    if (!isTextField(e.target)) e.preventDefault();
  });

  // Belt and braces for double-tap zoom on older iOS.
  let lastTouchEnd = 0;
  document.addEventListener(
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
  window.addEventListener('scroll', () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  });
}
