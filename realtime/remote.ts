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

export interface RemoteJoin {
  name: unknown;
  token?: string;
}

export class RemoteAttachment {
  private readonly unsubs: Unsubscribe[] = [];
  private retry: ReturnType<typeof setInterval> | null = null;
  private waitedMs = 0;
  private joined = false;
  private closed = false;

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
      // A new instance picked up this room; ask again.
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
    } else if (msg.t === 'err' && !this.joined) {
      this.joined = true; // stop announcing; the owner has spoken
    }
    this.conn.send(msg);
  }

  private async bindTo(playerId: string): Promise<void> {
    if (this.closed) return;
    const unsub = await this.bus.subscribe(outChannel(this.code, playerId), (p) => this.onOut(p));
    if (this.closed) {
      unsub();
      return;
    }
    this.unsubs.push(unsub);
    this.publishIn({ k: 'bound', connId: this.conn.id, playerId });
  }
}
