// A controller whose room's sim lives on another instance.
//
// The socket is here; the kitchen is not. This object is the tunnel: it
// publishes everything the phone says on `room:<code>:in` and replays
// everything the owning instance answers on `room:<code>:out:<addr>` and
// `room:<code>:all`. It re-announces itself until someone answers, so it also
// covers the window where a room is between owners.

import type { S2C } from '../shared/protocol';

import { REMOTE_JOIN_RETRY_MS, REMOTE_JOIN_TIMEOUT_MS } from './config';
import type { Conn } from './conn';
import type { AllEnvelope, Bus, OutEnvelope, Unsubscribe } from './store';
import { allChannel, inChannel, outChannel } from './store';

/** Enough to cover a handover; not enough for a sleeping phone to hoard. */
const MAX_PENDING = 64;

export interface RemoteJoin {
  name: unknown;
  token?: string;
}

export class RemoteAttachment {
  private readonly unsubs: Unsubscribe[] = [];
  /** Player channels we already listen on (a handover re-binds the same id). */
  private readonly bound = new Set<string>();
  /** Frames the phone sent while the seat was unbound. */
  private readonly pending: Record<string, unknown>[] = [];
  private retry: ReturnType<typeof setInterval> | null = null;
  private waitedMs = 0;
  private joined = false;
  private closed = false;
  /** Instance that currently holds our seat, learned from the bind envelope. */
  private owner: string | null = null;

  constructor(
    private readonly conn: Conn,
    readonly code: string,
    private readonly bus: Bus,
    private readonly join: RemoteJoin,
  ) {}

  async start(): Promise<void> {
    this.unsubs.push(
      await this.bus.subscribe(outChannel(this.code, this.conn.id), (p) => this.onOut(p)),
      await this.bus.subscribe(allChannel(this.code), (p) => this.onAll(p)),
    );
    // The phone may have hung up while we were subscribing.
    if (this.closed) {
      this.dropSubscriptions();
      return;
    }
    this.announce();
    this.retry = setInterval(() => this.onRetry(), REMOTE_JOIN_RETRY_MS);
    this.retry.unref?.();
  }

  /** Anything the phone says after the join. */
  forward(msg: Record<string, unknown>): void {
    if (this.closed) return;
    if (!this.joined) {
      // The seat is not bound yet (first join, or a rebind after a handover).
      // A joystick only speaks on change, so a dropped frame leaves the chef
      // standing still until the player wiggles the stick again. Hold them.
      if (this.pending.length >= MAX_PENDING) this.pending.shift();
      this.pending.push(msg);
      return;
    }
    this.publishIn({ k: 'msg', connId: this.conn.id, data: msg });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retry) clearInterval(this.retry);
    this.retry = null;
    this.dropSubscriptions();
    this.publishIn({ k: 'bye', connId: this.conn.id });
  }

  private dropSubscriptions(): void {
    for (const un of this.unsubs) un();
    this.unsubs.length = 0;
    this.bound.clear();
  }

  // --- internals -----------------------------------------------------------

  private onRetry(): void {
    if (this.closed || this.joined) return;
    this.waitedMs += REMOTE_JOIN_RETRY_MS;
    if (this.waitedMs >= REMOTE_JOIN_TIMEOUT_MS) {
      this.conn.send({ t: 'err', msg: 'That kitchen is not answering. Try the code again.' });
      this.close();
      this.conn.close();
      return;
    }
    this.announce();
  }

  private announce(): void {
    this.publishIn({
      k: 'msg',
      connId: this.conn.id,
      data: { t: 'join', room: this.code, name: this.join.name, token: this.join.token },
    });
  }

  private publishIn(env: unknown): void {
    void this.bus
      .publish(inChannel(this.code), env)
      .catch((err) => console.error('[bus] publish failed:', err));
  }

  private onOut(payload: unknown): void {
    const env = payload as OutEnvelope | null;
    if (this.closed || !env || typeof env !== 'object') return;
    if (env.connId !== this.conn.id) return; // a stale proxy for the same seat
    switch (env.k) {
      case 'send':
        this.deliver(env.msg);
        return;
      case 'bind':
        this.owner = env.owner;
        void this.bindTo(env.playerId);
        return;
      case 'close':
        if (env.msg) this.conn.send(env.msg);
        this.close();
        this.conn.close();
        return;
      default:
        return;
    }
  }

  private onAll(payload: unknown): void {
    const env = payload as AllEnvelope | null;
    if (this.closed || !env || typeof env !== 'object') return;
    if (env.k === 'owner') {
      // The room moved to another instance. Our seat survives (it lives in
      // the registry), but the routing does not: the new owner has never
      // heard of this connection, so nothing we say would reach the sim.
      // Re-announce with our token to reclaim the seat and rebuild the route.
      if (this.joined && this.owner !== env.owner) {
        this.joined = false;
        this.waitedMs = 0;
      }
      this.owner = env.owner;
      if (!this.joined) this.announce();
      return;
    }
    // Room-wide traffic is only ours once we actually hold a seat.
    if (env.k === 'send' && this.joined) this.conn.send(env.msg);
  }

  private deliver(msg: S2C): void {
    if (msg.t === 'joined') {
      this.joined = true;
      // Retries after this point must reclaim, never take a second seat.
      this.join.token = msg.token;
      this.conn.send(msg);
      this.flush();
      return;
    }
    if (msg.t === 'err' && !this.joined) {
      this.joined = true; // stop announcing; the owner has spoken
      this.pending.length = 0;
    }
    this.conn.send(msg);
  }

  /** Replay what the phone said while we were unbound, in order. */
  private flush(): void {
    if (this.pending.length === 0) return;
    const queued = this.pending.splice(0, this.pending.length);
    for (const msg of queued) this.publishIn({ k: 'msg', connId: this.conn.id, data: msg });
  }

  private async bindTo(playerId: string): Promise<void> {
    if (this.closed) return;
    // Re-binding after a handover must not subscribe the same channel twice,
    // or every message would reach the phone in duplicate.
    if (!this.bound.has(playerId)) {
      const unsub = await this.bus.subscribe(outChannel(this.code, playerId), (p) => this.onOut(p));
      if (this.closed) {
        unsub();
        return;
      }
      this.bound.add(playerId);
      this.unsubs.push(unsub);
    }
    this.publishIn({ k: 'bound', connId: this.conn.id, playerId });
  }
}
