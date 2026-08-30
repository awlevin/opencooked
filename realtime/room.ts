// One kitchen: the authoritative sim, its roster of seats, and the clocks
// that keep both honest. Exactly one instance owns a room at a time — the one
// holding the room's lease. Everything here is transport-agnostic: sockets on
// this instance and proxies on other instances both arrive as a `Link`.

import { Game } from '../game/game';
import type { S2C } from '../shared/protocol';
import { MAX_PLAYERS, PLAYER_COLORS, SNAPSHOT_MS, TICK_MS } from '../shared/types';
import type { LobbyPlayer, Phase, Snapshot } from '../shared/types';

import {
  CHECKPOINT_MS,
  HOST_GRACE_MS,
  LEASE_MS,
  LEASE_RENEW_MS,
  MAX_DT_MS,
  REGISTRY_REFRESH_MS,
  SEAT_GRACE_LOBBY_MS,
  SEAT_GRACE_PLAYING_MS,
  SWEEP_MS,
} from './config';
import type { Conn } from './conn';
import { makeCode, makeToken } from './ids';
import type { Link } from './link';
import { LocalLink, RemoteLink } from './link';
import type { AllEnvelope, Bus, InEnvelope, RoomRecord, Seat, Store, Unsubscribe } from './store';
import { allChannel, inChannel } from './store';
import { asBtn, asToken, asVec2, cleanName } from './validate';

/** A controller this instance must hand over to whoever owns the room now. */
export interface MigratingSeat {
  conn: Conn;
  code: string;
  name: string;
  token: string;
}

export interface RoomCtx {
  store: Store;
  bus: Bus;
  instanceId: string;
  /** True when a code is already live on this instance. */
  isCodeTaken(code: string): boolean;
  onDestroyed(room: Room): void;
  onMigrate(seats: MigratingSeat[]): void;
}

interface SeatRuntime {
  seat: Seat;
  link: Link | null;
}

export class Room {
  readonly code: string;

  private readonly seats = new Map<string, SeatRuntime>();
  /** connection id -> playerId, for both local sockets and bus proxies. */
  private readonly byConn = new Map<string, string>();
  private readonly remoteLinks = new Map<string, RemoteLink>();

  private host: Link | null = null;
  private hostGoneAt: number | null = null;

  private loop: ReturnType<typeof setInterval> | null = null;
  private house: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private snapAccumMs = 0;
  private checkpointAccumMs = 0;
  private leaseAccumMs = 0;
  private persistAccumMs = 0;

  private unsubIn: Unsubscribe | null = null;
  private destroyed = false;

  private constructor(
    private readonly ctx: RoomCtx,
    private readonly rec: RoomRecord,
    private readonly game: Game,
  ) {
    this.code = rec.code;
  }

  // --- construction --------------------------------------------------------

  /** Allocate a brand new room. Never returns a code another room is using. */
  static async createFresh(ctx: RoomCtx): Promise<Room> {
    for (let attempt = 0; attempt < 500; attempt++) {
      const code = makeCode();
      if (ctx.isCodeTaken(code)) continue;
      const now = Date.now();
      const rec: RoomRecord = {
        code,
        createdAt: now,
        updatedAt: now,
        phase: 'lobby',
        seq: 1,
        seats: [],
        owner: ctx.instanceId,
        hostConnected: false,
      };
      if (!(await ctx.store.createRoom(rec))) continue;
      if (!(await ctx.store.acquireLease(code, ctx.instanceId, LEASE_MS))) continue;
      const room = new Room(ctx, rec, new Game());
      await room.init();
      return room;
    }
    throw new Error('could not allocate a room code');
  }

