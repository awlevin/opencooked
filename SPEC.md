# Overcooked Party — Spec

A couch-party remake of Overcooked. One **host** page runs on a laptop and is
AirPlayed / screen-shared to a TV. **Phones** scan a QR code on that screen,
join over the LAN, and become gamepads (joystick + two buttons). The Node
server is the single authority for all game state.

## Architecture

```
phones (join.html, src/controller/)      host laptop (index.html, src/host/)
        │  ws: input/press/release              │  ws: state snapshots ~20 Hz
        └───────────────► Node server ◄─────────┘
                    (express + ws, port 3117)
                 authoritative sim @ 30 Hz, rooms
```

- **Dev**: `npm run dev` → tsx server on :3117 + vite on :5173 (LAN-exposed,
  proxies `/ws` → :3117). Open `http://<lan-ip>:5173` on the laptop.
- **Prod**: `npm run build && npm start` → express serves `dist/` and `/ws`
  on :3117.
- The host page sends `hello-host` with its own `location.port`; the server
  answers with a `joinUrl` built from its LAN IP + that port
  (`http://<lan-ip>:<port>/join.html?room=CODE`). The host renders that URL
  as a QR code.
- Rooms: 4-letter codes (unambiguous alphabet, e.g. no O/0/I/1). A room dies
  when its host socket closes. Multiple rooms may coexist.

## File ownership (for parallel agents — do not edit outside your set)

- **game-server agent**: `server/index.ts`, `server/game.ts` (+ any extra
  `server/*.ts`), `shared/levels.ts`
- **host-ui agent**: `index.html`, `src/host/**`
- **controller-ui agent**: `join.html`, `src/controller/**`
- Frozen contract (read-only for everyone): `shared/types.ts`,
  `shared/protocol.ts`, `package.json`, `vite.config.ts`, `tsconfig.json`

## Game rules (authoritative numbers live in `shared/types.ts`)

Kitchen is a tile grid (~13×8; level defined in `shared/levels.ts` by the
game-server agent — walkable floor in the middle, stations around the edges
and on a center island so players have to route around each other).

**Stations**: ingredient crates (onion/tomato/mushroom), cutting boards,
stoves with fixed pots, plate stack, serve window, trash, plain counters
(can hold one item).

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
| nothing | stove w/ burnt pot | dump pot → idle empty |
| ingredient | empty counter/board | place it |
| chopped ingredient | stove, pot not full, not done/burnt | add to pot (pot starts/keeps cooking; if it was `done` you can't add) |
| any item | trash | ingredient: discard; plate: empty its soup, keep plate |
| empty plate | stove w/ done pot | fill plate with soup, pot → idle empty |
| soup plate | serve | deliver (scoring above) |

**Button B**: facing a board holding an unchopped ingredient → chop while
held down (server sets `chopping`, accumulates `chopMs`). Otherwise → dash
(150 ms at 8 tiles/s, 500 ms cooldown).

**Buzz**: send `{t:'buzz'}` to a controller on successful pickup/place/
serve/chop-complete so phones vibrate.

## Quality bar

TypeScript strict, `npm run typecheck` clean. Host view must look
delicious at TV distance: chunky cartoon kitchen, big readable orders/score/
timer, smooth interpolated player motion. Controller must feel like a
gamepad: fullscreen, no scroll/zoom/text-selection, thumb-sized controls,
works in Safari iOS and Chrome Android.
