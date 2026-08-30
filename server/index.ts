// Transport layer: express (static build in prod) + a single WebSocket
// endpoint that multiplexes rooms. All game logic lives in ./game.ts.

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

import { SERVER_PORT, WS_PATH } from '../shared/protocol';
import type { Btn, S2C } from '../shared/protocol';
import { MAX_PLAYERS, PLAYER_COLORS, SNAPSHOT_MS, TICK_MS } from '../shared/types';
import type { LobbyPlayer, Vec2 } from '../shared/types';
import { Game } from './game';

// --- config ----------------------------------------------------------------

/** No I/O/0/1 — codes get read off a TV and typed on a phone. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 4;
const MAX_NAME_LEN = 14;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_DT_MS = 250;
const PING_MS = 25_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
/** SERVER_PORT is the contract; PORT only exists so tests can use a spare one. */
const PORT = Number(process.env.PORT) || SERVER_PORT;

// --- room model ------------------------------------------------------------

interface Controller {
  ws: WebSocket;
  id: string;
  name: string;
  color: string;
}

interface Room {
  code: string;
  host: WebSocket;
  clientPort: number;
  game: Game;
  /** Keyed by playerId, insertion-ordered (join order). */
  controllers: Map<string, Controller>;
  loop: NodeJS.Timeout | null;
  lastTickAt: number;
  snapAccumMs: number;
}

type SocketMeta =
  | { role: 'none' }
  | { role: 'host'; code: string }
  | { role: 'controller'; code: string; playerId: string };

const rooms = new Map<string, Room>();
const metas = new Map<WebSocket, SocketMeta>();
const alive = new WeakMap<WebSocket, boolean>();
let nextPlayerSeq = 1;

// --- helpers ---------------------------------------------------------------

function send(ws: WebSocket, msg: S2C): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    console.error('[ws] send failed:', err);
  }
}

function broadcast(room: Room, msg: S2C): void {
  send(room.host, msg);
  for (const c of room.controllers.values()) send(c.ws, msg);
}

function roster(room: Room): LobbyPlayer[] {
  return [...room.controllers.values()].map((c) => ({ id: c.id, name: c.name, color: c.color }));
}

function broadcastLobby(room: Room): void {
  broadcast(room, { t: 'lobby', players: roster(room) });
}

function makeCode(): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LEN; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('could not allocate a room code');
}

/** LAN address for the QR join URL: prefer en0, then any external IPv4. */
function lanIp(): string {
  const nets = networkInterfaces();
  const isV4 = (family: string) => family === 'IPv4' || family === '4';

  for (const addr of nets['en0'] ?? []) {
    if (isV4(String(addr.family)) && !addr.internal) return addr.address;
  }
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (isV4(String(addr.family)) && !addr.internal) return addr.address;
    }
  }
  return 'localhost';
}

function nextColor(room: Room): string {
  const used = new Set([...room.controllers.values()].map((c) => c.color));
  for (const color of PLAYER_COLORS) if (!used.has(color)) return color;
  return PLAYER_COLORS[room.controllers.size % PLAYER_COLORS.length];
}

// --- validation ------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asVec2(v: unknown): Vec2 | null {
  const o = asRecord(v);
  if (!o) return null;
  const { x, y } = o;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function asBtn(v: unknown): Btn | null {
  return v === 'a' || v === 'b' ? v : null;
}

function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // Strip control characters; phones can send anything.
  const name = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LEN);
  return name.length > 0 ? name : fallback;
}

// --- room lifecycle --------------------------------------------------------

function startLoop(room: Room): void {
  stopLoop(room);
  room.lastTickAt = Date.now();
  room.snapAccumMs = SNAPSHOT_MS; // send one snapshot right away
  room.loop = setInterval(() => {
    try {
      step(room);
    } catch (err) {
      console.error(`[room ${room.code}] tick failed:`, err);
    }
  }, TICK_MS);
}

function stopLoop(room: Room): void {
  if (room.loop === null) return;
  clearInterval(room.loop);
  room.loop = null;
}

