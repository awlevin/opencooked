// The controller's link to the game, over one or two transports at once.
//
// The socket is the control channel and is never optional: it carries the
// join, the WebRTC handshake, and everything else if the handshake fails. The
// server is not assumed to exist — every failure path lands on a screen the
// player can act on.
//
// Reconnects are the normal case, not an emergency. On Vercel a function
// invocation is capped (~300 s), so every socket dies mid-round sooner or
// later. The seat `token` from 'joined' is replayed on every subsequent
// 'join' for that room, so the player comes back as the same chef — same
// colour, same name, still holding whatever they were holding.
//
// Local mode rides on top of that. If the host can reach us directly over the
// Wi-Fi, gameplay moves onto an RTCDataChannel (~3 ms instead of ~30-80 ms)
// and the socket stays open underneath it. The swap is invisible in both
// directions: the player is playable from the first second on the cloud path,
// and a channel that dies mid-round drops straight back onto the socket with
// the same seat token. There is no setting for this, because nobody could
// usefully answer the question.

import { WS_PATH, type C2S, type S2C } from '@/shared/protocol';
import { PeerLink, peerSupported } from './peer';
import { clearToken, loadToken, saveToken } from './platform';

export type NetStatus =
  | 'idle' // nothing open, nothing pending
  | 'connecting' // first attempt for this room
  | 'open' // socket up, join sent
  | 'reconnecting' // dropped, retrying
  | 'failed'; // gave up or server rejected us

/** Which wire gameplay is currently on. Cosmetic / diagnostic only. */
export type Transport = 'cloud' | 'local';

// A round is only three minutes, so back off gently and cap low: a phone that
// drops out must be back in the kitchen in seconds, not tens of seconds.
const BASE_RETRY_MS = 400;
const MAX_RETRY_MS = 3000;

// How long a handshake gets before we stop caring. A LAN peer forms in well
// under a second; anything slower is a phone on cellular or an access point
// with client isolation, and both of those want the cloud path.
const PEER_DEADLINE_MS = 5000;

