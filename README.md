# Overcooked Party 🍲

A couch-party remake of Overcooked. Your laptop is the game screen — AirPlay
or screen-share it to the TV. Everyone else scans the QR code with their
phone and their phone becomes the gamepad (joystick + GRAB + CHOP/DASH).

## Play

```sh
npm install
npm run build && npm start
```

Open `http://localhost:3117` on the laptop and put that window on the TV.
Phones must be on the same Wi-Fi; they scan the QR on screen. Any chef
presses **Start**. Up to 8 players.

Chop ingredients on the boards (hold CHOP), drop 3 into a pot, plate the
soup when it dings, and run it to the serve window before the order ticket
expires. Don't let pots burn. 3 minutes per round.

## Develop

```sh
npm run dev        # game server :3117 + vite :5173 (LAN-exposed)
npm run typecheck
npx tsx scripts/smoke.ts   # E2E over real websockets (server must be running)
```

In dev, open `http://<your-lan-ip>:5173` so the QR code works for phones.
Add `?debug` to the host URL for tile coordinates.

## How it works

- `server/` — authoritative simulation at 30 Hz plus rooms over
  express + ws on port 3117 (override with `PORT`).
- `src/host/` — TV view: canvas kitchen, snapshot interpolation, lobby QR.
- `src/controller/` — phone gamepad: pointer-events joystick, haptics,
  wake lock, auto-reconnect.
- `shared/types.ts` + `shared/protocol.ts` — the frozen wire contract.
- `SPEC.md` — full game rules and the interaction table.
