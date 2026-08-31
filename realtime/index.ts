// Public surface of the realtime layer for the SERVER entry points
// (server/local.ts and app/api/ws/route.ts). They should need nothing else.
//
// The host tab does not come through here: importing this module pulls in
// `backend.ts`, and with it ioredis. The tab builds its own manager over an
// in-memory backend — see `realtime/host.ts`.

import type { WebSocket } from 'ws';

import { getBackend } from './backend';
import type { Conn } from './conn';
import { connFromWs } from './conn';
import { RoomManager } from './manager';

export type { Conn } from './conn';
export { connFromWs } from './conn';
export { RoomManager } from './manager';

let singleton: RoomManager | null = null;

/** One manager per process; both server entry points share it. */
export function getManager(): RoomManager {
  return (singleton ??= new RoomManager(getBackend));
}

/** Hand a transport-agnostic connection to the room manager. */
export function attachConnection(conn: Conn): void {
  getManager().attach(conn);
}

/** Hand a `ws` socket (local server or Vercel upgrade) to the room manager. */
export function attachWebSocket(ws: WebSocket): void {
  ws.on('error', (err) => console.error('[ws] socket error:', err));
  attachConnection(connFromWs(ws));
}