  /**
   * Take over a room that lives only in the registry (its previous instance
   * is gone or has stood down). Returns null when someone else still owns it.
   */
  static async adopt(ctx: RoomCtx, rec: RoomRecord): Promise<Room | null> {
    if (!(await ctx.store.acquireLease(rec.code, ctx.instanceId, LEASE_MS))) return null;

    const game = new Game();
    const snap = await ctx.store.getSnapshot(rec.code);
    if (snap && snap.phase !== 'lobby') {
      try {
        game.restoreSnapshot(snap);
      } catch (err) {
        console.error(`[room ${rec.code}] checkpoint unusable, restarting in the lobby:`, err);
      }
    }

    const room = new Room(ctx, { ...rec, owner: ctx.instanceId, hostConnected: false }, game);
    const now = Date.now();
    for (const stored of rec.seats) {
      // Every socket of the old instance is gone; the grace clock starts now.
      const seat: Seat = { ...stored, connected: false, disconnectedAt: now };
      room.seats.set(seat.playerId, { seat, link: null });
      if (!game.hasPlayer(seat.playerId)) game.addPlayer(seat.playerId, seat.name, seat.color);
    }
    room.rec.seats = room.storedSeats();
    await room.init();
    console.log(
      `[room ${rec.code}] adopted (${game.phase}, ${room.seats.size} seat(s), ` +
        `${Math.round(game.snapshot.msLeft / 1000)}s left)`,
    );
    return room;
  }

  private async init(): Promise<void> {
    this.unsubIn = await this.ctx.bus.subscribe(inChannel(this.code), (payload) =>
      this.onBusIn(payload),
    );
    this.house = setInterval(() => {
      void this.housekeeping().catch((err) =>
        console.error(`[room ${this.code}] housekeeping failed:`, err),
      );
    }, SWEEP_MS);
    this.house.unref?.();
    // Wake up any controller that has been shouting into the void.
    this.publishAll({ k: 'owner', owner: this.ctx.instanceId });
    await this.persist();
  }

  // --- accessors -----------------------------------------------------------

  get phase(): Phase {
    return this.game.phase;
  }

  get snapshot(): Snapshot {
    return this.game.snapshot;
  }

  get seatCount(): number {
    return this.seats.size;
  }

  get hasHost(): boolean {
    return this.host !== null;
  }

  // --- host ----------------------------------------------------------------

  attachHost(link: Link, resumed: boolean): void {
    void this.resumeOwning();
    if (this.host && this.host.id !== link.id) {
      this.host.close({ t: 'err', msg: 'Another screen took over this kitchen.' });
    }
    this.host = link;
    this.hostGoneAt = null;
    this.rec.hostConnected = true;

    link.send({ t: 'room', code: this.code, resumed });
    link.send({ t: 'phase', phase: this.game.phase });
    link.send({ t: 'lobby', players: this.roster() });
    if (this.game.phase !== 'lobby') link.send({ t: 'state', s: this.game.snapshot });
    if (this.game.phase === 'gameover') link.send(this.gameoverMsg());
    if (this.game.phase === 'playing') this.startLoop();

    void this.persist();
    console.log(`[room ${this.code}] host ${resumed ? 'resumed' : 'connected'}`);
  }

  /** Re-take the lease when a host returns to a room we paused. */
  async reacquire(): Promise<boolean> {
    if (this.destroyed) return false;
    const ok = await this.ctx.store.acquireLease(this.code, this.ctx.instanceId, LEASE_MS);
    if (ok) this.leaseAccumMs = 0;
    return ok;
  }

  private detachHost(): void {
    this.host = null;
    this.hostGoneAt = Date.now();
    this.rec.hostConnected = false;
    this.stopLoop();
    // Freeze the round where it stands and let another instance pick it up.
    void this.checkpoint();
    void this.ctx.store.releaseLease(this.code, this.ctx.instanceId).catch(() => undefined);
    this.stopOwning();
    console.log(`[room ${this.code}] host gone — paused, holding for a reconnect`);
  }

  /** Start acting as the bus owner again after a pause. */
  private async resumeOwning(): Promise<void> {
    if (this.destroyed || this.unsubIn) return;
    this.unsubIn = await this.ctx.bus.subscribe(inChannel(this.code), (payload) =>
      this.onBusIn(payload),
    );
    if (this.destroyed) {
      this.unsubIn();
      this.unsubIn = null;
      return;
    }
    this.publishAll({ k: 'owner', owner: this.ctx.instanceId });
  }

