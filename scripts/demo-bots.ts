// Demo chefs: WebSocket bots that actually cook.
//
// Three bots join a room as ordinary controllers and run a closed-loop kitchen
// brain: fetch -> chop -> pot -> plate -> serve, on repeat, using the real
// level geometry from shared/levels.ts. They are used to film the launch demo
// (demo/capture), and can be driven standalone for a quick sanity run:
//
//   PORT=3210 npx tsx scripts/demo-bots.ts            # own host socket
//   PORT=3210 SECONDS=45 npx tsx scripts/demo-bots.ts
//
// Snapshots only ever go to the host socket, and a room has exactly one host.
// So the bots never subscribe themselves: whoever owns the host connection
// (this file in CLI mode, the Playwright page in capture mode) feeds snapshots
// in via `feed()`. That keeps the brain fully closed-loop on real server state.

import WebSocket from 'ws';

import type { Btn, C2S, S2C } from '../shared/protocol';
import { LOCAL_PORT, WS_PATH } from '../shared/protocol';
import { createLevel } from '../shared/levels';
import type { HeldItem, IngredientType, PlayerState, Snapshot, Tile, Vec2 } from '../shared/types';
import { COOK_MS, POT_CAPACITY } from '../shared/types';

/* ============================ level geometry ============================= */

const LEVEL = createLevel();
const W = LEVEL.w;
const H = LEVEL.h;
const WALK: boolean[] = LEVEL.tiles.map((t) => t.t === 'floor');

const NEIGHBOURS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const idxOf = (x: number, y: number): number => y * W + x;
const xyOf = (i: number): Vec2 => ({ x: i % W, y: Math.floor(i / W) });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

/** A place to stand, and the direction to face, to work one station. */
interface Access {
  /** Station tile (the counter/crate/stove itself). */
  station: Vec2;
  /** Station tile index. */
  idx: number;
  /** Floor tile the chef stands on. */
  stand: Vec2;
  /** Unit facing so that round(pos + dir) lands on the station. */
  dir: Vec2;
}

/** Every floor tile from which a chef can reach `station`. */
function accessesOf(station: Vec2): Access[] {
  const out: Access[] = [];
  for (const d of NEIGHBOURS) {
    const sx = station.x - d.x;
    const sy = station.y - d.y;
    if (!inBounds(sx, sy) || !WALK[idxOf(sx, sy)]) continue;
    out.push({
      station,
      idx: idxOf(station.x, station.y),
      stand: { x: sx, y: sy },
      dir: d,
    });
  }
  return out;
}

/** First (and for this kitchen, only sensible) way in to a station. */
function accessOf(station: Vec2): Access | null {
  return accessesOf(station)[0] ?? null;
}

// BFS distance fields, cached per goal tile. The walkable set never changes.
const fieldCache = new Map<number, Int32Array>();

function field(goal: Vec2): Int32Array {
  const key = idxOf(goal.x, goal.y);
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const d = new Int32Array(W * H).fill(-1);
  if (WALK[key]) {
    d[key] = 0;
    const queue = [key];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const { x, y } = xyOf(cur);
      for (const n of NEIGHBOURS) {
        const nx = x + n.x;
        const ny = y + n.y;
        if (!inBounds(nx, ny)) continue;
        const ni = idxOf(nx, ny);
        if (!WALK[ni] || d[ni] !== -1) continue;
        d[ni] = d[cur] + 1;
        queue.push(ni);
      }
    }
  }
  fieldCache.set(key, d);
  return d;
}

/** Walking distance in tiles between two floor tiles (Infinity if unreachable). */
function walkDist(from: Vec2, to: Vec2): number {
  const d = field(to)[idxOf(from.x, from.y)];
  return d < 0 ? Infinity : d;
}

/** 4-connected tile path from `from` (exclusive) to `goal` (inclusive). */
function pathTo(from: Vec2, goal: Vec2): Vec2[] {
  const d = field(goal);
  let cur = idxOf(from.x, from.y);
  if (d[cur] < 0) return [];
  const out: Vec2[] = [];
  while (d[cur] > 0) {
    const { x, y } = xyOf(cur);
    let next = -1;
    for (const n of NEIGHBOURS) {
      const nx = x + n.x;
      const ny = y + n.y;
      if (!inBounds(nx, ny)) continue;
      const ni = idxOf(nx, ny);
      if (d[ni] >= 0 && d[ni] === d[cur] - 1) {
        next = ni;
        break;
      }
    }
    if (next < 0) break;
    out.push(xyOf(next));
    cur = next;
  }
  return out;
}

