// One kitchen: the authoritative sim, its roster of seats, and the clocks
// that keep both honest. Exactly one instance owns a room at a time — the one
// holding the room's lease. Everything here is transport-agnostic: sockets on
// this instance and proxies on other instances both arrive as a `Link`.

import { Game } from '../game/game';
import type { S2C } from '../shared/protocol';
import { MAX_PLAYERS, PLAYER_COLORS, SNAPSHOT_MS, TICK_MS } from '../shared/types';
import type { LobbyPlayer, Phase, Snapshot } from '../shared/types';

import { asBusEnv, asRoomRecord, hostMayPublish } from './bridge';
import {
  CHECKPOINT_MS,
  HOST_GRACE_MS,
  LEASE_MS,
  LEASE_RENEW_MS,
  MAX_DT_MS,
  REGISTRY_REFRESH_MS,
  RELAY_CLAIM_GRACE_MS,
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
  /**
   * Every transport currently identified as this chef. Normally one. In local
   * mode a phone holds two at once — its RTCDataChannel and the cloud socket
   * it keeps as a way back — and both must count as "this chef speaking", or
   * a reconnecting socket would look like a second player.
   */
  links: Map<string, Link>;
  /** The one we answer on. A peer channel always outranks a cloud socket. */
  link: Link | null;
}

