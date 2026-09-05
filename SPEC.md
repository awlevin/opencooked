# Opencooked — Spec

An original couch-party co-op cooking game. One **host** page runs on a
laptop and is AirPlayed / screen-shared to a TV. **Phones** scan a QR code on
that screen, join over the LAN, and become gamepads (joystick + two buttons).
The Node server is the single authority for all game state.

## Architecture (Next.js + Vercel WebSockets)

```
phones (/join, components/controller/)   host laptop → TV (/, components/host/)
        │ ws: input/press/release               │ ws: state snapshots ~20 Hz
        └────────────► /api/ws  ◄───────────────┘
        Next.js on Vercel Fluid Compute (experimental_upgradeWebSocket)
        or the local custom server (server/local.ts) for LAN parties
   realtime/: rooms + authoritative sim @30 Hz + bus (memory | Redis)
```

- **Local/LAN**: `npm run dev` (or `build` + `start`) → `server/local.ts`,
  a custom Next server on :3000 that handles the `/api/ws` upgrade itself
  with `ws`. Single process, in-memory bus, zero external deps. Open
  `http://<lan-ip>:3000` on the laptop.
- **Vercel**: standard `next build`; `app/api/ws/route.ts` upgrades via
  `experimental_upgradeWebSocket` (`@vercel/functions`). Both entry points
  feed the same transport-agnostic room manager in `realtime/`.
- **Vercel realities the design must absorb**:
  - Function invocations cap at `maxDuration` (300 s) — every socket dies
    eventually. Clients auto-reconnect; the host sends
    `hello-host {resume:{room}}` to restore its room, controllers re-join
    with their seat `token`.
  - No instance affinity across connections. Room registry + roster +
    latest sim snapshot persist to Redis when `REDIS_URL` (or `KV_URL`)
    is set; the sim runs inside the host's connection, snapshots are
    checkpointed ~1/s, and a resumed host reconstructs the Game from the
    checkpoint (sim exposes restore-from-Snapshot). Controllers that land
    on a different instance than their room's host relay input/output over
    Redis pub/sub. Without Redis (local play), an in-memory bus/registry
    does the same job in one process.
- The join URL is built **client-side** on the host page:
  `${location.origin}/join?room=CODE` → rendered as the QR.
- Rooms: 4-letter codes (unambiguous alphabet, e.g. no O/0/I/1). A room
  with no live host survives a grace period (~2 min) for host reconnects,
  then dies. Multiple rooms may coexist.

## File ownership (for parallel agents — do not edit outside your set)

- **realtime agent**: `realtime/**`, `app/api/ws/route.ts`,
  `server/local.ts`, `game/game.ts`, `shared/levels.ts`, `scripts/smoke.ts`
- **host-ui agent**: `app/page.tsx`, `components/host/**`
- **controller-ui agent**: `app/join/page.tsx`, `components/controller/**`
- Frozen contract (read-only for everyone): `shared/types.ts`,
  `shared/protocol.ts`, `package.json`, `tsconfig.json`, `next.config.ts`,
  `app/layout.tsx`, `app/globals.css`
- Legacy Vite implementation kept temporarily as reference (port from it,
  never import it): `src/**`, `index.html`, `join.html`,
  `server/index.vite-reference.ts`

## Game rules (authoritative numbers live in `shared/types.ts`)

Kitchen is a tile grid (~13×8; level defined in `shared/levels.ts` by the
game-server agent — walkable floor in the middle, stations around the edges
and on a center island so players have to route around each other).

**Stations**: ingredient crates (onion/tomato/mushroom), cutting boards,
stoves with a pot on the ring, plate stack, serve window, trash, plain
counters (can hold one item), and one wall bracket holding the kitchen's
only fire extinguisher.