/** Nearest floor tile to a world position (a chef pressed into a wall rounds off it). */
function tileOf(pos: Vec2): Vec2 {
  const rx = Math.min(W - 1, Math.max(0, Math.round(pos.x)));
  const ry = Math.min(H - 1, Math.max(0, Math.round(pos.y)));
  if (WALK[idxOf(rx, ry)]) return { x: rx, y: ry };
  let best: Vec2 = { x: rx, y: ry };
  let bestD = Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!WALK[idxOf(x, y)]) continue;
      const d = dist(pos, { x, y });
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Server-identical interaction target: round(pos + dir), clamped to the grid. */
function targetIdx(p: PlayerState): number {
  const tx = Math.min(W - 1, Math.max(0, Math.round(p.pos.x + p.dir.x)));
  const ty = Math.min(H - 1, Math.max(0, Math.round(p.pos.y + p.dir.y)));
  return idxOf(tx, ty);
}

// --- station catalogue (static, from the level) ---

function stationsOfType(t: Tile['t']): Vec2[] {
  const out: Vec2[] = [];
  LEVEL.tiles.forEach((tile, i) => {
    if (tile.t === t) out.push(xyOf(i));
  });
  return out;
}

const CRATES: Record<IngredientType, Access> = (() => {
  const map = {} as Record<IngredientType, Access>;
  for (const pos of stationsOfType('crate')) {
    const tile = LEVEL.tiles[idxOf(pos.x, pos.y)];
    const a = accessOf(pos);
    if (tile.crate && a) map[tile.crate] = a;
  }
  return map;
})();

const BOARDS: Access[] = stationsOfType('board')
  .map(accessOf)
  .filter((a): a is Access => a !== null);
const STOVES: Access[] = stationsOfType('stove')
  .map(accessOf)
  .filter((a): a is Access => a !== null);
const PLATES: Access = accessOf(stationsOfType('plates')[0])!;
const SERVE: Access = accessOf(stationsOfType('serve')[0])!;

/**
 * Counters we park chopped ingredients on while waiting for the next order,
 * nearest the stoves first — a staged ingredient turns a 15 s round trip into
 * a two-tile walk.
 */
const STAGE_COUNTERS: Access[] = stationsOfType('counter')
  .map(accessOf)
  .filter((a): a is Access => a !== null)
  .sort((a, b) => walkDist(a.stand, STOVES[0].stand) - walkDist(b.stand, STOVES[0].stand))
  .slice(0, 6);

/* ============================== small utils ============================== */

const ZERO: Vec2 = { x: 0, y: 0 };
const INGREDIENTS: readonly IngredientType[] = ['onion', 'tomato', 'mushroom'];

/** `need` minus `have`, treating both as multisets. */
function multisetDiff(need: readonly IngredientType[], have: readonly IngredientType[]): IngredientType[] {
  const pool = [...have];
  const out: IngredientType[] = [];
  for (const n of need) {
    const i = pool.indexOf(n);
    if (i >= 0) pool.splice(i, 1);
    else out.push(n);
  }
  return out;
}

function sameRecipe(a: readonly IngredientType[], b: readonly IngredientType[]): boolean {
  return a.length === b.length && multisetDiff(a, b).length === 0;
}

const tileAt = (s: Snapshot, i: number): Tile | undefined => s.tiles[i];

function isIngredient(item: HeldItem | null | undefined, type?: IngredientType, chopped?: boolean): boolean {
  if (!item || item.kind !== 'ingredient') return false;
  if (type !== undefined && item.ing.type !== type) return false;
  if (chopped !== undefined && item.ing.chopped !== chopped) return false;
  return true;
}

/* ============================== bot plumbing ============================= */

/** One executable move in a task script. Every step is closed-loop. */
type Step =
  | { k: 'goto'; tile: Vec2; timeoutMs: number }
  | { k: 'useA'; at: Access; done: (c: Ctx) => boolean; timeoutMs: number }
  | { k: 'useB'; at: Access; done: (c: Ctx) => boolean; timeoutMs: number }
  | { k: 'waitAt'; at: Access; done: (c: Ctx) => boolean; timeoutMs: number };

interface Ctx {
  snap: Snapshot;
  me: PlayerState;
}

type Task = Generator<Step, void, void>;

/** Why a bot is doing what it is doing — used for reservations, not display. */
interface Reservation {
  stoveIdx: number;
  type: IngredientType;
}

class Bot {
  readonly name: string;
  ws: WebSocket | null = null;
  id = '';
  token = '';
  color = '';

