// Routes every socket to a room, wherever that room's sim happens to live.
//
// Fast path: the room is owned by this process, so the socket talks straight
// to it with no bus in between (this is the whole story for a LAN party).
// Slow path: the room is owned elsewhere, so the socket becomes a proxy.

import type { Conn } from './conn';
import { INSTANCE_ID } from './ids';
import type { Link } from './link';
import { LocalLink } from './link';
import { RemoteAttachment } from './remote';
import type { MigratingSeat, RoomCtx } from './room';
import { Room } from './room';
import type { Backend, RoomRecord } from './store';
import { asRecord, asToken, normalizeCode, parseFrame } from './validate';
import type { Snapshot } from '../shared/types';

type ConnState =
  | { role: 'none' }
  | { role: 'host'; code: string; link: Link }
  | { role: 'seat'; code: string; link: Link }
  | { role: 'proxy'; proxy: RemoteAttachment };

interface Holder {
  conn: Conn;
  /** True for an RTCDataChannel straight from a phone on the same Wi-Fi. */
  peer: boolean;
  state: ConnState;
  /** Frames are handled one at a time so `join` always lands before `input`. */
  queue: Promise<void>;
}

export class RoomManager {
  /**
   * `instanceId` is overridable so a test can put two "instances" in one
   * process. `openBackend` is injected rather than imported so this module
   * stays free of `realtime/backend.ts` — which reaches for Redis, and would
   * drag ioredis into the browser bundle. The host tab passes its own
   * in-memory backend; the servers pass `getBackend`.
   */
  constructor(
    private readonly openBackend: () => Promise<Backend>,
    readonly instanceId: string = INSTANCE_ID,
  ) {}

  private readonly rooms = new Map<string, Room>();
  private readonly holders = new Map<string, Holder>();
  private backend: Backend | null = null;