**Pots** are carryable. A pot lifted off a ring leaves a bare burner and
becomes a held item; it can be set on any stove ring or empty counter, and
it works the same wherever it is — ingredients go in, a plate scoops the
soup out. Only a pot **on a ring** cooks: off the heat every timer freezes
where it was. Boards, crates, the plate stack and the serve window all
refuse a pot.

**Flow**: grab raw ingredient from crate → chop on board (hold B, 1.5 s) →
drop 3 chopped ingredients into a pot → cooks 8 s → done (burns 10 s later
if ignored) → grab plate, use it on the done pot to fill → carry the soup
plate to the serve window.

**Orders**: queue of up to 5 recipes (each = multiset of 3 ingredients,
e.g. onion-onion-onion or onion-tomato-mushroom). First order at start, a
new one every 15 s. Each lives 60 s; expiry = −10 points and `missed`+1.
Serving a soup whose contents match a queued order (multiset equality,
earliest match wins): +20 points + time bonus (up to +10, scaled by the
matched order's remaining fraction), `served`+1. No matching order: plate
is consumed, 0 points.

**Round**: 180 s. Any controller can Start from the lobby (needs ≥1
player) and Play Again from gameover (returns everyone to the lobby).
Players may join mid-round and are spawned immediately.

**Movement**: joystick vector → velocity (3.6 tiles/s). Circle collision
(r=0.35) vs non-floor tiles and other players (push apart softly). Facing
= last nonzero input direction. The interaction target is the tile one
step in front of the player (round(pos + dir)).

**Button A (grab/put)** against the target tile:
| Holding | Target | Effect |
|---|---|---|
| nothing | crate | pick raw ingredient |
| nothing | counter/board with item | pick it up (aborts chop progress) |
| nothing | plates | pick empty plate |
| nothing | pot (ring or counter), burnt | dump the char → idle empty |
| nothing | pot (ring or counter), any other state | pick the pot up (a ring is left bare) |
| ingredient | empty counter/board | place it |
| chopped ingredient | pot not full, not done/burnt | add to pot (pot starts/keeps cooking; if it was `done` you can't add) |
| any item | trash | ingredient: discard; plate: empty its soup, keep plate; pot: tip it out, keep the pot; extinguisher: refused |
| empty plate | done pot (ring or counter) | fill plate with soup, pot → idle empty |
| pot | empty stove ring | set it down (timers resume) |
| pot | empty counter | set it down |
| pot (done) | counter holding an empty plate | pour the soup onto the plate, keep the pot |
| soup plate | serve | deliver (scoring above) |
| nothing | stocked extinguisher bracket | take the extinguisher |
| extinguisher | empty bracket / empty counter | put it down |

A burning tile refuses every A press. Put the fire out first.

**Button B**: holding the extinguisher → spray while held down (server sets
`spraying`); a burning tile in front takes `EXTINGUISH_MS` of foam and goes
out. Otherwise, facing a board holding an unchopped ingredient → chop while
held down (server sets `chopping`, accumulates `chopMs`). Otherwise → dash
(150 ms at 8 tiles/s, 500 ms cooldown). Two chefs working one board, or one
fire, is never a speedup.

**Fire**: a pot left `burnt` on a lit ring catches after `FIRE_MS`, and a
burning tile sets one random non-floor neighbour alight every
`FIRE_SPREAD_MS`. Igniting a tile ruins any food on it; pots and the
extinguisher survive (a pot goes `burnt`). Fire never spreads to the serve
window or the extinguisher bracket, and never goes out on its own — it is a
time sink, not a fail state, and the only answer is the extinguisher.

**Buzz**: send `{t:'buzz'}` to a controller on successful pickup/place/
serve/chop-complete/fire-out so phones vibrate.

## Quality bar

TypeScript strict, `npm run typecheck` clean. Host view must look
delicious at TV distance: chunky cartoon kitchen, big readable orders/score/
timer, smooth interpolated player motion. Controller must feel like a
gamepad: fullscreen, no scroll/zoom/text-selection, thumb-sized controls,
works in Safari iOS and Chrome Android.