  private lastMove: Vec2 = ZERO;
  private bDown = false;
  private lastPressA = 0;

  task: Task | null = null;
  step: Step | null = null;
  stepStartedAt = 0;
  label = 'idle';

  // navigation
  private navGoal: Vec2 | null = null;
  private navPath: Vec2[] = [];
  private navBest = Infinity;
  private navBestAt = 0;

  // reservations, held across the tasks that make up one delivery
  reserve: Reservation | null = null;
  serveStove: number | null = null;
  boardClaim: number | null = null;
  counterClaim: number | null = null;
  stageTarget: number | null = null;
  prepType: IngredientType | null = null;

  constructor(name: string) {
    this.name = name;
  }

  send(m: C2S): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  setMove(v: Vec2): void {
    if (Math.abs(v.x - this.lastMove.x) < 0.02 && Math.abs(v.y - this.lastMove.y) < 0.02) return;
    this.lastMove = { x: v.x, y: v.y };
    this.send({ t: 'input', move: this.lastMove });
  }

  tapA(now: number): void {
    if (now - this.lastPressA < 200) return;
    this.lastPressA = now;
    this.press('a');
    this.release('a');
  }

  holdB(): void {
    if (this.bDown) return;
    this.bDown = true;
    this.press('b');
  }

  releaseB(): void {
    if (!this.bDown) return;
    this.bDown = false;
    this.release('b');
  }

  private press(btn: Btn): void {
    this.send({ t: 'press', btn });
  }

  private release(btn: Btn): void {
    this.send({ t: 'release', btn });
  }

  /* --- navigation --- */

  navReset(): void {
    this.navGoal = null;
    this.navPath = [];
    this.navBest = Infinity;
  }

  /** Steering vector toward `goal`; {0,0} once we are standing on it. */
  navTowards(goal: Vec2, pos: Vec2, now: number, arrive = 0.2): Vec2 {
    if (!this.navGoal || this.navGoal.x !== goal.x || this.navGoal.y !== goal.y) {
      this.navGoal = { x: goal.x, y: goal.y };
      this.navPath = pathTo(tileOf(pos), goal);
      this.navBest = Infinity;
      this.navBestAt = now;
    }
    const d = dist(pos, goal);
    if (d < arrive) return ZERO;

    // Stuck? (bumped by another chef, or shoved off the path) — repath.
    if (d < this.navBest - 0.05) {
      this.navBest = d;
      this.navBestAt = now;
    } else if (now - this.navBestAt > 900) {
      this.navPath = pathTo(tileOf(pos), goal);
      this.navBest = d;
      this.navBestAt = now;
    }

    while (this.navPath.length > 1 && dist(pos, this.navPath[0]) < 0.28) this.navPath.shift();
    const wp = this.navPath[0] ?? goal;
    const vx = wp.x - pos.x;
    const vy = wp.y - pos.y;
    const len = Math.hypot(vx, vy);
    return len < 1e-4 ? ZERO : { x: vx / len, y: vy / len };
  }

  /** Drop the current task and every claim it held. */
  abort(): void {
    this.releaseB();
    this.setMove(ZERO);
    this.navReset();
    this.task = null;
    this.step = null;
    this.reserve = null;
    this.serveStove = null;
    this.boardClaim = null;
    this.counterClaim = null;
    this.stageTarget = null;
    this.prepType = null;
    this.label = 'idle';
  }
}

/* ================================ the team =============================== */

export interface BotTeamOptions {
  wsUrl: string;
  room: string;
  names?: string[];
  log?: (msg: string) => void;
}

const DEFAULT_NAMES = ['Basil', 'Olive', 'Pepper'];

/** How many chopped ingredients to keep parked on counters between orders. */
const STAGE_TARGET = 6;
/** Fetch the plate this long before the pot finishes, so the soup never waits. */
const PLATE_LEAD_MS = 3500;

export class BotTeam {
  private readonly bots: Bot[];
  private readonly opts: BotTeamOptions;
  private readonly log: (msg: string) => void;
  /** Recipe each stove is currently cooking toward, by stove tile index. */
  private readonly jobs = new Map<number, IngredientType[]>();
  private lastFeedAt = 0;
  private stopped = false;

  constructor(opts: BotTeamOptions) {
    this.opts = opts;
    this.log = opts.log ?? (() => {});
    this.bots = (opts.names ?? DEFAULT_NAMES).map((n) => new Bot(n));
  }

  get playerIds(): string[] {
    return this.bots.map((b) => b.id).filter(Boolean);
  }

