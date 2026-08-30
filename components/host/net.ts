// Host socket: one WebSocket to the game server, auto-reconnecting with
// exponential backoff.
//
// On Vercel a function invocation — and therefore the socket — dies at
// `maxDuration`, so a drop is routine, not exceptional. Every RE-connect
// re-announces `hello-host` with `resume: { room }` so the server hands the
// same room (and any in-flight round) back instead of minting a new code.
// The very first connect has nothing to resume and sends a bare hello.

import { WS_PATH, type C2S, type S2C } from '@/shared/protocol';

export type NetStatus = 'connecting' | 'open' | 'down';

export interface NetHandlers {
  /** Fired on every status change (also on the initial connect attempt). */
  onStatus: (status: NetStatus) => void;
  /** Fired for every well-formed server message. */
  onMessage: (msg: S2C) => void;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8000;

function socketUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${WS_PATH}`;
}

export class HostNet {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: number | null = null;
  private disposed = false;
  private resumeRoom: string | null = null;

  constructor(private readonly handlers: NetHandlers) {}

  /**
   * Room code to reclaim on the next reconnect. The app calls this as soon
   * as the server answers with `room`.
   */
  setResumeRoom(code: string | null): void {
    this.resumeRoom = code;
  }

  connect(): void {
    if (this.disposed) return;
    this.clearRetry();
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'down');

    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.handlers.onStatus('open');
      this.send(
        this.resumeRoom
          ? { t: 'hello-host', resume: { room: this.resumeRoom } }
          : { t: 'hello-host' },
      );
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      let msg: S2C;
      try {
        msg = JSON.parse(ev.data) as S2C;
      } catch {
        return;
      }
      if (msg && typeof msg.t === 'string') this.handlers.onMessage(msg);
    };

    const drop = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      this.scheduleRetry();
    };
    ws.onerror = drop;
    ws.onclose = drop;
  }

  send(msg: C2S): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearRetry();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close();
    }
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    this.handlers.onStatus('down');
    const delay = Math.min(
      BACKOFF_MAX_MS,
      BACKOFF_BASE_MS * 2 ** this.attempt,
    );
    this.attempt += 1;
    const jitter = delay * 0.25 * Math.random();
    this.retryTimer = window.setTimeout(() => this.connect(), delay + jitter);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
