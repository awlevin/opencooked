// WebSocket wire protocol. All messages are JSON, single ws endpoint at /ws.
// This file is the contract between server, host renderer, and controller.

import type { LobbyPlayer, Phase, Snapshot, Vec2 } from './types';

export type Btn = 'a' | 'b'; // a = pick up / put down, b = chop / dash

// --- client -> server ---
export type C2S =
  // Host page announces itself; server creates a room (or, when `resume`
  // is given, reattaches to / restores that room after a socket drop —
  // Vercel functions cap connection lifetime, so hosts MUST reconnect and
  // resume). The join URL is built client-side from location.origin.
  | { t: 'hello-host'; resume?: { room: string } }
  // Controller joins a room by code (case-insensitive). `token` is the
  // value from a previous 'joined' and reclaims the same seat
  // (name/color/held item) after a reconnect.
  | { t: 'join'; room: string; name: string; token?: string }
  // Controller joystick vector, normalized, |move| <= 1. Sent on change
  // (throttled to ~30 Hz). {0,0} = stopped.
  | { t: 'input'; move: Vec2 }
  | { t: 'press'; btn: Btn }
  | { t: 'release'; btn: Btn }
  // Any controller may start the round from the lobby, or restart from
  // the gameover screen.
  | { t: 'start' }
  | { t: 'again' };

// --- server -> client ---
export type S2C =
  // To host, immediately after hello-host. resumed=true means the room
  // (and any in-flight round) was restored rather than freshly created.
  | { t: 'room'; code: string; resumed?: boolean }
  // To host and all controllers whenever the roster changes.
  | { t: 'lobby'; players: LobbyPlayer[] }
  // To a controller after a successful join. Persist `token` and send it
  // with future joins to reclaim this seat.
  | { t: 'joined'; playerId: string; color: string; name: string; token: string }
  // To everyone on phase transitions.
  | { t: 'phase'; phase: Phase }
  // To host only, ~20 Hz while playing.
  | { t: 'state'; s: Snapshot }
  // To one controller: vibrate for ms (successful pickup, serve, etc).
  | { t: 'buzz'; ms: number }
  // To everyone when the round ends.
  | { t: 'gameover'; score: number; served: number; missed: number }
  | { t: 'err'; msg: string };

export const WS_PATH = '/api/ws';
export const LOCAL_PORT = 3000;
