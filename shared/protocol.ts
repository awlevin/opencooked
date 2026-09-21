// WebSocket wire protocol. All messages are JSON, single endpoint at WS_PATH.
// This file is the contract between server, host renderer, and controller.
//
// Two ways a controller can reach the sim:
//   cloud  — phone ⇄ server ⇄ host. Always available, ~30-80 ms.
//   local  — phone ⇄ host directly over an RTCDataChannel on the same
//            Wi-Fi, ~2-5 ms. The server only brokers the handshake.
// A phone always starts on the cloud path and silently upgrades if the
// peer connection succeeds. See .private/plans/local-mode-webrtc.md.

import type { LobbyPlayer, Phase, Snapshot, Vec2 } from './types';

// Both buttons are tracked down as well as tapped: A is pick up / put down,
// and — empty-handed at a board with something raw on it, where nothing else
// makes sense — the chop, held down. B is chop / spray while held, dash on a
// tap. Every press acts on `PlayerState.target`, the tile the TV highlights.
export type Btn = 'a' | 'b';

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
  // the gameover screen. `again` may name the level to go back to the
  // lobby on, which is how the phone's "Next level" button works.
  | { t: 'start' }
  | { t: 'again'; levelId?: string }
  // Any controller may pick the kitchen, from the lobby only. Unknown ids
  // are ignored. See shared/levels for what an id may be.
  | { t: 'select'; levelId: string }
  // A seated controller renames its own chef, between rounds only (lobby or
  // gameover — a name changing mid-service is a distraction on the TV). The
  // name is re-validated exactly as it is on 'join', and the answer is the
  // next 'lobby' broadcast, which every screen already reads.
  | { t: 'rename'; name: string }
  // Any seated controller may stop the round, and any seated controller may
  // start it again — including one who did not pause it. Both are ignored
  // outside `phase === 'playing'`, and the host screen has no seat, so it
  // cannot pause on the chefs' behalf.
  | { t: 'pause' }
  | { t: 'resume' }
  // --- local mode ---
  // WebRTC handshake, relayed verbatim by the server, which never parses
  // `data` (SDP offer/answer or an ICE candidate). `to` is a playerId when
  // the host sends, or the literal 'host' when a controller sends.
  | { t: 'signal'; to: string; data: unknown }
  // Host announces it will run the sim in-tab. The server stops ticking
  // this room and becomes registry + relay only. Answered with 'sim'.
  | { t: 'claim-sim' }
  // Tunnel between a host-owned room and the server, carrying traffic for
  // controllers that could NOT establish a peer connection. `env` is an
  // internal bus envelope, opaque to this contract and owned by realtime/.
  | { t: 'bus'; env: unknown };

// --- server -> client ---
export type S2C =
  // To host, immediately after hello-host. resumed=true means the room
  // (and any in-flight round) was restored rather than freshly created.
  | { t: 'room'; code: string; resumed?: boolean }
  // To host and all controllers whenever the roster or the chosen level
  // changes. `levelId` is what a phone that joins late shows in its
  // chooser, and what the host screen draws its level card from.
  | { t: 'lobby'; players: LobbyPlayer[]; levelId: string }
  // To a controller after a successful join. Persist `token` and send it
  // with future joins to reclaim this seat.
  | { t: 'joined'; playerId: string; color: string; name: string; token: string }
  // To everyone on phase transitions.
  | { t: 'phase'; phase: Phase }
  // To host only, ~20 Hz while playing.
  | { t: 'state'; s: Snapshot }
  // To one controller: vibrate for ms (successful pickup, serve, etc). An
  // array is a `navigator.vibrate` pattern — buzz, pause, buzz, … — which is
  // how a great serve gets two pulses and a perfect one three.
  | { t: 'buzz'; ms: number | number[] }
  // To every controller on each pause transition, and to a controller that
  // joins while the kitchen is stopped. Phones never see snapshots, so this
  // is the only way they learn who paused. `by: null` means play resumed.
  | { t: 'paused'; by: LobbyPlayer | null }
  // To everyone when the round ends.
  | { t: 'gameover'; score: number; served: number; missed: number }
  | { t: 'err'; msg: string }
  // --- local mode ---
  // The other half of the handshake above. `from` is a playerId, or 'host'
  // when the host is the sender.
  | { t: 'signal'; from: string; data: unknown }
  // Who is authoritative for this room. Sent to the host after 'claim-sim'
  // and whenever ownership moves (e.g. the host tab went away and the
  // server resumed the round from its checkpoint).
  | { t: 'sim'; owner: 'host' | 'server' }
  | { t: 'bus'; env: unknown };

export const WS_PATH = '/api/ws';
export const LOCAL_PORT = 3000;
