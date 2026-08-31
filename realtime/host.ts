// The host tab as a room-owning instance.
//
// This is the whole of "local mode" on the authoritative side, and it is
// deliberately thin, because there is nothing new to write: the tab runs the
// same `RoomManager` and the same `Room` the server runs, over the in-memory
// store and bus that a LAN party already uses. Two seams make that work:
//
//   1. a `Backend` whose bus and store are spliced onto the server's through
//      the `{ t: 'bus', env }` tunnel, so a controller the tab cannot reach
//      directly arrives as an ordinary `RemoteLink` — the same path an
//      instance uses for a room owned by another instance;
//   2. a loopback `Conn` for the tab's own renderer, so the screen is just
//      another client of its own room and `state` never touches a socket.
//
// Nothing here imports `realtime/backend.ts` or `realtime/redis.ts`; the tab
// must not carry a Redis client.

import type { C2S, S2C } from '../shared/protocol';
import type { Snapshot } from '../shared/types';

import type { BusEnv } from './bridge';
import { asBusEnv, hostMayPublish, serverMayPublish } from './bridge';
import type { Conn } from './conn';
import { connLoopback } from './conn';
import { randomId } from './ids';
import { RoomManager } from './manager';
import { MemoryBus, MemoryStore } from './memory';
import { ROOM_TTL_MS } from './config';
import type { Backend, Bus, RoomRecord, Store, Unsubscribe } from './store';

/** Everything the tab needs from the outside world: one duplex to the server. */
export interface HostSimOptions {
  /** Send `{ t: 'bus', env }` up to the server. */
  toServer(env: BusEnv): void;
  /** Every message the tab's own room addresses to the host screen. */
  onMessage(msg: S2C): void;
}

/** Memory store that mirrors this room's registry writes to the server. */
class BridgedStore implements Store {
  readonly kind = 'host-bridge';

  constructor(
    private readonly inner: Store,
    private readonly code: string,
    private readonly out: (env: BusEnv) => void,
  ) {}

  createRoom(rec: RoomRecord): Promise<boolean> {
    return this.inner.createRoom(rec);
  }
  getRoom(code: string): Promise<RoomRecord | null> {
    return this.inner.getRoom(code);
  }
  async putRoom(rec: RoomRecord): Promise<void> {
    await this.inner.putRoom(rec);
    if (rec.code === this.code) this.out({ k: 'room', rec });
  }
  deleteRoom(code: string): Promise<void> {
    return this.inner.deleteRoom(code);
  }
  async putSnapshot(code: string, snap: Snapshot): Promise<void> {
    await this.inner.putSnapshot(code, snap);
    if (code === this.code) this.out({ k: 'snap', snap });
  }
  getSnapshot(code: string): Promise<Snapshot | null> {
    return this.inner.getSnapshot(code);
  }
  acquireLease(code: string, owner: string, ttlMs: number): Promise<boolean> {
    return this.inner.acquireLease(code, owner, ttlMs);
  }
  renewLease(code: string, owner: string, ttlMs: number): Promise<boolean> {
    return this.inner.renewLease(code, owner, ttlMs);
  }
  releaseLease(code: string, owner: string): Promise<void> {
    return this.inner.releaseLease(code, owner);
  }
  readLeaseOwner(code: string): Promise<string | null> {
    return this.inner.readLeaseOwner(code);
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}

/**
 * Memory bus whose outbound room channels also go up the tunnel. Replies to
 * relayed controllers (`out:*`) and room-wide broadcasts (`all`) are published
 * on the server's real bus, where the `RemoteAttachment` holding each phone's
 * socket is already listening.
 */
class BridgedBus implements Bus {
  readonly kind = 'host-bridge';

  constructor(
    private readonly inner: Bus,
    private readonly code: string,
    private readonly out: (env: BusEnv) => void,
  ) {}

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.inner.publish(channel, payload);
    if (hostMayPublish(this.code, channel)) this.out({ k: 'pub', ch: channel, p: payload });
  }

  subscribe(channel: string, fn: (payload: unknown) => void): Promise<Unsubscribe> {
    return this.inner.subscribe(channel, fn);
  }

  /** Replay something the server pushed down the tunnel on the private bus. */
  deliver(channel: string, payload: unknown): void {
    void this.inner
      .publish(channel, payload)
      .catch((err) => console.error('[host] bus deliver failed:', err));
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

/**
 * A room running in this tab.
 *
 * Lifecycle: `claim-sim` -> the server answers `{ t:'sim', owner:'host' }` and
 * seeds us with the room record (seats and their tokens) plus the round in
 * flight, if any. From there we are the owner until the tab goes away.
 */
export class HostSim {
  readonly instanceId = randomId(8);

  private readonly memoryBus = new MemoryBus();
  private readonly bus: BridgedBus;
  private readonly manager: RoomManager;
  private readonly loop = connLoopback();
  private started = false;
  private stopped = false;

  constructor(
    readonly code: string,
    private readonly opts: HostSimOptions,
  ) {
    const store = new BridgedStore(new MemoryStore(ROOM_TTL_MS), code, (env) => this.emit(env));
    this.bus = new BridgedBus(this.memoryBus, code, (env) => this.emit(env));
    const backend: Backend = { store, bus: this.bus };
    this.manager = new RoomManager(async () => backend, this.instanceId);
    this.loop.onMessage((msg) => {
      if (!this.stopped) this.opts.onMessage(msg);
    });
  }

  /** True once the room exists in this tab and is running the sim. */
  get running(): boolean {
    return this.started && !this.stopped;
  }

  /** Stand the room up from the server's seed and take the host seat. */
  async start(rec: RoomRecord, snap: Snapshot | null): Promise<boolean> {
    if (this.started || this.stopped) return this.running;
    this.started = true;
    const room = await this.manager.adoptRoom({ ...rec, code: this.code }, snap);
    if (!room || this.stopped) {
      this.started = false;
      return false;
    }
    this.manager.attach(this.loop.conn);
    // The tab is a client of its own room, over the same protocol as a socket.
    this.loop.send({ t: 'hello-host', resume: { room: this.code } });
    return true;
  }

  /** Anything the host screen wants to say to its room (start, again, signal). */
  send(msg: C2S): void {
    if (!this.running) return;
    this.loop.send(msg);
  }

  /** Seat a phone that reached us directly. It re-joins with its seat token. */
  attachPeer(conn: Conn): void {
    if (!this.running) return;
    this.manager.attach(conn, true);
  }

  /** True when this chef's controller is wired straight into this tab. */
  isPeerSeat(playerId: string): boolean {
    return this.manager.room(this.code)?.isPeerSeat(playerId) === true;
  }

  /** One `{ t: 'bus', env }` from the server. */
  fromServer(raw: unknown): void {
    if (!this.running) return;
    const env = asBusEnv(raw);
    if (!env || env.k !== 'pub') return;
    if (!serverMayPublish(this.code, env.ch)) return;
    this.bus.deliver(env.ch, env.p);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    // Stand down rather than destroy: the room belongs to the server, and its
    // last checkpoint is enough for the server to take the round straight back.
    this.manager.release();
    this.loop.close();
    void this.memoryBus.close();
  }

  private emit(env: BusEnv): void {
    if (this.stopped) return;
    try {
      this.opts.toServer(env);
    } catch (err) {
      console.error('[host] tunnel send failed:', err);
    }
  }
}
