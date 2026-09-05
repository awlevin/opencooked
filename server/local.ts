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
import type { Duplex } from 'node:stream';

import next from 'next';
import { WebSocketServer } from 'ws';

import { LOCAL_PORT, WS_PATH } from '../shared/protocol';
import { MAX_PAYLOAD_BYTES, PING_MS } from '../realtime/config';
import { attachWebSocket, getManager } from '../realtime';
import { lanIp } from './lan';

const dev = process.env.NODE_ENV !== 'production';
/** LOCAL_PORT is the contract; PORT only exists so tests can take a spare. */
const port = Number(process.env.PORT) || LOCAL_PORT;

function pathOf(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  return q < 0 ? raw : raw.slice(0, q);
}

// On the first HTTP request, Next's custom-server wrapper quietly adds its own
// 'upgrade' listener to whatever server it can reach (`options.httpServer`, or
// `req.socket.server`). That listener answers /api/ws too, and ends the socket
// right after our handshake — the client sees a 1006 before the first frame.
// Handing Next a side server parks that listener off ours, and gives us a door
// to call it through on the upgrades it does own (see below).
//
// That listener is the only usable one: in a custom server
// `app.getUpgradeHandler()` resolves to NextNodeServer.handleUpgrade, which is
// an empty function. It answers nothing, and in Next 16 dev the initial RSC
// payload streams over the /_next/hmr socket — so an unanswered upgrade there
// leaves every page stuck on its SSR markup, hydrated by nothing.
const nextUpgrades = createServer();
const app = next({ dev, httpServer: nextUpgrades, port });
await app.prepare();
const handle = app.getRequestHandler();

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
  // Next owns its own sockets in dev — HMR, and with it the RSC stream the
  // page hydrates from. Its listener is on `nextUpgrades` by now: the page
  // load that hands the browser this URL goes through `handle` first.
  if (path.startsWith('/_next') && nextUpgrades.listenerCount('upgrade') > 0) {
    nextUpgrades.emit('upgrade', req, socket, head);
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
  console.log(`Opencooked on :${port} (${dev ? 'dev' : 'production'})`);
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