  /**
   * Stop acting as the bus owner: we no longer run the sim for anyone else.
   *
   * Relayed controllers are deliberately left connected. Their phones belong
   * to the room, not to this process, and hanging them up on every host
   * reconnect (which on Vercel is every few minutes) would be a disaster.
   * They keep their seats and re-announce themselves to whichever instance
   * picks the room up next — see RemoteAttachment's owner handling.
   */
  private stopOwning(): void {
    this.unsubIn?.();
    this.unsubIn = null;
  }

  // --- roster --------------------------------------------------------------

  private roster(): LobbyPlayer[] {
    return [...this.seats.values()].map(({ seat }) => ({
      id: seat.playerId,
      name: seat.name,
      color: seat.color,
    }));
  }

  private storedSeats(): Seat[] {
    return [...this.seats.values()].map(({ seat }) => ({ ...seat }));
  }

  private nextColor(): string {
    const used = new Set([...this.seats.values()].map((s) => s.seat.color));
    for (const color of PLAYER_COLORS) if (!used.has(color)) return color;
    return PLAYER_COLORS[this.seats.size % PLAYER_COLORS.length];
  }

  private sendLobby(): void {
    this.broadcast({ t: 'lobby', players: this.roster() });
  }

  // --- messaging -----------------------------------------------------------

  private broadcast(msg: S2C): void {
    this.host?.send(msg);
    for (const { link } of this.seats.values()) if (link?.local) link.send(msg);
    // One publish covers every proxy in the room, wherever it lives.
    this.publishAll({ k: 'send', msg });
  }

  private publishAll(env: AllEnvelope): void {
    void this.ctx.bus
      .publish(allChannel(this.code), env)
      .catch((err) => console.error('[bus] publish failed:', err));
  }

  private gameoverMsg(): S2C {
    const s = this.game.snapshot;
    return { t: 'gameover', score: s.score, served: s.served, missed: s.missed };
  }

  // --- the loop ------------------------------------------------------------

  private startLoop(): void {
    this.stopLoop();
    this.lastTickAt = Date.now();
    this.snapAccumMs = SNAPSHOT_MS; // one snapshot straight away
    this.checkpointAccumMs = 0;
    this.loop = setInterval(() => {
      try {
        this.step();
      } catch (err) {
        console.error(`[room ${this.code}] tick failed:`, err);
      }
    }, TICK_MS);
    this.loop.unref?.();
  }

  private stopLoop(): void {
    if (this.loop === null) return;
    clearInterval(this.loop);
    this.loop = null;
  }

  private step(): void {
    const now = Date.now();
    const dt = Math.min(now - this.lastTickAt, MAX_DT_MS);
    this.lastTickAt = now;

    for (const ev of this.game.tick(dt)) {
      this.seats.get(ev.playerId)?.link?.send({ t: 'buzz', ms: ev.buzzMs });
    }

    const over = this.game.phase === 'gameover';
    this.snapAccumMs += dt;
    if (over || this.snapAccumMs >= SNAPSHOT_MS) {
      this.snapAccumMs = 0;
      this.host?.send({ t: 'state', s: this.game.snapshot });
    }

    this.checkpointAccumMs += dt;
    if (this.checkpointAccumMs >= CHECKPOINT_MS) {
      this.checkpointAccumMs = 0;
      void this.checkpoint();
    }

    if (over) {
      this.stopLoop();
      this.onRoundEnded();
    }
  }

  private onRoundEnded(): void {
    // A chef who never came back does not haunt the next lobby.
    for (const [pid, st] of [...this.seats]) if (!st.seat.connected) this.removeSeat(pid);
    this.broadcast({ t: 'phase', phase: 'gameover' });
    this.broadcast(this.gameoverMsg());
    this.sendLobby();
    void this.checkpoint();
    console.log(`[room ${this.code}] round over — score ${this.game.snapshot.score}`);
  }