  private async ctx(): Promise<RoomCtx> {
    const backend = (this.backend ??= await this.openBackend());
    return {
      store: backend.store,
      bus: backend.bus,
      instanceId: this.instanceId,
      isCodeTaken: (code) => this.rooms.has(code),
      onDestroyed: (room) => {
        if (this.rooms.get(room.code) === room) this.rooms.delete(room.code);
      },
      onMigrate: (seats) => this.migrate(seats),
    };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** The room this instance is running, if it is running that one. */
  room(code: string): Room | null {
    return this.rooms.get(code) ?? null;
  }

  /**
   * Stand a room up on this instance under a code someone else minted, from a
   * record we were handed. This is how a host tab adopts the room the server
   * created for it — same `Room.adopt` a second server instance would use.
   */
  async adoptRoom(rec: RoomRecord, snap: Snapshot | null): Promise<Room | null> {
    const existing = this.rooms.get(rec.code);
    if (existing) return existing;
    const ctx = await this.ctx();
    await ctx.store.createRoom(rec);
    await ctx.store.putRoom(rec);
    if (snap) await ctx.store.putSnapshot(rec.code, snap);
    const room = await Room.adopt(ctx, rec);
    if (room) this.rooms.set(rec.code, room);
    return room;
  }

  // --- socket lifecycle ----------------------------------------------------

  /** `peer` marks a direct WebRTC transport: see `Link.peer`. */
  attach(conn: Conn, peer = false): void {
    const holder: Holder = { conn, peer, state: { role: 'none' }, queue: Promise.resolve() };
    this.holders.set(conn.id, holder);

    conn.onMessage((raw) => {
      holder.queue = holder.queue
        .then(() => this.handle(holder, raw))
        .catch((err) => console.error('[realtime] message failed:', err));
    });

    conn.onClose(() => {
      holder.queue = holder.queue
        .then(() => this.handleClose(holder))
        .catch((err) => console.error('[realtime] close failed:', err));
    });
  }

  private async handleClose(holder: Holder): Promise<void> {
    this.holders.delete(holder.conn.id);
    const state = holder.state;
    holder.state = { role: 'none' };
    if (state.role === 'proxy') {
      state.proxy.close();
      return;
    }
    if (state.role === 'none') return;
    this.rooms.get(state.code)?.detach(holder.conn.id);
  }

  // --- messages ------------------------------------------------------------

  private async handle(holder: Holder, raw: string): Promise<void> {
    const msg = parseFrame(raw);
    if (!msg) {
      holder.conn.send({ t: 'err', msg: 'Malformed message.' });
      return;
    }

    if (msg.t === 'hello-host') {
      await this.helloHost(holder, msg);
      return;
    }

    const state = holder.state;
    switch (state.role) {
      case 'host':
      case 'seat': {
        this.rooms.get(state.code)?.handleMessage(state.link, msg);
        return;
      }
      case 'proxy': {
        state.proxy.forward(msg);
        return;
      }
      case 'none': {
        if (msg.t === 'join') await this.join(holder, msg);
        return;
      }
    }
  }

  private async helloHost(holder: Holder, msg: Record<string, unknown>): Promise<void> {
    if (holder.state.role !== 'none') {
      holder.conn.send({ t: 'err', msg: 'This connection already has a role.' });
      return;
    }
    const ctx = await this.ctx();
    const resume = asRecord(msg.resume);
    const code = resume ? normalizeCode(resume.room) : null;

    if (code) {
      const local = this.rooms.get(code);
      if (local && (await local.reacquire())) {
        this.bindHost(holder, local, true);
        return;
      }
      const rec = await ctx.store.getRoom(code);
      if (rec) {
        const adopted = await Room.adopt(ctx, rec);
        if (adopted) {
          this.rooms.set(code, adopted);
          this.bindHost(holder, adopted, true);
          return;
        }
        holder.conn.send({
          t: 'err',
          msg: 'That kitchen is still open on another screen. Try again in a moment.',
        });
        return;
      }
    }

    const room = await Room.createFresh(ctx);
    this.rooms.set(room.code, room);
    this.bindHost(holder, room, false);
  }

  private bindHost(holder: Holder, room: Room, resumed: boolean): void {
    const link = new LocalLink(holder.conn);
    holder.state = { role: 'host', code: room.code, link };
    room.attachHost(link, resumed);
  }

  private async join(holder: Holder, msg: Record<string, unknown>): Promise<void> {
    const ctx = await this.ctx();
    const code = normalizeCode(msg.room);
    if (!code) {
      holder.conn.send({ t: 'err', msg: 'No kitchen with code ????.' });
      return;
    }

    // A relaying room's sim lives in a host tab, so even a socket that landed
    // on the owning instance has to go the long way round — over the bus and
    // down the tunnel. That is the same path a phone on another instance
    // takes, so there is exactly one relayed code path, not two.
    const local = this.rooms.get(code);
    if (local && !local.isRelaying) {
      const link = new LocalLink(holder.conn, holder.peer);
      holder.state = { role: 'seat', code, link };
      local.handleMessage(link, msg);
      return;
    }

    const rec = await ctx.store.getRoom(code);
    if (!rec) {
      holder.conn.send({ t: 'err', msg: `No kitchen with code ${code}.` });
      return;
    }

    // The kitchen is real but its sim is somewhere else: relay over the bus.
    const proxy = new RemoteAttachment(holder.conn, code, ctx.bus, {
      name: msg.name,
      token: asToken(msg.token),
    });
    holder.state = { role: 'proxy', proxy };
    await proxy.start();
  }

  /** A paused room lost ownership: re-seat its controllers on the new owner. */
  private migrate(seats: MigratingSeat[]): void {
    for (const seat of seats) {
      const holder = this.holders.get(seat.conn.id);
      if (!holder || !seat.conn.open) continue;
      holder.state = { role: 'none' };
      holder.queue = holder.queue
        .then(() =>
          this.join(holder, { t: 'join', room: seat.code, name: seat.name, token: seat.token }),
        )
        .catch((err) => console.error('[realtime] migrate failed:', err));
    }
  }

  /** Shut every room down (local server SIGINT). */
  stop(reason = 'The kitchen is closing.'): void {
    for (const room of [...this.rooms.values()]) room.destroy(reason);
    this.rooms.clear();
    this.holders.clear();
  }

  /**
   * Let go of every room without ending it. A host tab unmounting does this:
   * the rooms are the server's, and the server resumes them from the last
   * checkpoint rather than telling everybody the kitchen burned down.
   */
  release(): void {
    for (const room of [...this.rooms.values()]) room.standDown();
    this.rooms.clear();
    this.holders.clear();
  }
}

