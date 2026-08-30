// WebSocket link to the game server, with auto re-join and backoff.
// The server is not assumed to exist: every failure path lands on a screen the
// player can act on.

import { WS_PATH, type C2S, type S2C } from '../../shared/protocol';

export type NetStatus =
  | 'idle' // nothing open, nothing pending
  | 'connecting' // first attempt for this room
  | 'open' // socket up, join sent
  | 'reconnecting' // dropped, retrying
  | 'failed'; // gave up or server rejected us

// A round is only three minutes, so back off gently and cap low: a phone that
// drops out must be back in the kitchen in seconds, not tens of seconds.
const BASE_RETRY_MS = 400;
const MAX_RETRY_MS = 3000;

export function wsUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${WS_PATH}`;
}

export interface NetOptions {
  onMessage: (msg: S2C) => void;
  onStatus: (status: NetStatus) => void;
}

export class Net {
  private ws: WebSocket | null = null;
  private room = '';
  private name = '';
  private attempt = 0;
  private retryTimer: number | null = null;
  private stopped = true;
  private status: NetStatus = 'idle';

  constructor(private readonly opts: NetOptions) {}

  /** Connects (or reconnects) and joins `room` as `name`. */
  join(room: string, name: string): void {
    this.room = room;
    this.name = name;
    this.attempt = 0;
    this.stopped = false;
    this.setStatus('connecting');
    this.open();
  }

  /** Stops retrying and drops the socket. */
  stop(status: NetStatus = 'idle'): void {
    this.stopped = true;
    this.clearRetry();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    }
    this.setStatus(status);
  }

  send(msg: C2S): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket died between checks */
    }
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Called by the app once a join is confirmed, so backoff starts fresh. */
  markJoined(): void {
    this.attempt = 0;
  }

  private setStatus(status: NetStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus(status);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private open(): void {
    this.clearRetry();
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.setStatus('open');
      this.send({ t: 'join', room: this.room, name: this.name });
    };

    ws.onmessage = (ev: MessageEvent<unknown>) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      let msg: S2C;
      try {
        msg = JSON.parse(ev.data) as S2C;
      } catch {
        return;
      }
      if (msg && typeof msg === 'object' && 't' in msg) this.opts.onMessage(msg);
    };

    ws.onerror = () => {
      /* close always follows; handled there */
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.setStatus('reconnecting');
    const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** this.attempt);
    const jitter = Math.random() * 250;
    this.attempt = Math.min(this.attempt + 1, 6);
    this.clearRetry();
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay + jitter);
  }

  /** Retry immediately (used by the "Try again" button and on wake-up). */
  retryNow(): void {
    if (this.stopped || this.isOpen) return;
    this.attempt = 0;
    this.open();
  }
}