  // --- persistence ---------------------------------------------------------

  private async persist(): Promise<void> {
    if (this.destroyed) return;
    this.rec.phase = this.game.phase;
    this.rec.seats = this.storedSeats();
    this.rec.owner = this.ctx.instanceId;
    this.rec.updatedAt = Date.now();
    await this.ctx.store.putRoom(this.rec).catch((err) => {
      console.error(`[room ${this.code}] registry write failed:`, err);
    });
  }

  private async checkpoint(): Promise<void> {
    if (this.destroyed) return;
    await Promise.all([
      this.persist(),
      this.ctx.store
        .putSnapshot(this.code, this.game.snapshot)
        .catch((err) => console.error(`[room ${this.code}] checkpoint failed:`, err)),
    ]);
  }

  // --- housekeeping --------------------------------------------------------

  private async housekeeping(): Promise<void> {
    if (this.destroyed) return;
    const now = Date.now();

    if (this.host) {
      this.leaseAccumMs += SWEEP_MS;
      if (this.leaseAccumMs >= LEASE_RENEW_MS) {
        this.leaseAccumMs = 0;
        const held = await this.ctx.store.renewLease(this.code, this.ctx.instanceId, LEASE_MS);
        if (!held) {
          // We stalled long enough that somebody else took the kitchen.
          this.destroy('This kitchen moved to another server. Rejoin to keep cooking.');
          return;
        }
      }
    } else if (this.hostGoneAt !== null) {
      if (now - this.hostGoneAt >= HOST_GRACE_MS) {
        this.destroy('The host screen disconnected.');
        return;
      }
      const owner = await this.ctx.store.readLeaseOwner(this.code);
      if (owner !== null && owner !== this.ctx.instanceId) {
        this.migrate();
        return;
      }
    }

    // A quiet lobby must not let its registry entry time out underneath it.
    this.persistAccumMs += SWEEP_MS;
    if (this.persistAccumMs >= REGISTRY_REFRESH_MS) {
      this.persistAccumMs = 0;
      await this.persist();
    }

    this.sweepSeats(now);
  }

  private sweepSeats(now: number): void {
    const grace = this.game.phase === 'playing' ? SEAT_GRACE_PLAYING_MS : SEAT_GRACE_LOBBY_MS;
    let changed = false;
    for (const [pid, st] of [...this.seats]) {
      if (st.seat.connected || st.seat.disconnectedAt === null) continue;
      if (now - st.seat.disconnectedAt < grace) continue;
      this.removeSeat(pid);
      changed = true;
    }
    if (changed) {
      this.sendLobby();
      void this.persist();
    }
  }

  private removeSeat(playerId: string): void {
    const st = this.seats.get(playerId);
    if (!st) return;
    this.seats.delete(playerId);
    if (st.link) this.byConn.delete(st.link.id);
    this.game.removePlayer(playerId);
    console.log(`[room ${this.code}] ${st.seat.name} left — ${this.seats.size} chef(s)`);
  }

  // --- client messages -----------------------------------------------------

  handleMessage(link: Link, msg: Record<string, unknown>): void {
    switch (msg.t) {
      case 'join':
        this.join(link, msg);
        return;
      case 'start':
        this.start(link);
        return;
      case 'again':
        this.again(link);
        return;
      case 'input': {
        const pid = this.byConn.get(link.id);
        const move = asVec2(msg.move);
        if (!pid || !move) return;
        this.game.setMove(pid, move);
        return;
      }
      case 'press':
      case 'release': {
        const pid = this.byConn.get(link.id);
        const btn = asBtn(msg.btn);
        if (!pid || !btn) return;
        if (msg.t === 'press') this.game.press(pid, btn);
        else this.game.release(pid, btn);
        return;
      }
      default:
        return; // unknown message: ignore
    }
  }