  /** Open every socket and join the room. Resolves once all seats are taken. */
  async connect(): Promise<void> {
    for (const bot of this.bots) {
      await this.connectOne(bot);
    }
    this.log(`bots seated: ${this.bots.map((b) => `${b.name}(${b.id})`).join(', ')}`);
  }

  private connectOne(bot: Bot): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.wsUrl);
      bot.ws = ws;
      const timer = setTimeout(() => reject(new Error(`${bot.name}: join timed out`)), 15000);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: this.opts.room, name: bot.name } as C2S)));
      ws.on('message', (raw) => {
        let msg: S2C;
        try {
          msg = JSON.parse(String(raw)) as S2C;
        } catch {
          return;
        }
        if (msg.t === 'joined') {
          bot.id = msg.playerId;
          bot.token = msg.token;
          bot.color = msg.color;
          clearTimeout(timer);
          resolve();
        } else if (msg.t === 'err') {
          clearTimeout(timer);
          reject(new Error(`${bot.name}: ${msg.msg}`));
        }
      });
      ws.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /** Any chef may start the round. */
  startRound(): void {
    this.bots[0]?.send({ t: 'start' });
  }

  stop(): void {
    this.stopped = true;
    for (const bot of this.bots) {
      bot.abort();
      bot.ws?.close();
      bot.ws = null;
    }
  }

  /**
   * Advance every brain against a fresh server snapshot. Call this at snapshot
   * rate (~20 Hz) from whoever owns the host socket.
   */
  feed(snap: Snapshot): void {
    if (this.stopped) return;
    const now = Date.now();
    this.lastFeedAt = now;
    if (snap.phase !== 'playing') {
      for (const bot of this.bots) {
        if (bot.task) bot.abort();
      }
      return;
    }

    this.syncJobs(snap);

    for (const bot of this.bots) {
      const me = snap.players.find((p) => p.id === bot.id);
      if (!me) continue;
      const ctx: Ctx = { snap, me };

      if (!bot.task) {
        const next = this.assign(bot, ctx);
        if (next) {
          bot.task = next;
          bot.step = null;
        } else {
          bot.setMove(ZERO);
          continue;
        }
      }
      this.runTask(bot, ctx, now);
    }
  }

  /** Wall-clock time of the last snapshot handled (diagnostics). */
  get lastTickAt(): number {
    return this.lastFeedAt;
  }

  /** One-line per-bot status, for tuning runs. */
  debug(snap: Snapshot): string {
    return this.bots
      .map((b) => {
        const me = snap.players.find((p) => p.id === b.id);
        const held = me?.held
          ? me.held.kind === 'plate'
            ? me.held.soup
              ? 'soup'
              : 'plate'
            : `${me.held.ing.type}${me.held.ing.chopped ? '*' : ''}`
          : '-';
        const pos = me ? `${me.pos.x.toFixed(1)},${me.pos.y.toFixed(1)}` : '?';
        return `${b.name}[${b.label}|${held}|${pos}|${b.step?.k ?? '-'}]`;
      })
      .join(' ');
  }

  /* ------------------------------ step runner ---------------------------- */

  private runTask(bot: Bot, ctx: Ctx, now: number): void {
    for (let guard = 0; guard < 4; guard++) {
      if (!bot.task) return;
      if (!bot.step) {
        const next = bot.task.next();
        if (next.done) {
          bot.task = null;
          bot.step = null;
          bot.navReset();
          bot.setMove(ZERO);
          return;
        }
        bot.step = next.value;
        bot.stepStartedAt = now;
        bot.navReset();
      }

      const outcome = this.runStep(bot, bot.step, ctx, now);
      if (outcome === 'running') return;
      if (outcome === 'fail') {
        this.log(`${bot.name}: step '${bot.step.k}' failed during ${bot.label}`);
        bot.abort();
        return;
      }
      bot.step = null; // done -> pull the next step immediately
    }
  }

  private runStep(bot: Bot, step: Step, ctx: Ctx, now: number): 'running' | 'done' | 'fail' {
    const elapsed = now - bot.stepStartedAt;

    switch (step.k) {
      case 'goto': {
        if (dist(ctx.me.pos, step.tile) < 0.2) {
          bot.setMove(ZERO);
          return 'done';
        }
        if (elapsed > step.timeoutMs) return 'fail';
        bot.setMove(bot.navTowards(step.tile, ctx.me.pos, now));
        return 'running';
      }

      case 'useA':
      case 'useB':
      case 'waitAt': {
        if (step.done(ctx)) {
          if (step.k === 'useB') bot.releaseB();
          bot.setMove(ZERO);
          return 'done';
        }
        if (elapsed > step.timeoutMs) {
          if (step.k === 'useB') bot.releaseB();
          return 'fail';
        }
        // Drift off the working tile (a shove from another chef) -> walk back.
        if (dist(ctx.me.pos, step.at.stand) > 0.45) {
          if (step.k === 'useB') bot.releaseB();
          bot.setMove(bot.navTowards(step.at.stand, ctx.me.pos, now));
          return 'running';
        }
        bot.navReset();
        // Lean into the station: facing follows the stick, and the wall stops us.
        bot.setMove(step.at.dir);
        const aimed = targetIdx(ctx.me) === step.at.idx;
        if (aimed && step.k === 'useA') bot.tapA(now);
        if (aimed && step.k === 'useB') bot.holdB();
        if (!aimed && step.k === 'useB') bot.releaseB();
        return 'running';
      }
    }
  }

  /* -------------------------------- jobs --------------------------------- */

  /**
   * Keep one target recipe per stove. A stove with an empty idle pot takes the
   * oldest order no other stove is already cooking; a stove with contents keeps
   * whatever it started.
   */
  private syncJobs(snap: Snapshot): void {
    for (const stove of STOVES) {
      const pot = tileAt(snap, stove.idx)?.pot;
      if (!pot) continue;
      if (pot.state === 'burnt') {
        this.jobs.delete(stove.idx);
        continue;
      }
      if (pot.contents.length > 0 || pot.state !== 'idle') continue;
      // Empty pot: only hold a job while someone is actively feeding it.
      const inflight = this.bots.some((b) => b.reserve?.stoveIdx === stove.idx);
      if (inflight) continue;
      this.jobs.delete(stove.idx);
    }

    for (const stove of STOVES) {
      const pot = tileAt(snap, stove.idx)?.pot;
      if (!pot || this.jobs.has(stove.idx) || pot.state !== 'idle' || pot.contents.length > 0) continue;
      const recipe = this.pickRecipe(snap);
      if (recipe) this.jobs.set(stove.idx, recipe);
    }
  }

  /** The oldest order whose recipe is not already claimed by another stove. */
  private pickRecipe(snap: Snapshot): IngredientType[] | null {
    const claimed = [...this.jobs.values()];
    for (const order of snap.orders) {
      const orders = snap.orders.filter((o) => sameRecipe(o.recipe, order.recipe)).length;
      const taken = claimed.filter((r) => sameRecipe(r, order.recipe)).length;
      if (orders > taken) return [...order.recipe];
    }
    return null;
  }

  /** Ingredients a stove still needs, minus what is already on its way. */
  private missingFor(snap: Snapshot, stoveIdx: number, ignore?: Bot): IngredientType[] {
    const recipe = this.jobs.get(stoveIdx);
    const pot = tileAt(snap, stoveIdx)?.pot;
    if (!recipe || !pot) return [];
    if (pot.state === 'done' || pot.state === 'burnt') return [];
    const inflight = this.bots
      .filter((b) => b !== ignore && b.reserve?.stoveIdx === stoveIdx)
      .map((b) => b.reserve!.type);
    return multisetDiff(recipe, [...pot.contents, ...inflight]);
  }

  /* ----------------------------- assignment ------------------------------ */

  private freeBoard(snap: Snapshot, me: PlayerState): Access | null {
    const open = BOARDS.filter(
      (b) => !tileAt(snap, b.idx)?.item && !this.bots.some((o) => o.boardClaim === b.idx),
    );
    open.sort((a, b) => walkDist(tileOf(me.pos), a.stand) - walkDist(tileOf(me.pos), b.stand));
    return open[0] ?? null;
  }

  /** A counter holding a chopped ingredient of `type` that nobody has claimed. */
  private stagedSource(snap: Snapshot, type: IngredientType): Access | null {
    for (const c of STAGE_COUNTERS) {
      if (this.bots.some((o) => o.counterClaim === c.idx)) continue;
      if (isIngredient(tileAt(snap, c.idx)?.item, type, true)) return c;
    }
    return null;
  }

  private freeStageCounter(snap: Snapshot): Access | null {
    for (const c of STAGE_COUNTERS) {
      if (this.bots.some((o) => o.counterClaim === c.idx || o.stageTarget === c.idx)) continue;
      if (!tileAt(snap, c.idx)?.item) return c;
    }
    return null;
  }

  private stagedCount(snap: Snapshot): number {
    return STAGE_COUNTERS.filter((c) => isIngredient(tileAt(snap, c.idx)?.item, undefined, true)).length;
  }

  /**
   * What to pre-chop next: the type we have least of, counting both the
   * counters and whatever is already on its way there. Orders are random
   * draws, so an even spread is what actually pays off when one lands.
   */
  private nextPrepType(snap: Snapshot): IngredientType {
    const count = new Map<IngredientType, number>(INGREDIENTS.map((t) => [t, 0] as const));
    const bump = (t: IngredientType): void => {
      count.set(t, (count.get(t) ?? 0) + 1);
    };
    for (const c of STAGE_COUNTERS) {
      const item = tileAt(snap, c.idx)?.item;
      if (item?.kind === 'ingredient' && item.ing.chopped) bump(item.ing.type);
    }
    for (const b of this.bots) if (b.prepType) bump(b.prepType);
    let best = INGREDIENTS[0];
    for (const t of INGREDIENTS) if ((count.get(t) ?? 0) < (count.get(best) ?? 0)) best = t;
    return best;
  }

  /** Decide this bot's next short task from what it holds and what the kitchen needs. */
  private assign(bot: Bot, ctx: Ctx): Task | null {
    const { snap, me } = ctx;
    const held = me.held;

    // --- carrying something: finish what it is for ---
    if (held) {
      if (held.kind === 'plate') {
        if (held.soup !== null) {
          bot.label = 'serve';
          return this.serveTask(bot);
        }
        const target = this.pickDonePot(snap, bot) ?? bot.serveStove;
        if (target !== null) {
          bot.serveStove = target;
          bot.label = 'plate up';
          return this.fillPlateTask(bot, target);
        }
        const park = this.freeStageCounter(snap);
        if (park) {
          bot.counterClaim = park.idx;
          bot.label = 'tidy';
          return this.stashTask(bot, park);
        }
        return null;
      }

      // ingredient
      if (!held.ing.chopped) {
        const board = bot.boardClaim !== null ? BOARDS.find((b) => b.idx === bot.boardClaim) : this.freeBoard(snap, me);
        if (!board) return null;
        bot.boardClaim = board.idx;
        bot.label = 'chop';
        return this.chopTask(bot, board, held.ing.type);
      }

      const type = held.ing.type;
      const stove = this.stoveWanting(snap, type, bot);
      if (stove !== null) {
        bot.reserve = { stoveIdx: stove, type };
        bot.label = 'to the pot';
        return this.potTask(bot, stove);
      }
      bot.reserve = null;
      const park = bot.stageTarget !== null
        ? STAGE_COUNTERS.find((c) => c.idx === bot.stageTarget) ?? this.freeStageCounter(snap)
        : this.freeStageCounter(snap);
      if (park) {
        bot.counterClaim = park.idx;
        bot.label = 'prep';
        return this.stashTask(bot, park);
      }
      return null;
    }

    // --- empty handed ---
    bot.reserve = null;
    bot.stageTarget = null;
    bot.prepType = null;

    // 1. a burnt pot blocks a stove: dump it.
    for (const stove of STOVES) {
      const pot = tileAt(snap, stove.idx)?.pot;
      if (pot?.state === 'burnt') {
        bot.label = 'dump';
        return this.dumpTask(stove);
      }
    }

    // 2. a finished pot: fetch a plate and run the soup out.
    const done = this.pickDonePot(snap, bot);
    if (done !== null) {
      bot.serveStove = done;
      bot.label = 'plate';
      return this.plateTask();
    }

    // 3. feed the pot closest to full.
    const hungry = STOVES.map((s) => ({ s, missing: this.missingFor(snap, s.idx, bot) }))
      .filter((j) => j.missing.length > 0)
      .sort((a, b) => a.missing.length - b.missing.length);
    for (const job of hungry) {
      // Take a pre-chopped one first when we have it: that is a two-tile walk
      // instead of crate -> board -> knife -> stove.
      const types = [...new Set(job.missing)].sort(
        (a, b) => (this.stagedSource(snap, a) ? 0 : 1) - (this.stagedSource(snap, b) ? 0 : 1),
      );
      for (const type of types) {
        const staged = this.stagedSource(snap, type);
        if (staged) {
          bot.reserve = { stoveIdx: job.s.idx, type };
          bot.counterClaim = staged.idx;
          bot.label = `fetch ${type} (staged)`;
          return this.takeStagedTask(bot, staged, type);
        }
        const board = this.freeBoard(snap, me);
        if (board) {
          bot.reserve = { stoveIdx: job.s.idx, type };
          bot.boardClaim = board.idx;
          bot.label = `fetch ${type}`;
          return this.crateTask(type);
        }
      }
    }

    // 4. nothing urgent: pre-chop stock so the next order lands fast.
    if (this.stagedCount(snap) < STAGE_TARGET) {
      const board = this.freeBoard(snap, me);
      const park = this.freeStageCounter(snap);
      if (board && park) {
        const type = this.nextPrepType(snap);
        bot.boardClaim = board.idx;
        bot.stageTarget = park.idx;
        bot.prepType = type;
        bot.label = `prep ${type}`;
        return this.crateTask(type);
      }
    }

    // 5. loiter next to the stoves so the next job starts close by.
    const pot = STOVES.find((s) => tileAt(snap, s.idx)?.pot?.state === 'cooking');
    if (pot && dist(me.pos, pot.stand) > 0.6) {
      bot.label = 'wait';
      return this.walkTask(pot.stand);
    }
    return null;
  }

  /** A stove that still wants `type`, preferring the fullest pot. */
  private stoveWanting(snap: Snapshot, type: IngredientType, bot: Bot): number | null {
    const options = STOVES.map((s) => ({
      idx: s.idx,
      missing: this.missingFor(snap, s.idx, bot),
      have: tileAt(snap, s.idx)?.pot?.contents.length ?? 0,
    }))
      .filter((o) => o.missing.includes(type) && o.have < POT_CAPACITY)
      .sort((a, b) => b.have - a.have);
    return options[0]?.idx ?? null;
  }

  /**
   * A pot worth fetching a plate for: already cooked, or within PLATE_LEAD_MS
   * of it — the walk to the plate stack and back is dead time otherwise.
   */
  private pickDonePot(snap: Snapshot, bot: Bot): number | null {
    for (const stove of STOVES) {
      const pot = tileAt(snap, stove.idx)?.pot;
      if (!pot) continue;
      const ready =
        pot.state === 'done' ||
        (pot.state === 'cooking' &&
          pot.contents.length >= POT_CAPACITY &&
          pot.cookMs >= COOK_MS - PLATE_LEAD_MS);
      if (!ready) continue;
      if (this.bots.some((o) => o !== bot && o.serveStove === stove.idx)) continue;
      return stove.idx;
    }
    return null;
  }

  /* ------------------------------- tasks --------------------------------- */

  private *walkTask(tile: Vec2): Task {
    yield { k: 'goto', tile, timeoutMs: 6000 };
  }

  /** Grab a raw ingredient from its crate. */
  private *crateTask(type: IngredientType): Task {
    const crate = CRATES[type];
    yield { k: 'goto', tile: crate.stand, timeoutMs: 9000 };
    yield {
      k: 'useA',
      at: crate,
      done: (c) => isIngredient(c.me.held, type, false),
      timeoutMs: 4000,
    };
  }

  /** Place on a board, hold the knife, pick the chopped ingredient back up. */
  private *chopTask(bot: Bot, board: Access, type: IngredientType): Task {
    yield { k: 'goto', tile: board.stand, timeoutMs: 9000 };
    yield {
      k: 'useA',
      at: board,
      done: (c) => c.me.held === null && isIngredient(tileAt(c.snap, board.idx)?.item, type, false),
      timeoutMs: 4000,
    };
    yield {
      k: 'useB',
      at: board,
      done: (c) => isIngredient(tileAt(c.snap, board.idx)?.item, type, true),
      timeoutMs: 6000,
    };
    yield {
      k: 'useA',
      at: board,
      done: (c) => isIngredient(c.me.held, type, true),
      timeoutMs: 4000,
    };
    bot.boardClaim = null;
  }

  /** Pick a pre-chopped ingredient off a staging counter. */
  private *takeStagedTask(bot: Bot, counter: Access, type: IngredientType): Task {
    yield { k: 'goto', tile: counter.stand, timeoutMs: 9000 };
    yield {
      k: 'useA',
      at: counter,
      done: (c) => isIngredient(c.me.held, type, true),
      timeoutMs: 4000,
    };
    bot.counterClaim = null;
  }

  /** Drop the chopped ingredient into a pot. */
  private *potTask(bot: Bot, stoveIdx: number): Task {
    const stove = STOVES.find((s) => s.idx === stoveIdx)!;
    yield { k: 'goto', tile: stove.stand, timeoutMs: 9000 };
    yield {
      k: 'useA',
      at: stove,
      done: (c) => c.me.held === null,
      timeoutMs: 5000,
    };
    bot.reserve = null;
  }

  /** Park whatever we are holding on a counter. */
  private *stashTask(bot: Bot, counter: Access): Task {
    yield { k: 'goto', tile: counter.stand, timeoutMs: 9000 };
    yield {
      k: 'useA',
      at: counter,
      done: (c) => c.me.held === null,
      timeoutMs: 4000,
    };
    bot.counterClaim = null;
    bot.stageTarget = null;
    bot.prepType = null;
  }

  /** Fetch a clean plate. */
  private *plateTask(): Task {
    yield { k: 'goto', tile: PLATES.stand, timeoutMs: 9000 };
    yield {
      k: 'useA',
      at: PLATES,
      done: (c) => c.me.held?.kind === 'plate',
      timeoutMs: 4000,
    };
  }

  /** Scoop a finished pot into the plate we are carrying. */
  private *fillPlateTask(bot: Bot, stoveIdx: number): Task {
    const stove = STOVES.find((s) => s.idx === stoveIdx)!;
    yield { k: 'goto', tile: stove.stand, timeoutMs: 9000 };
    yield {
      k: 'waitAt',
      at: stove,
      done: (c) => tileAt(c.snap, stove.idx)?.pot?.state === 'done',
      timeoutMs: 12000,
    };
    yield {
      k: 'useA',
      at: stove,
      done: (c) => c.me.held?.kind === 'plate' && c.me.held.soup !== null,
      timeoutMs: 5000,
    };
    bot.serveStove = null;
  }

  /** Run the soup to the window. */
  private *serveTask(bot: Bot): Task {
    yield { k: 'goto', tile: SERVE.stand, timeoutMs: 9000 };
    yield {
      k: 'useA',
      at: SERVE,
      done: (c) => c.me.held === null,
      timeoutMs: 5000,
    };
    bot.serveStove = null;
  }

  /** Empty a burnt pot. */
  private *dumpTask(stove: Access): Task {
    yield { k: 'goto', tile: stove.stand, timeoutMs: 9000 };
    yield {
      k: 'useA',
      at: stove,
      done: (c) => tileAt(c.snap, stove.idx)?.pot?.state === 'idle',
      timeoutMs: 5000,
    };
  }
}