function step(room: Room): void {
  const now = Date.now();
  const dt = Math.min(now - room.lastTickAt, MAX_DT_MS);
  room.lastTickAt = now;

  const events = room.game.tick(dt);
  for (const ev of events) {
    const c = room.controllers.get(ev.playerId);
    if (c) send(c.ws, { t: 'buzz', ms: ev.buzzMs });
  }

  const over = room.game.phase === 'gameover';
  room.snapAccumMs += dt;
  if (over || room.snapAccumMs >= SNAPSHOT_MS) {
    room.snapAccumMs = 0;
    send(room.host, { t: 'state', s: room.game.snapshot });
  }

  if (over) {
    stopLoop(room);
    const s = room.game.snapshot;
    broadcast(room, { t: 'phase', phase: 'gameover' });
    broadcast(room, { t: 'gameover', score: s.score, served: s.served, missed: s.missed });
  }
}

function destroyRoom(room: Room, reason: string): void {
  stopLoop(room);
  rooms.delete(room.code);
  for (const c of room.controllers.values()) {
    send(c.ws, { t: 'err', msg: reason });
    metas.set(c.ws, { role: 'none' });
    try {
      c.ws.close();
    } catch {
      /* already gone */
    }
  }
  room.controllers.clear();
  metas.set(room.host, { role: 'none' });
  console.log(`[room ${room.code}] destroyed (${reason})`);
}

// --- message handling ------------------------------------------------------

function roomOf(ws: WebSocket): Room | null {
  const meta = metas.get(ws);
  if (!meta || meta.role === 'none') return null;
  return rooms.get(meta.code) ?? null;
}

function handleHelloHost(ws: WebSocket, msg: Record<string, unknown>): void {
  if (metas.get(ws)?.role !== 'none') {
    send(ws, { t: 'err', msg: 'This connection already has a role.' });
    return;
  }
  const rawPort = msg.clientPort;
  const clientPort =
    typeof rawPort === 'number' && Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536
      ? rawPort
      : SERVER_PORT;

  const code = makeCode();
  const room: Room = {
    code,
    host: ws,
    clientPort,
    game: new Game(),
    controllers: new Map(),
    loop: null,
    lastTickAt: Date.now(),
    snapAccumMs: 0,
  };
  rooms.set(code, room);
  metas.set(ws, { role: 'host', code });

  const joinUrl = `http://${lanIp()}:${clientPort}/join.html?room=${code}`;
  send(ws, { t: 'room', code, joinUrl });
  send(ws, { t: 'phase', phase: room.game.phase });
  broadcastLobby(room);
  console.log(`[room ${code}] created, join at ${joinUrl}`);
}

function handleJoin(ws: WebSocket, msg: Record<string, unknown>): void {
  if (metas.get(ws)?.role !== 'none') {
    send(ws, { t: 'err', msg: 'This connection already has a role.' });
    return;
  }
  const rawRoom = msg.room;
  const code = typeof rawRoom === 'string' ? rawRoom.trim().toUpperCase() : '';
  const room = rooms.get(code);
  if (!room) {
    send(ws, { t: 'err', msg: `No kitchen with code ${code || '????'}.` });
    return;
  }
  if (room.controllers.size >= MAX_PLAYERS) {
    send(ws, { t: 'err', msg: 'That kitchen is full.' });
    return;
  }

  const id = `p${nextPlayerSeq++}`;
  const name = cleanName(msg.name, `Chef ${room.controllers.size + 1}`);
  const color = nextColor(room);
  room.controllers.set(id, { ws, id, name, color });
  metas.set(ws, { role: 'controller', code: room.code, playerId: id });
  room.game.addPlayer(id, name, color);

  send(ws, { t: 'joined', playerId: id, color, name });
  send(ws, { t: 'phase', phase: room.game.phase });
  broadcastLobby(room);
  console.log(`[room ${room.code}] ${name} (${id}) joined — ${room.controllers.size} player(s)`);
}

