// Custom Next server for LAN parties.
//
// Next handles every HTTP route; this file owns exactly one thing Next cannot
// do on its own machine — the `/api/ws` upgrade — and hands the socket to the
// same room manager the Vercel route uses. One process, in-memory bus, no
// external services.
//
//   npm run dev    (NODE_ENV unset)        -> Next dev + HMR
//   npm start      (NODE_ENV=production)   -> serves .next/

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Duplex } from 'node:stream';

import next from 'next';
import { WebSocketServer } from 'ws';

import { LOCAL_PORT, WS_PATH } from '../shared/protocol';
import { MAX_PAYLOAD_BYTES, PING_MS } from '../realtime/config';
import { attachWebSocket } from '../realtime';
import { getManager } from '../realtime/manager';

const dev = process.env.NODE_ENV !== 'production';
/** LOCAL_PORT is the contract; PORT only exists so tests can take a spare. */
const port = Number(process.env.PORT) || LOCAL_PORT;

/** LAN address for the QR join URL: prefer en0, then any external IPv4. */
function lanIp(): string {
  const nets = networkInterfaces();
  const isV4 = (family: string): boolean => family === 'IPv4' || family === '4';

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

function pathOf(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  return q < 0 ? raw : raw.slice(0, q);
}

const app = next({ dev });
await app.prepare();
const handle = app.getRequestHandler();
// Only valid after prepare(); Next serves its own HMR socket through it.
const upgrade = app.getUpgradeHandler();

const server = createServer((req, res) => {
  void handle(req, res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
wss.on('connection', (ws) => attachWebSocket(ws));

server.on('upgrade', (req, socket: Duplex, head) => {
  const path = pathOf(req);
  if (path === WS_PATH) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    return;
  }
  // Next owns its own HMR socket in dev; everything else is not welcome.
  if (path.startsWith('/_next')) {
    void upgrade(req, socket, head);
    return;
  }
  socket.destroy();
});

// Drop sockets that stopped answering (phones that slept, laptops that closed).
const pingTimer = setInterval(() => {
  for (const ws of wss.clients) {
    const alive = (ws as { isAlive?: boolean }).isAlive;
    if (alive === false) {
      ws.terminate();
      continue;
    }
    (ws as { isAlive?: boolean }).isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, PING_MS);
pingTimer.unref();
wss.on('connection', (ws) => {
  (ws as { isAlive?: boolean }).isAlive = true;
  ws.on('pong', () => {
    (ws as { isAlive?: boolean }).isAlive = true;
  });
});

server.listen(port, () => {
  const url = `http://${lanIp()}:${port}`;
  console.log(`Overcooked Party on :${port} (${dev ? 'dev' : 'production'})`);
  console.log(`  host screen  ${url}`);
  console.log(`  phones       ${url}/join`);
});

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  clearInterval(pingTimer);
  getManager().stop();
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