/** Peer first, otherwise the transport that identified itself most recently. */
function pickPrimary(links: Map<string, Link>): Link | null {
  let newest: Link | null = null;
  for (const link of links.values()) {
    if (link.peer) return link;
    newest = link;
  }
  return newest;
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

  /**
   * Local mode. When true the sim runs in the host's browser tab and this
   * object is registry + relay only: it holds the lease, forwards `in` traffic
   * down the host socket, republishes what comes back, and keeps the last
   * record and checkpoint the tab sent so it can take the round over if the
   * tab disappears.
   */
  private relaying = false;
  /** Set while we wait for a reconnected host tab to re-claim the sim. */
  private claimTimer: ReturnType<typeof setTimeout> | null = null;

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
      room.seats.set(seat.playerId, { seat, links: new Map(), link: null });
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

  /** True while a host tab owns the sim and we are only relaying for it. */
  get isRelaying(): boolean {
    return this.relaying;
  }

  /** True when this chef's controller is wired straight to us over WebRTC. */
  isPeerSeat(playerId: string): boolean {
    return this.seats.get(playerId)?.link?.peer === true;
  }

  /** Deliver one message to a seat, whatever transport it is on. */
  sendTo(playerId: string, msg: S2C): void {
    this.seats.get(playerId)?.link?.send(msg);
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

    if (this.relaying) {
      // A host tab owned this room before its socket dropped. Its sim has been
      // running the whole time, so do not start ticking a stale copy — give it
      // a moment to say `claim-sim` again. If it does not, we take over.
      link.send({ t: 'sim', owner: 'host' });
      this.armClaimGrace();
    } else if (this.game.phase === 'playing') {
      this.startLoop();
    }

    void this.persist();
    console.log(`[room ${this.code}] host ${resumed ? 'resumed' : 'connected'}`);
  }

  // --- local mode: the sim moves into the host's tab -----------------------

  /**
   * The host tab says it will run the sim. We stop ticking and become
   * registry + relay: the lease, the room code, and a pipe to every controller
   * that could not reach the tab directly.
   */
  private claimSim(link: Link): void {
    if (this.destroyed || this.host?.id !== link.id) return;
    this.clearClaimGrace();

    if (this.relaying) {
      // A reconnected tab re-claiming what it already owns. It has been
      // simulating the whole time, so seed it from the registry only — its own
      // copy is fresher and it will ignore ours if it still has one.
      link.send({ t: 'sim', owner: 'host' });
      const rec: RoomRecord = { ...this.rec, seats: this.rec.seats.map((s) => ({ ...s })) };
      void this.ctx.store
        .getSnapshot(this.code)
        .then((snap) => {
          if (this.destroyed || this.host?.id !== link.id) return;
          link.send({ t: 'bus', env: { k: 'seed', rec, snap } });
        })
        .catch(() => link.send({ t: 'bus', env: { k: 'seed', rec, snap: null } }));
      return;
    }

    const rec: RoomRecord = { ...this.rec, phase: this.game.phase, seats: this.storedSeats() };
    const snap = this.game.phase === 'lobby' ? null : this.game.snapshot;

    this.relaying = true;
    this.stopLoop();
    // Every seat we were holding locally belongs to the tab now. Hand those
    // sockets back to the manager: it re-joins them over the bus, and the
    // seeded tab reclaims each one by its token — same chef, same held item.
    const moving = this.localSeatConns();
    this.seats.clear();
    this.byConn.clear();
    this.remoteLinks.clear();

    link.send({ t: 'sim', owner: 'host' });
    link.send({ t: 'bus', env: { k: 'seed', rec, snap } });
    // The tab's own Room announces itself on the bus as soon as it starts, so
    // controllers relayed from anywhere rebind without a prompt from here.
    if (moving.length > 0) this.ctx.onMigrate(moving);
    console.log(
      `[room ${this.code}] sim claimed by the host tab — relaying (${rec.seats.length} seat(s))`,
    );
  }

  private armClaimGrace(): void {
    this.clearClaimGrace();
    this.claimTimer = setTimeout(() => {
      this.claimTimer = null;
      void this.stopRelay().catch((err) =>
        console.error(`[room ${this.code}] could not take the sim back:`, err),
      );
    }, RELAY_CLAIM_GRACE_MS);
    this.claimTimer.unref?.();
  }

  private clearClaimGrace(): void {
    if (this.claimTimer === null) return;
    clearTimeout(this.claimTimer);
    this.claimTimer = null;
  }

  /** Take the round back from a host tab that is not coming back. */
  private async stopRelay(): Promise<void> {
    if (this.destroyed || !this.relaying) return;
    this.relaying = false;
    this.clearClaimGrace();

    const [rec, snap] = await Promise.all([
      this.ctx.store.getRoom(this.code).catch(() => null),
      this.ctx.store.getSnapshot(this.code).catch(() => null),
    ]);
    if (this.destroyed) return;

    if (snap && snap.phase !== 'lobby') {
      try {
        this.game.restoreSnapshot(snap);
      } catch (err) {
        console.error(`[room ${this.code}] checkpoint unusable, back to the lobby:`, err);
        this.game.toLobby();
      }
    }
    if (rec) {
      this.rec.seq = Math.max(this.rec.seq, rec.seq);
      const now = Date.now();
      for (const stored of rec.seats) {
        // Their phones are still talking to the bus, not to us: the grace
        // clock starts now and their re-announce reclaims the seat.
        const seat: Seat = { ...stored, connected: false, disconnectedAt: now };
        this.seats.set(seat.playerId, { seat, links: new Map(), link: null });
        if (!this.game.hasPlayer(seat.playerId)) {
          this.game.addPlayer(seat.playerId, seat.name, seat.color);
        }
      }
    }

    // Wake every proxy: the room's owner changed, so their routing is stale.
    this.publishAll({ k: 'owner', owner: this.ctx.instanceId });

    this.host?.send({ t: 'sim', owner: 'server' });
    this.host?.send({ t: 'phase', phase: this.game.phase });
    this.host?.send({ t: 'lobby', players: this.roster() });
    if (this.game.phase !== 'lobby') this.host?.send({ t: 'state', s: this.game.snapshot });
    if (this.game.phase === 'gameover') this.host?.send(this.gameoverMsg());
    if (this.game.phase === 'playing' && this.host) this.startLoop();
    await this.persist();
    console.log(
      `[room ${this.code}] host tab stood down — server owns the sim again ` +
        `(${this.game.phase}, ${this.seats.size} seat(s))`,
    );
  }

  /** One tunnel envelope from the host tab. Nothing in here is trusted. */
  private hostBus(link: Link, raw: unknown): void {
    if (this.destroyed || !this.relaying || this.host?.id !== link.id) return;
    const env = asBusEnv(raw);
    if (!env) return;
    switch (env.k) {
      case 'pub': {
        if (!hostMayPublish(this.code, env.ch)) return;
        void this.ctx.bus
          .publish(env.ch, env.p)
          .catch((err) => console.error('[bus] relay publish failed:', err));
        return;
      }
      case 'room': {
        const rec = asRoomRecord(this.code, env.rec);
        if (!rec) return;
        // The tab owns the registry entry while it owns the sim.
        this.rec.seq = Math.max(this.rec.seq, rec.seq);
        this.rec.phase = rec.phase;
        this.rec.seats = rec.seats;
        this.rec.updatedAt = Date.now();
        void this.ctx.store
          .putRoom({ ...this.rec, owner: this.ctx.instanceId, hostConnected: true })
          .catch((err) => console.error(`[room ${this.code}] registry write failed:`, err));
        return;
      }
      case 'snap': {
        void this.ctx.store
          .putSnapshot(this.code, env.snap)
          .catch((err) => console.error(`[room ${this.code}] checkpoint failed:`, err));
        return;
      }
      default:
        return;
    }
  }

  /** WebRTC handshake traffic. We route it; we never look inside `data`. */
  private signal(link: Link, msg: Record<string, unknown>): void {
    const to = msg.to;
    if (typeof to !== 'string') return;
    if (this.host?.id === link.id) {
      this.sendTo(to, { t: 'signal', from: 'host', data: msg.data });
      return;
    }
    const from = this.byConn.get(link.id);
    if (!from || to !== 'host') return;
    this.host?.send({ t: 'signal', from, data: msg.data });
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
    // Relay mode stays armed: the tab's sim is still running behind that dead
    // socket, and the reconnect will re-claim. Checkpointing here would write
    // our stale copy of the round over the tab's live one.
    this.clearClaimGrace();
    // Freeze the round where it stands and let another instance pick it up.
    if (!this.relaying) void this.checkpoint();
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
    // While a host tab owns the sim, its write-through owns the registry
    // entry. Anything we wrote here would be an empty, frozen copy.
    if (this.relaying) return;
    this.rec.phase = this.game.phase;
    this.rec.seats = this.storedSeats();
    this.rec.owner = this.ctx.instanceId;
    this.rec.updatedAt = Date.now();
    await this.ctx.store.putRoom(this.rec).catch((err) => {
      console.error(`[room ${this.code}] registry write failed:`, err);
    });
  }

  private async checkpoint(): Promise<void> {
    if (this.destroyed || this.relaying) return;
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

    // Relay mode: the tab writes the record and sweeps its own seats.
    if (this.relaying) return;

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
    for (const id of st.links.keys()) {
      this.byConn.delete(id);
      this.remoteLinks.delete(id);
    }
    this.game.removePlayer(playerId);
    console.log(`[room ${this.code}] ${st.seat.name} left — ${this.seats.size} chef(s)`);
  }

  // --- client messages -----------------------------------------------------

  handleMessage(link: Link, msg: Record<string, unknown>): void {
    switch (msg.t) {
      case 'join':
        this.join(link, msg);
        return;
      case 'claim-sim':
        this.claimSim(link);
        return;
      case 'bus':
        this.hostBus(link, msg.env);
        return;
      case 'signal':
        this.signal(link, msg);
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
    let st = known ? (this.seats.get(known) ?? null) : null;
    if (known && !st) this.byConn.delete(link.id);

    if (!st) {
      const token = asToken(msg.token);
      st = token ? this.seatByToken(token) : null;
    }

    if (st) {
      this.adoptLink(st, link);
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
    const fresh: SeatRuntime = { seat, links: new Map([[link.id, link]]), link };
    this.seats.set(playerId, fresh);
    this.byConn.set(link.id, playerId);
    this.game.addPlayer(playerId, seat.name, seat.color);

    this.sendJoined(fresh, link);
    this.sendLobby();
    void this.persist();
    console.log(`[room ${this.code}] ${seat.name} (${playerId}) joined — ${this.seats.size} chef(s)`);
  }

  /**
   * Point this transport at an existing seat.
   *
   * Three things arrive here and all three are the same chef:
   *   - a phone reconnecting after its socket dropped (hang up the zombie);
   *   - a phone that just opened its RTCDataChannel and is claiming its seat
   *     on it (keep the socket — it is the way back if the channel dies);
   *   - that same phone's socket re-identifying itself later, while the
   *     channel is healthy (keep the channel primary; do not churn).
   */
  private adoptLink(st: SeatRuntime, link: Link): void {
    const wasPeer = st.link?.peer === true;
    for (const [id, old] of [...st.links]) {
      if (id === link.id) continue;
      // Two live transports for one chef is the normal, wanted state in local
      // mode. Only hang up a stale cloud socket being replaced by another
      // cloud socket — that one really is a zombie.
      if (link.peer || old.peer) continue;
      st.links.delete(id);
      this.byConn.delete(id);
      this.remoteLinks.delete(id);
      old.close({ t: 'err', msg: 'This chef reconnected somewhere else.' });
    }

    // Re-insert so `pickPrimary` reads this as the most recent transport.
    st.links.delete(link.id);
    st.links.set(link.id, link);
    st.link = pickPrimary(st.links);
    st.seat.connected = st.link !== null;
    st.seat.disconnectedAt = null;
    this.byConn.set(link.id, st.seat.playerId);

    // Mid-round the body is still on the floor; otherwise re-seat them.
    if (!this.game.hasPlayer(st.seat.playerId)) {
      this.game.addPlayer(st.seat.playerId, st.seat.name, st.seat.color);
    }

    this.sendJoined(st, link);
    this.sendLobby();
    void this.persist();
    const how = link.peer ? 'over the local channel' : 'over the cloud';
    if (link.peer !== wasPeer || st.links.size === 1) {
      console.log(`[room ${this.code}] ${st.seat.name} claimed their seat ${how}`);
    }
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
    if (!st) return;
    const was = st.link;
    st.links.delete(connId);
    st.link = pickPrimary(st.links);
    if (was?.id !== connId) return;
    // A local channel that dies while the phone still holds its cloud socket
    // simply demotes to that socket: same chef, same held item, one hop more.
    if (st.link) {
      console.log(`[room ${this.code}] ${st.seat.name} fell back to the cloud path`);
      return;
    }
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
    if (this.relaying) {
      // The sim is in the host's tab. Hand the whole envelope over untouched —
      // its Room subscribes to the same channel on its own in-memory bus.
      this.host?.send({ t: 'bus', env: { k: 'pub', ch: inChannel(this.code), p: payload } });
      return;
    }
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

  /** Every seat socket living on this instance, ready to be re-seated. */
  private localSeatConns(): MigratingSeat[] {
    const moving: MigratingSeat[] = [];
    for (const { seat, links } of this.seats.values()) {
      for (const link of links.values()) {
        if (link instanceof LocalLink) {
          moving.push({ conn: link.conn, code: this.code, name: seat.name, token: seat.token });
        }
      }
    }
    return moving;
  }

  /** Ownership changed under us: hand our controllers to the new owner. */
  private migrate(): void {
    if (this.destroyed) return;
    console.log(`[room ${this.code}] another instance owns this kitchen — handing over`);
    const moving = this.localSeatConns();
    this.teardown();
    this.ctx.onDestroyed(this);
    this.ctx.onMigrate(moving);
  }

  /**
   * Let go of this room without ending it: stop the clocks, drop the lease,
   * say nothing to anyone. A host tab closing does this — its round lives on
   * in the server's checkpoint, and the server picks it straight back up.
   */
  standDown(): void {
    if (this.destroyed) return;
    const host = this.host;
    this.teardown();
    host?.close();
    void this.ctx.store.releaseLease(this.code, this.ctx.instanceId).catch(() => undefined);
    this.ctx.onDestroyed(this);
  }

  destroy(reason: string): void {
    if (this.destroyed) return;
    const host = this.host;
    const links = [...this.seats.values()].flatMap((s) => [...s.links.values()]);
    this.teardown();
    for (const link of links) link.close({ t: 'err', msg: reason });
    host?.close({ t: 'err', msg: reason });
    this.publishAll({ k: 'send', msg: { t: 'err', msg: reason } });
    void this.ctx.store.deleteRoom(this.code).catch(() => undefined);
    void this.ctx.store.releaseLease(this.code, this.ctx.instanceId).catch(() => undefined);
    this.ctx.onDestroyed(this);
    console.log(`[room ${this.code}] destroyed (${reason})`);
  }

  private teardown(): void {
    this.destroyed = true;
    this.relaying = false;
    this.clearClaimGrace();
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
