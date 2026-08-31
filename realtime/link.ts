// A Link is "somewhere to send S2C messages". Either a socket on this
// instance (fast path — no bus at all) or a proxy on another instance,
// reachable over the bus.

import type { S2C } from '../shared/protocol';

import type { Conn } from './conn';
import type { Bus, OutEnvelope } from './store';
import { outChannel } from './store';

export interface Link {
  /** The connection id, same on both instances. */
  readonly id: string;
  readonly local: boolean;
  /**
   * True when this link is a direct peer connection (an RTCDataChannel from a
   * phone on the same Wi-Fi). Two things depend on it: the "local" badge on
   * the host screen, and the reclaim rule — a phone upgrading to its peer
   * link keeps its cloud socket, because that socket is its way back.
   */
  readonly peer: boolean;
  send(msg: S2C): void;
  /** Optionally deliver one last message, then hang up. */
  close(msg?: S2C): void;
}

export class LocalLink implements Link {
  readonly local = true;

  constructor(
    readonly conn: Conn,
    readonly peer = false,
  ) {}

  get id(): string {
    return this.conn.id;
  }

  send(msg: S2C): void {
    this.conn.send(msg);
  }

  close(msg?: S2C): void {
    if (msg) this.conn.send(msg);
    this.conn.close();
  }
}

export class RemoteLink implements Link {
  readonly local = false;
  readonly peer = false;

  /** Starts as the connection id, becomes the playerId once the proxy acks. */
  private addr: string;

  constructor(
    readonly id: string,
    private readonly code: string,
    private readonly bus: Bus,
    private readonly owner: string,
  ) {
    this.addr = id;
  }

  /** Ask the proxy to also listen on `out:<playerId>`, and name its owner. */
  requestBind(playerId: string): void {
    this.emit({ k: 'bind', connId: this.id, playerId, owner: this.owner });
  }

  /** Called after the proxy confirms it subscribed to `out:<playerId>`. */
  bindTo(playerId: string): void {
    this.addr = playerId;
  }

  private emit(env: OutEnvelope): void {
    void this.bus
      .publish(outChannel(this.code, this.addr), env)
      .catch((err) => console.error('[bus] publish failed:', err));
  }

  send(msg: S2C): void {
    this.emit({ k: 'send', connId: this.id, msg });
  }

  close(msg?: S2C): void {
    this.emit({ k: 'close', connId: this.id, msg });
  }
}