/* ================================== CLI ================================== */

async function main(): Promise<void> {
  const port = Number(process.env.PORT) || LOCAL_PORT;
  const wsUrl = process.env.WS_URL ?? `ws://localhost:${port}${WS_PATH}`;
  const seconds = Number(process.env.SECONDS) || 45;

  const host = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    host.once('open', () => res());
    host.once('error', rej);
  });

  let room = '';
  let latest: Snapshot | null = null;
  let real: BotTeam | null = null;

  host.on('message', (raw) => {
    let msg: S2C;
    try {
      msg = JSON.parse(String(raw)) as S2C;
    } catch {
      return;
    }
    if (msg.t === 'room') room = msg.code;
    if (msg.t === 'state') {
      latest = msg.s;
      real?.feed(msg.s);
    }
  });

  host.send(JSON.stringify({ t: 'hello-host' } as C2S));
  const deadline = Date.now() + 10000;
  while (!room && Date.now() < deadline) await sleep(50);
  if (!room) throw new Error('no room code from the host socket');
  console.log(`room ${room}`);

  const team = new BotTeam({ wsUrl, room, log: (m) => console.log(`  ${m}`) });
  real = team;
  await team.connect();
  await sleep(400);
  team.startRound();

  const started = Date.now();
  let firstServeAt = 0;
  let secondServeAt = 0;
  const timer = setInterval(() => {
    const s = latest;
    if (!s) return;
    const t = (Date.now() - started) / 1000;
    if (s.served >= 1 && !firstServeAt) firstServeAt = t;
    if (s.served >= 2 && !secondServeAt) secondServeAt = t;
    console.log(
      `t=${t.toFixed(1)}s left=${(s.msLeft / 1000).toFixed(1)} score=${s.score} served=${s.served} ` +
        `missed=${s.missed} orders=${s.orders.map((o) => o.recipe.map((r) => r[0]).join('')).join('|')}\n` +
        `   ${team.debug(s)}`,
    );
  }, 2000);

  await sleep(seconds * 1000);
  clearInterval(timer);
  const final = latest as Snapshot | null;
  team.stop();
  host.close();
  console.log(
    `\nfinal: score=${final?.score ?? 0} served=${final?.served ?? 0} ` +
      `first serve @${firstServeAt.toFixed(1)}s, second @${secondServeAt.toFixed(1)}s`,
  );
  process.exit(final && final.served >= 2 ? 0 : 1);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

if (process.argv[1]?.includes('demo-bots')) {
  await main();
}
