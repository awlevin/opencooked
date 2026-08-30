// The one thing the room manager knows about a socket.
//
// Both entry points hand us a `ws` WebSocket (the local server owns its own
// WebSocketServer; `experimental_upgradeWebSocket` hands the route handler a
// `ws` socket too), but the manager never sees that type: everything below
// this line is testable with a plain object.

import type { WebSocket } from 'ws';

import type { S2C } from '../shared/protocol';

import { randomId } from './ids';

export interface Conn {
  /** Stable per-connection id. Also the bus routing address before a join. */
  readonly id: string;
  readonly open: boolean;
  send(msg: S2C): void;
  close(): void;
  onMessage(fn: (data: string) => void): void;
  onClose(fn: () => void): void;
}

const OPEN = 1;

/** Adapt a `ws` socket (local server or Vercel upgrade) onto `Conn`. */
export function connFromWs(ws: WebSocket): Conn {
  const id = randomId(9);
  return {
    id,
    get open() {
      return ws.readyState === OPEN;
    },
    send(msg) {
      if (ws.readyState !== OPEN) return;
      try {
        ws.send(JSON.stringify(msg));
      } catch (err) {
        console.error('[ws] send failed:', err);
      }
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    },
    onMessage(fn) {
      ws.on('message', (data: unknown) => {
        try {
          fn(typeof data === 'string' ? data : String(data));
        } catch (err) {
          console.error('[ws] message handling failed:', err);
        }
      });
    },
    onClose(fn) {
      ws.on('close', () => {
        try {
          fn();
        } catch (err) {
          console.error('[ws] close handling failed:', err);
        }
      });
    },
  };
}
