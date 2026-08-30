# Overcooked Party 🍲

A couch-party remake of Overcooked, built as a Next.js app with native
WebSockets on Vercel. Your laptop opens the game screen — AirPlay or
screen-share it to the TV. Everyone else scans the QR code and their phone
becomes the gamepad (joystick + GRAB + CHOP/DASH).

## Play

**On Vercel** (works anywhere, phones just need internet): deploy, open the
deployment URL on the laptop, put it on the TV. Done.

**On your LAN** (offline, lowest latency):

```sh
npm install
npm run build && npm start   # custom server on :3000 (PORT to override)
```

Open the printed `http://<lan-ip>:3000` on the laptop; phones on the same
Wi-Fi scan the QR. Any chef presses **Start**. Up to 8 players.

Chop ingredients on the boards (hold CHOP), drop 3 into a pot, plate the
soup when it dings, and run it to the serve window before the order ticket
expires. Don't let pots burn. 3 minutes per round.

## Develop

```sh
npm run dev        # custom Next dev server on :3000 (HMR + websockets)
npm run typecheck
npm run smoke      # E2E over real websockets against a running server
                   # (PORT=… or WS_URL=wss://…/api/ws to point elsewhere)
```

Add `?debug` to the host URL for tile coordinates.

## How it works

- `app/api/ws/route.ts` — WebSocket upgrade on Vercel Fluid Compute via
  `experimental_upgradeWebSocket` (`@vercel/functions`).
- `server/local.ts` — custom Next server for LAN parties; same room
  manager, `ws` handles the upgrade, single process, no external deps.
- `realtime/` — transport-agnostic rooms + authoritative 30 Hz sim that
  runs inside the host's connection. Built for Vercel's rules: connections
  die at `maxDuration` and reconnects may land on other instances, so the
  host resumes its room (`hello-host {resume}`), controllers reclaim seats
  with tokens, snapshots checkpoint ~1/s, and an ownership lease prevents
  two instances from ticking one kitchen. State/bus live in memory locally
  and in Redis (`REDIS_URL` or `KV_URL`, e.g. Upstash from the Vercel
  Marketplace) for multi-instance correctness in production.
- `game/game.ts` + `shared/levels.ts` — the pure simulation.
- `components/host/` — TV view: canvas kitchen, snapshot interpolation,
  QR lobby. `components/controller/` — phone gamepad: pointer-events
  joystick, haptics, wake lock, auto-reconnect.
- `shared/types.ts` + `shared/protocol.ts` — the frozen wire contract.
- `SPEC.md` — full game rules and the interaction table.