function handleStart(ws: WebSocket): void {
  const room = roomOf(ws);
  if (!room) return;
  if (room.game.phase !== 'lobby') return;
  if (room.controllers.size < 1) {
    send(ws, { t: 'err', msg: 'Need at least one chef.' });
    return;
  }
  room.game.start();
  broadcast(room, { t: 'phase', phase: 'playing' });
  startLoop(room);
  console.log(`[room ${room.code}] round started with ${room.controllers.size} player(s)`);
}

function handleAgain(ws: WebSocket): void {
  const room = roomOf(ws);
  if (!room) return;
  if (room.game.phase !== 'gameover') return;
  stopLoop(room);
  room.game.toLobby();
  broadcast(room, { t: 'phase', phase: 'lobby' });
  broadcastLobby(room);
}

function handleMessage(ws: WebSocket, raw: string): void {
  const parsed: unknown = JSON.parse(raw);
  const msg = asRecord(parsed);
  if (!msg || typeof msg.t !== 'string') return;

  switch (msg.t) {
    case 'hello-host':
      handleHelloHost(ws, msg);
      return;

    case 'join':
      handleJoin(ws, msg);
      return;

    case 'start':
      handleStart(ws);
      return;

    case 'again':
      handleAgain(ws);
      return;

    case 'input': {
      const meta = metas.get(ws);
      if (meta?.role !== 'controller') return;
      const move = asVec2(msg.move);
      if (!move) return;
      rooms.get(meta.code)?.game.setMove(meta.playerId, move);
      return;
    }

    case 'press':
    case 'release': {
      const meta = metas.get(ws);
      if (meta?.role !== 'controller') return;
      const btn = asBtn(msg.btn);
      if (!btn) return;
      const game = rooms.get(meta.code)?.game;
      if (!game) return;
      if (msg.t === 'press') game.press(meta.playerId, btn);
      else game.release(meta.playerId, btn);
      return;
    }

    default:
      return; // unknown message: ignore
  }
}

function handleClose(ws: WebSocket): void {
  const meta = metas.get(ws);
  metas.delete(ws);
  if (!meta || meta.role === 'none') return;

  const room = rooms.get(meta.code);
  if (!room) return;

  if (meta.role === 'host') {
    destroyRoom(room, 'The host screen disconnected.');
    return;
  }

  const c = room.controllers.get(meta.playerId);
  room.controllers.delete(meta.playerId);
  room.game.removePlayer(meta.playerId);
  broadcastLobby(room);
  console.log(
    `[room ${room.code}] ${c?.name ?? meta.playerId} left — ${room.controllers.size} player(s)`,
  );
}

// --- wiring ----------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

if (isProd) {
  const dist = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(dist, { index: 'index.html' }));
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: MAX_PAYLOAD_BYTES });

wss.on('connection', (ws) => {
  metas.set(ws, { role: 'none' });
  alive.set(ws, true);

  ws.on('pong', () => alive.set(ws, true));

  ws.on('message', (data) => {
    try {
      handleMessage(ws, typeof data === 'string' ? data : data.toString());
    } catch (err) {
      console.error('[ws] bad message dropped:', err);
      send(ws, { t: 'err', msg: 'Malformed message.' });
    }
  });

  ws.on('error', (err) => console.error('[ws] socket error:', err));

  ws.on('close', () => {
    try {
      handleClose(ws);
    } catch (err) {
      console.error('[ws] close handling failed:', err);
    }
  });
});

// Drop sockets that stopped answering (phones that slept, laptops that closed).
const pingTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, PING_MS);
wss.on('close', () => clearInterval(pingTimer));

server.listen(PORT, () => {
  const url = `http://${lanIp()}:${isProd ? PORT : 5173}`;
  console.log(`Overcooked Party server on :${PORT}${WS_PATH} (${isProd ? 'prod' : 'dev'})`);
  console.log(`Open the host page at ${url}`);
});

process.on('SIGINT', () => {
  clearInterval(pingTimer);
  for (const room of [...rooms.values()]) stopLoop(room);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
