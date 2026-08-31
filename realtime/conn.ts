// The one thing the room manager knows about a socket.
//
// Three transports arrive here, and the manager can tell none of them apart:
//
//   connFromWs           a `ws` socket (local server, or the Vercel upgrade)
//   connFromDataChannel  an RTCDataChannel straight from a phone on the Wi-Fi
//   connLoopback         an in-process pipe, so the host tab's own renderer
//                        can be a first-class client of its own room
//
// Everything below this line is testable with a plain object.

import type { WebSocket } from 'ws';

import type { C2S, S2C } from '../shared/protocol';

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

/**
 * Adapt an open (or opening) RTCDataChannel onto `Conn`.
 *
 * The channel is unreliable and unordered by design, and the bytes on it come
 * from a phone we have never met, so: a malformed frame is dropped, a send on
 * a half-closed channel is dropped, and neither ever throws into the room
 * loop. `error` counts as a close — an errored channel never recovers, and
 * the seat must start its grace clock rather than wait for a timeout.
 */
export function connFromDataChannel(ch: RTCDataChannel): Conn {
  const id = randomId(9);
  let closed = false;
  const onCloseFns: (() => void)[] = [];

  const fireClose = (): void => {
    if (closed) return;
    closed = true;
    for (const fn of onCloseFns) {
      try {
        fn();
      } catch (err) {
        console.error('[rtc] close handling failed:', err);
      }
    }
  };

  ch.addEventListener('close', fireClose);
  ch.addEventListener('error', fireClose);

  return {
    id,
    get open() {
      return !closed && ch.readyState === 'open';
    },
    send(msg) {
      if (closed || ch.readyState !== 'open') return;
      try {
        ch.send(JSON.stringify(msg));
      } catch (err) {
        // A full SCTP send buffer throws; a joystick frame is not worth a
        // retry, and the next one is 33 ms away.
        console.warn('[rtc] send dropped:', err);
      }
    },
    close() {
      try {
        ch.close();
      } catch {
        /* already gone */
      }
      fireClose();
    },
    onMessage(fn) {
      ch.addEventListener('message', (ev: MessageEvent<unknown>) => {
        const data = ev.data;
        // Binary frames are not part of the contract; ignore them outright
        // rather than stringifying an ArrayBuffer into garbage.
        if (typeof data !== 'string') return;
        try {
          fn(data);
        } catch (err) {
          console.error('[rtc] message handling failed:', err);
        }
      });
    },
    onClose(fn) {
      if (closed) {
        fn();
        return;
      }
      onCloseFns.push(fn);
    },
  };
}

/** Both ends of an in-process connection: one `Conn`, one client handle. */
export interface Loopback {
  /** Hand this to the room manager. */
  readonly conn: Conn;
  /** Say something to the room, exactly as a socket client would. */
  send(msg: C2S): void;
  /** Everything the room says back to this connection. */
  onMessage(fn: (msg: S2C) => void): void;
  close(): void;
}

/**
 * A connection with no transport under it. The host tab uses one to talk to
 * the room it is itself running: same protocol, same room manager, no socket
 * and no serialization on the hot path (`state` at 20 Hz).
 */
export function connLoopback(): Loopback {
  const id = randomId(9);
  let open = true;
  let toManager: ((raw: string) => void) | null = null;
  let toClient: ((msg: S2C) => void) | null = null;
  /** Frames said before either side wired up its handler. */
  const inbox: string[] = [];
  const outbox: S2C[] = [];
  const closeFns: (() => void)[] = [];

  const conn: Conn = {
    id,
    get open() {
      return open;
    },
    send(msg) {
      if (!open) return;
      if (toClient) toClient(msg);
      else outbox.push(msg);
    },
    close() {
      if (!open) return;
      open = false;
      for (const fn of closeFns) {
        try {
          fn();
        } catch (err) {
          console.error('[loopback] close handling failed:', err);
        }
      }
    },
    onMessage(fn) {
      toManager = fn;
      const queued = inbox.splice(0, inbox.length);
      for (const raw of queued) fn(raw);
    },
    onClose(fn) {
      if (!open) {
        fn();
        return;
      }
      closeFns.push(fn);
    },
  };

  return {
    conn,
    send(msg) {
      if (!open) return;
      const raw = JSON.stringify(msg);
      if (toManager) toManager(raw);
      else inbox.push(raw);
    },
    onMessage(fn) {
      toClient = fn;
      const queued = outbox.splice(0, outbox.length);
      for (const msg of queued) fn(msg);
    },
    close() {
      conn.close();
    },
  };
}
