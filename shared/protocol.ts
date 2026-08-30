// WebSocket wire protocol. All messages are JSON, single ws endpoint at /ws.
// This file is the contract between server, host renderer, and controller.

import type { LobbyPlayer, Phase, Snapshot, Vec2 } from './types';

export type Btn = 'a' | 'b'; // a = pick up / put down, b = chop / dash

// --- client -> server ---
export type C2S =
  // Host page announces itself; server creates a room. clientPort is the
  // port the host page was served from (5173 in dev, 3117 in prod) so the
  // server can build a LAN join URL for the QR code.
  | { t: 'hello-host'; clientPort: number }
  // Controller joins a room by code (case-insensitive).
  | { t: 'join'; room: string; name: string }
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
  // To host, immediately after hello-host.
  | { t: 'room'; code: string; joinUrl: string }
  // To host and all controllers whenever the roster changes.
  | { t: 'lobby'; players: LobbyPlayer[] }
  // To a controller after a successful join.
  | { t: 'joined'; playerId: string; color: string; name: string }
  // To everyone on phase transitions.
  | { t: 'phase'; phase: Phase }
  // To host only, ~20 Hz while playing.
  | { t: 'state'; s: Snapshot }
  // To one controller: vibrate for ms (successful pickup, serve, etc).
  | { t: 'buzz'; ms: number }
  // To everyone when the round ends.
  | { t: 'gameover'; score: number; served: number; missed: number }
  | { t: 'err'; msg: string };

export const WS_PATH = '/ws';
export const SERVER_PORT = 3117;