  private join(link: Link, msg: Record<string, unknown>): void {
    // A retried join (the bus is at-most-once) must not buy a second seat.
    const known = this.byConn.get(link.id);
    if (known) {
      const st = this.seats.get(known);
      if (st) {
        this.sendJoined(st, link);
        return;
      }
      this.byConn.delete(link.id);
    }

    const token = asToken(msg.token);
    const reclaimed = token ? this.seatByToken(token) : null;
    if (reclaimed) {
      const old = reclaimed.link;
      if (old && old.id !== link.id) {
        this.byConn.delete(old.id);
        this.remoteLinks.delete(old.id);
        old.close({ t: 'err', msg: 'This chef reconnected somewhere else.' });
      }
      reclaimed.link = link;
      reclaimed.seat.connected = true;
      reclaimed.seat.disconnectedAt = null;
      this.byConn.set(link.id, reclaimed.seat.playerId);
      // Mid-round the body is still on the floor; otherwise re-seat them.
      if (!this.game.hasPlayer(reclaimed.seat.playerId)) {
        this.game.addPlayer(
          reclaimed.seat.playerId,
          reclaimed.seat.name,
          reclaimed.seat.color,
        );
      }
      this.sendJoined(reclaimed, link);
      this.sendLobby();
      void this.persist();
      console.log(`[room ${this.code}] ${reclaimed.seat.name} reclaimed their seat`);
      return;
    }

    if (this.seats.size >= MAX_PLAYERS) {
      link.close({ t: 'err', msg: 'That kitchen is full.' });
      return;
    }

    const playerId = `p${this.rec.seq++}`;
    const seat: Seat = {
      playerId,
      name: cleanName(msg.name, `Chef ${this.seats.size + 1}`),
      color: this.nextColor(),
      token: makeToken(),
      connected: true,
      disconnectedAt: null,
    };
    const st: SeatRuntime = { seat, link };
    this.seats.set(playerId, st);
    this.byConn.set(link.id, playerId);
    this.game.addPlayer(playerId, seat.name, seat.color);

    this.sendJoined(st, link);
    this.sendLobby();
    void this.persist();
    console.log(`[room ${this.code}] ${seat.name} (${playerId}) joined — ${this.seats.size} chef(s)`);
  }

  private sendJoined(st: SeatRuntime, link: Link): void {
    const { seat } = st;
    link.send({
      t: 'joined',
      playerId: seat.playerId,
      color: seat.color,
      name: seat.name,
      token: seat.token,
    });
    link.send({ t: 'phase', phase: this.game.phase });
    link.send({ t: 'lobby', players: this.roster() });
    if (this.game.phase === 'gameover') link.send(this.gameoverMsg());
    if (link instanceof RemoteLink) link.requestBind(seat.playerId);
  }

  private seatByToken(token: string): SeatRuntime | null {
    for (const st of this.seats.values()) if (st.seat.token === token) return st;
    return null;
  }

  /** Controllers drive the round; the host screen may too (it is one room). */
  private mayControl(link: Link): boolean {
    return this.byConn.has(link.id) || this.host?.id === link.id;
  }

  private start(link: Link): void {
    if (!this.mayControl(link)) return;
    if (this.game.phase !== 'lobby') return;
    if (this.seats.size < 1) {
      link.send({ t: 'err', msg: 'Need at least one chef.' });
      return;
    }
    this.game.start();
    this.broadcast({ t: 'phase', phase: 'playing' });
    this.startLoop();
    void this.checkpoint();
    console.log(`[room ${this.code}] round started with ${this.seats.size} chef(s)`);
  }

  private again(link: Link): void {
    if (!this.mayControl(link)) return;
    if (this.game.phase !== 'gameover') return;
    this.stopLoop();
    this.game.toLobby();
    this.broadcast({ t: 'phase', phase: 'lobby' });
    this.sendLobby();
    void this.checkpoint();
  }

  // --- disconnects ---------------------------------------------------------

  /** A socket (or proxy) went away. Seats survive; hosts pause the room. */
  detach(connId: string): void {
    if (this.destroyed) return;
    if (this.host?.id === connId) {
      this.detachHost();
      return;
    }
    const pid = this.byConn.get(connId);
    if (!pid) return;
    this.dropSeatLink(pid, connId);
    this.sendLobby();
    void this.persist();
  }

