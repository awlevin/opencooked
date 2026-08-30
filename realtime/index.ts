// Public surface of the realtime layer. Entry points (server/local.ts and
// app/api/ws/route.ts) should need nothing else.

import type { WebSocket } from 'ws';

import type { Conn } from './conn';
import { connFromWs } from './conn';
import { getManager } from './manager';

export type { Conn } from './conn';
export { connFromWs } from './conn';
export { getManager, RoomManager } from './manager';

/** Hand a transport-agnostic connection to the room manager. */
export function attachConnection(conn: Conn): void {
  getManager().attach(conn);
}

/** Hand a `ws` socket (local server or Vercel upgrade) to the room manager. */
export function attachWebSocket(ws: WebSocket): void {
  ws.on('error', (err) => console.error('[ws] socket error:', err));
  attachConnection(connFromWs(ws));
}