// Gameplay. Everything else (join, signal) is control traffic and stays on the
// socket, which is the only transport guaranteed to exist.
const PEER_SENDABLE = new Set<C2S['t']>(['input', 'press', 'release', 'start', 'again']);

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
  private token = '';
  private attempt = 0;
  private retryTimer: number | null = null;
  private stopped = true;
  private status: NetStatus = 'idle';

  private peer: PeerLink | null = null;
  private peerLive = false;
  private peerTimer: number | null = null;

  constructor(private readonly opts: NetOptions) {}

  /** Connects (or reconnects) and joins `room` as `name`. */
  join(room: string, name: string): void {
    this.room = room;
    this.name = name;
    // A token from an earlier visit still reclaims the seat, so pick it up
    // before the first connect rather than only after a drop.
    this.token = loadToken(room);
    this.attempt = 0;
    this.stopped = false;
    this.dropPeer();
    this.setStatus('connecting');
    this.open();
  }

  /** Stops retrying and drops the socket. */
  stop(status: NetStatus = 'idle'): void {
    this.stopped = true;
    this.clearRetry();
    this.dropPeer();
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

  /**
   * Throws away the seat token for the current room. Used when the server
   * rejects us outright — a stale token must not poison every later attempt.
   */
  forgetToken(): void {
    this.token = '';
    clearToken(this.room);
  }

  /**
   * Gameplay takes the fastest wire that is actually working; control traffic
   * always takes the socket. A data channel that refuses a message (buffer
   * full, closing under us) falls through to the socket for that message
   * rather than dropping it.
   */
  send(msg: C2S): void {
    if (this.peerLive && PEER_SENDABLE.has(msg.t) && this.peer?.send(msg)) return;
    this.sendSocket(msg);
  }

  private sendSocket(msg: C2S): void {
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

  /** 'local' once gameplay is on the data channel. Diagnostics only. */
  get transport(): Transport {
    return this.peerLive ? 'local' : 'cloud';
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
      this.sendSocket(this.joinMsg());
    };

    ws.onmessage = (ev: MessageEvent<unknown>) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      this.receive(ev.data, 'cloud');
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

  private joinMsg(): C2S {
    const join: C2S = { t: 'join', room: this.room, name: this.name };
    if (this.token) join.token = this.token;
    return join;
  }

  /** One inbound frame, from either transport. */
  private receive(raw: string, via: Transport): void {
    let msg: S2C;
    try {
      msg = JSON.parse(raw) as S2C;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || !('t' in msg)) return;

    // Signalling is control traffic and is consumed here; the app has no
    // opinion about how its input reaches the kitchen.
    if (msg.t === 'signal') {
      if (via === 'cloud' && msg.from === 'host') this.onHostSignal(msg.data);
      return;
    }

    // The channel proving it can talk is what promotes it. Anything less —
    // an open channel that never answers — leaves us safely on the cloud.
    if (via === 'local' && !this.peerLive) this.goLocal();

    // Keep the seat token here rather than in the app: it must survive even
    // if the app is mid-teardown, and it belongs to the transport.
    if (msg.t === 'joined') {
      if (msg.token) {
        this.token = msg.token;
        saveToken(this.room, msg.token);
      }
      // A socket that came back had to re-claim the seat to be reachable for
      // signalling and fallback, which hands the seat back to the slow wire.
      // Claim it again on the fast one, after the host has answered, so the
      // last word belongs to the channel that is still open.
      if (via === 'cloud' && this.peerLive) this.peer?.send(this.joinMsg());
    }
    this.opts.onMessage(msg);
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

  /* ----------------------------- local mode ------------------------------ */

  /**
   * One relayed payload from the host: an SDP offer, then ICE candidates. We
   * only ever answer. Everything here is best-effort — a browser without
   * WebRTC, a malformed offer or a host that goes quiet all leave the phone
   * exactly where it started, on a working cloud connection.
   */
  private onHostSignal(data: unknown): void {
    if (this.stopped || !peerSupported()) return;
    try {
      if (!this.peer || this.peer.isDead) {
        this.peerLive = false;
        this.peer = new PeerLink({
          signal: (out) => this.sendSocket({ t: 'signal', to: 'host', data: out }),
          onData: (raw) => this.receive(raw, 'local'),
          onOpen: () => this.onPeerOpen(),
          onClose: () => this.onPeerClose(),
        });
      }
      this.armPeerDeadline();
      this.peer.accept(data);
    } catch {
      this.dropPeer();
    }
  }

  /**
   * The channel is up but unproven. Claiming the seat over it is what makes
   * the host adopt this transport, and it reuses the same token path a
   * reconnect uses — so the swap cannot lose the chef, the colour or the
   * item in its hands. Without a token there is no seat to move yet, so we
   * wait: joining afresh here would spawn a second chef.
   */
  private onPeerOpen(): void {
    if (this.stopped || !this.token) return;
    this.peer?.send(this.joinMsg());
  }

  /** The channel died. Gameplay goes straight back on the socket. */
  private onPeerClose(): void {
    const wasLive = this.peerLive;
    this.peerLive = false;
    this.peer = null;
    this.clearPeerDeadline();
    if (!wasLive || this.stopped) return;
    // Reclaim the seat on the socket. No overlay, no message: the player is
    // still connected, so saying otherwise would be a lie.
    if (this.isOpen) {
      this.sendSocket(this.joinMsg());
      return;
    }
    this.retryNow();
    // Both wires are down now, which the app may have been told to ignore
    // while the channel was carrying the game. Say so again.
    this.opts.onStatus(this.status);
  }

  private goLocal(): void {
    this.peerLive = true;
    this.clearPeerDeadline();
  }

  private armPeerDeadline(): void {
    if (this.peerTimer !== null || this.peerLive) return;
    this.peerTimer = window.setTimeout(() => {
      this.peerTimer = null;
      if (this.peerLive) return;
      // Negotiation stalled. Free the connection and stay on the cloud; a
      // later offer from the host is welcome to try again.
      this.dropPeer();
    }, PEER_DEADLINE_MS);
  }

  private clearPeerDeadline(): void {
    if (this.peerTimer !== null) {
      clearTimeout(this.peerTimer);
      this.peerTimer = null;
    }
  }

  /** Silent teardown: no fallback, because nothing had moved off the socket. */
  private dropPeer(): void {
    this.clearPeerDeadline();
    this.peerLive = false;
    const peer = this.peer;
    this.peer = null;
    peer?.dispose();
  }
}