  private dropSeatLink(playerId: string, connId: string): void {
    this.byConn.delete(connId);
    this.remoteLinks.delete(connId);
    const st = this.seats.get(playerId);
    if (!st || st.link?.id !== connId) return;
    st.link = null;
    st.seat.connected = false;
    st.seat.disconnectedAt = Date.now();
    // Mid-round the body stays on the floor until the grace period is up, so
    // a phone that slept for ten seconds does not cost the team a chef.
    this.game.setMove(playerId, { x: 0, y: 0 });
    this.game.release(playerId, 'b');
    console.log(
      `[room ${this.code}] ${st.seat.name} disconnected — seat held for ` +
        `${this.game.phase === 'playing' ? SEAT_GRACE_PLAYING_MS : SEAT_GRACE_LOBBY_MS}ms`,
    );
  }

  // --- bus (owner side) ----------------------------------------------------

  private onBusIn(payload: unknown): void {
    const env = payload as InEnvelope | null;
    if (!env || typeof env !== 'object' || typeof env.connId !== 'string') return;
    switch (env.k) {
      case 'msg': {
        const msg = env.data;
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
        const rec = msg as Record<string, unknown>;
        if (typeof rec.t !== 'string') return;
        const link = this.remoteLink(env.connId);
        try {
          this.handleMessage(link, rec);
        } catch (err) {
          console.error(`[room ${this.code}] relayed message failed:`, err);
        }
        return;
      }
      case 'bound': {
        const link = this.remoteLinks.get(env.connId);
        if (link && this.byConn.get(env.connId) === env.playerId) link.bindTo(env.playerId);
        return;
      }
      case 'bye': {
        const pid = this.byConn.get(env.connId);
        if (pid) {
          this.dropSeatLink(pid, env.connId);
          this.sendLobby();
          void this.persist();
        }
        this.remoteLinks.delete(env.connId);
        return;
      }
      default:
        return;
    }
  }

  private remoteLink(connId: string): RemoteLink {
    let link = this.remoteLinks.get(connId);
    if (!link) {
      link = new RemoteLink(connId, this.code, this.ctx.bus, this.ctx.instanceId);
      this.remoteLinks.set(connId, link);
    }
    return link;
  }

  // --- teardown ------------------------------------------------------------

  /** Ownership changed under us: hand our controllers to the new owner. */
  private migrate(): void {
    if (this.destroyed) return;
    console.log(`[room ${this.code}] another instance owns this kitchen — handing over`);
    const moving: MigratingSeat[] = [];
    for (const { seat, link } of this.seats.values()) {
      if (link instanceof LocalLink) {
        moving.push({ conn: link.conn, code: this.code, name: seat.name, token: seat.token });
      }
    }
    this.teardown();
    this.ctx.onDestroyed(this);
    this.ctx.onMigrate(moving);
  }

  destroy(reason: string): void {
    if (this.destroyed) return;
    const host = this.host;
    const links = [...this.seats.values()].map((s) => s.link);
    this.teardown();
    for (const link of links) link?.close({ t: 'err', msg: reason });
    host?.close({ t: 'err', msg: reason });
    this.publishAll({ k: 'send', msg: { t: 'err', msg: reason } });
    void this.ctx.store.deleteRoom(this.code).catch(() => undefined);
    void this.ctx.store.releaseLease(this.code, this.ctx.instanceId).catch(() => undefined);
    this.ctx.onDestroyed(this);
    console.log(`[room ${this.code}] destroyed (${reason})`);
  }

  private teardown(): void {
    this.destroyed = true;
    this.stopLoop();
    if (this.house) clearInterval(this.house);
    this.house = null;
    this.unsubIn?.();
    this.unsubIn = null;
    this.seats.clear();
    this.byConn.clear();
    this.remoteLinks.clear();
    this.host = null;
  }
}
