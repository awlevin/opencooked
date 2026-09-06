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
  `server/local.ts`, `game/game.ts`, `shared/levels/**`, `scripts/smoke.ts`
- **host-ui agent**: `app/page.tsx`, `components/host/**`
- **controller-ui agent**: `app/join/page.tsx`, `components/controller/**`
- Frozen contract (read-only for everyone): `shared/types.ts`,
  `shared/catalogue.ts`, `shared/protocol.ts`, `package.json`,
  `tsconfig.json`, `next.config.ts`,
  `app/layout.tsx`, `app/globals.css`
- Legacy Vite implementation kept temporarily as reference (port from it,
  never import it): `src/**`, `index.html`, `join.html`,
  `server/index.vite-reference.ts`

## Game rules (authoritative numbers live in `shared/types.ts`)

Kitchen is a tile grid (11×7 to 15×8 depending on the level; see **Worlds
and levels** below) — walkable floor in the middle, stations around the edges
and on islands or dividing walls so players have to route around each other.

**Stations**: ingredient crates (one raw ingredient each), cutting boards,
stoves holding a pot or a frying pan, plate stack, serve window, trash,
plain counters (can hold one item), and one wall bracket holding the
kitchen's only fire extinguisher.

### Ingredients and dishes (`shared/catalogue.ts`)

Food is data. An ingredient declares its own preparation, and nothing else
in the codebase hard-codes a recipe:

| Ingredient | Chop | Cook | Batch |
|---|---|---|---|
| onion, tomato, mushroom | yes | boil | 3 |
| lettuce, cheese, fish | yes | — | — |
| bun, seaweed (nori) | — | — | — |
| meat (patty) | yes | fry | 1 |
| rice | — | boil | 1 |

A part is **ready** when it has had every preparation its definition asks
for: `(!chop || chopped) && (!cook || cooked)`. There are no per-dish
overrides — a dish that wants raw tomato has to use a different vegetable.

A **dish** is a name and a multiset of parts. The book holds the ten
three-vegetable soups (Onion Soup … Garden Soup), Side Salad
[lettuce, cheese], Burger [bun, meat], Cheeseburger, Salad Burger, Deluxe
Burger [bun, meat, cheese, lettuce], Nigiri [rice, fish], Maki Roll
[rice, fish, seaweed] and Veggie Roll [rice, seaweed, lettuce].

A level declares a **menu** — the dishes its orders are drawn from. A Game
whose menu the level cannot cook (missing crate, board, pot or pan) throws
at construction rather than issuing a ticket nobody can fill.

**Vessels**: a pot boils, a pan fries. Both are carryable, and both behave
identically to a player — things go in, a plate takes what comes out. A pot
holds **one batch of one batch size**: three vegetables, or one portion of
rice, and never a mix of the two. A pan holds one patty. Cooking starts
when the vessel is full and is what marks the contents `cooked`; a pot
takes 8 s, a pan 5 s, and either burns 10 s later if ignored. Only a vessel
**on a ring** cooks: off the heat every timer freezes where it was. Boards,
crates, the plate stack and the serve window all refuse cookware.

**Plating rule** — one rule, every path: a part may join a plate when it is
ready *and* the plate's contents plus that part are still a sub-multiset of
some dish on the menu. That is what lets a cheeseburger be assembled in any
order, stops a second bun, refuses a raw patty, and refuses cheese on a menu
with no cheese in it. Tipping a vessel onto a plate is all-or-nothing.

**Flow**: grab raw ingredient from crate → chop on board (hold B, 1.5 s) →
into a pot or pan if it cooks → assemble the parts on a plate, in any order,
on any counter → carry the plate to the serve window.

**Orders**: queue of up to 5 tickets (`maxOrders`), each a dish drawn at
random from the level's menu. First order at start, a new one every 15 s
(`orderSpawnMs`). Each lives 60 s (`orderMs`);
expiry = −10 points and `missed`+1. Serving a plate whose parts match a
queued order (multiset equality, earliest match wins): +20 points + time
bonus (up to +10, scaled by the matched order's remaining fraction),
`served`+1. No matching order: plate is consumed, 0 points. That same
fraction sets the serve's **tier** — `perfect` ≥ 0.66, `great` ≥ 0.33,
`good` below — which is what the celebration is scaled by (see **Quality
bar**).

**Round**: 180 s (`roundMs`). Any controller can Start from the lobby (needs
≥1 player), pick the level from the lobby, and from gameover either Play Again
or move the room to the next level. Players may join mid-round and are spawned
immediately. Every number in brackets above is a per-level override; the
constants in `shared/types.ts` are only the defaults.

**Pause**: `pause` / `resume` from any seated controller, `phase === 'playing'`
only — the host screen has no seat and cannot stop the round. While
`Snapshot.paused` is non-null every clock in the kitchen freezes (round timer,
order timers, cooking, burning, the fire clock, chopping, spraying, movement
and dashes) and queued button edges are drained each tick, so nothing fires
when play starts again. `paused` carries `{by, name, color, sinceMs}`: the name
and colour are copies, so the TV can still say who did it after that chef's
phone has gone to sleep, and `sinceMs` is the only clock still running. Any
chef may resume, including one who did not pause — a dead phone must not hold
the table hostage — and the pauser disconnecting does not resume on its own.
The state rides in the snapshot, so it survives a checkpoint and a host
resume; phones never see snapshots, so each transition also broadcasts
`{t:'paused', by}` (`by: null` = running), and a phone that joins mid-pause is
sent it on join.

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
| nothing | vessel (ring or counter), burnt | dump the char → idle empty |
| nothing | vessel (ring or counter), any other state | pick it up (a ring is left bare) |
| ingredient | empty counter/board | place it |
| prepared ingredient | vessel that accepts it, not full, not done/burnt | add to it (it starts/keeps cooking; if it was `done` you can't add) |
| ready ingredient | counter/board holding a plate | add it to the plate (plating rule) |
| plate | counter/board holding a ready ingredient | take it onto the plate (plating rule) |
| any item | trash | ingredient: discard; plate: empty it, keep the plate; vessel: tip it out, keep the vessel; extinguisher: refused |
| plate | done vessel (ring or counter) | tip the whole batch onto the plate, vessel → idle empty |
| vessel | empty stove ring | set it down (timers resume) |
| vessel | empty counter | set it down |
| vessel (done) | counter holding a plate | tip the batch onto the plate, keep the vessel |
| loaded plate | serve | deliver (scoring above) |
| nothing | stocked extinguisher bracket | take the extinguisher |
| extinguisher | empty bracket / empty counter | put it down |

Every plate-filling row above goes through the one plating rule, so a part
that no menu dish still wants is simply refused.

A burning tile refuses every A press. Put the fire out first.

**Button B**: holding the extinguisher → spray while held down (server sets
`spraying`); a burning tile in front takes `EXTINGUISH_MS` of foam and goes
out. Otherwise, facing a board holding an unchopped ingredient → chop while
held down (server sets `chopping`, accumulates `chopMs`). Otherwise → dash
(150 ms at 8 tiles/s, 500 ms cooldown). Two chefs working one board, or one
fire, is never a speedup.

### Worlds and levels (`shared/levels/`)

A **level** is data: an id, a name, an ASCII map, a menu of DishIds and
optional tuning (`roundMs`, `orderMs`, `orderSpawnMs`, `maxOrders`). A
**world** is a file under `shared/levels/worlds/` holding a name, a tagline, a
`WorldTheme` (palette + motif id) and its levels in playing order.
`shared/levels/index.ts` exports `WORLDS`, `LEVELS`, `levelById`,
`nextLevelId` and `DEFAULT_LEVEL_ID`, and is the only place that enumerates
levels.

**Level ASCII**: `.` floor, `@` floor + player spawn, `#` counter, `B` board,
`S` stove with a pot, `F` stove with a frying pan, `P` plate stack,
`W` serve window, `X` trash, `E` extinguisher mount. Crates: `O` onion,
`T` tomato, `M` mushroom, `L` lettuce, `C` cheese, `U` bun, `R` raw meat,
`I` rice, `H` fish, `V` seaweed.

`parseLevel` refuses anything unplayable, at import time: ragged rows, unknown
glyphs, fewer than 6 spawns, a spawn or a station cut off from the room (flood
fill over floor), a missing plate stack / serve window / trash / extinguisher,
non-positive tuning, or a menu the kitchen cannot cook (`assertMenuMakeable`).

| World | Level | Menu | Layout | Tuning |
|---|---|---|---|---|
| Home Kitchen | 1 Mise en place | Onion Soup | 11×7 open room, 2 pots, 2 boards | defaults |
| | 2 Dinner rush | 3 single-veg soups + Garden Soup | centre island holding the plates | order every 14 s |
| | 3 Family reunion | those soups + Burger, Cheeseburger | the starter kitchen: 2 pots, 1 pan, 6 crates | defaults |
| Boardwalk Grill | 1 Flat top | Burger | 2 pans, plates on a small island | defaults |
| | 2 Cheese please | Burger, Cheeseburger, Side Salad | every crate on the south wall, every pan on the north | ticket 55 s, every 14 s |
| | 3 Boardwalk deluxe | Cheeseburger, Salad Burger, Deluxe Burger | split kitchen: one gap, one board *in* the wall | ticket 45 s, every 12 s, 4 max |
| Night Sushi Bar | 1 Rice & fish | Nigiri | 3 rice pots, 2 boards on an island | defaults |
| | 2 Rolling | Nigiri, Maki Roll | nori and plates behind a counter wall | ticket 55 s, every 13 s |
| | 3 Omakase | Nigiri, Maki Roll, Veggie Roll | 6 pots, 4 crates walled into the island, extinguisher across the room | ticket 45 s, every 11 s, 4 max |

**Choosing a level**: `select {levelId}` from any controller, lobby only;
`again {levelId?}` is Play Again with a destination (the phone's "Next
level"). The `lobby` broadcast carries the chosen `levelId`, and the room
record keeps it, so the choice survives a host reconnect. Every snapshot
carries `levelId` and `worldId`: the host renderer resolves the world's theme
from it once per frame, and a resumed host rebuilds the Game on the level the
round is actually being played on.

**Fire**: a vessel left `burnt` on a lit ring catches after `FIRE_MS`, and a
burning tile sets one random non-floor neighbour alight every
`FIRE_SPREAD_MS`. Igniting a tile ruins any food on it; cookware and the
extinguisher survive (a vessel goes `burnt`). Fire never spreads to the serve
window or the extinguisher bracket, and never goes out on its own — it is a
time sink, not a fail state, and the only answer is the extinguisher.

**Buzz**: send `{t:'buzz'}` to a controller on successful pickup/place/
serve/chop-complete/fire-out so phones vibrate. `ms` may be an array, which is
a `navigator.vibrate` pattern: a served dish is felt as one pulse, two or
three, by tier.

## Quality bar

**Serving a dish is the payoff, so it is celebrated in proportion.** The sim
appends an `FxEvent` to `Snapshot.fx` — a ring buffer of at most 8, pruned
after 4 s — carrying the serve window's tile, the chef, the points, the tier
and the ticket's slot on the rail. `Snapshot.elapsedMs` is the clock the
renderer measures those events against. A `good` serve gets a `+N` popup in
the chef's colour and a small puff of sparkles; `great` adds the word, a ring
out of the window, more sparkles and a squash-and-stretch on the HUD score;
`perfect` adds confetti in the chef's colour, a starburst, a warm flash, a
600 ms halo on the chef and one turn of the HUD star. Three perfects in a row
say `ON FIRE!` instead of `PERFECT!` — text only, because the screen is
already busy. Every effect is drawn purely from the event's id (which seeds
its jitter) and its age, so `components/host/render/fx.ts` holds no state,
allocates nothing per frame, and plays the same celebration on a TV that only
just connected. Nothing but the departing ticket may draw on the order rail.

TypeScript strict, `npm run typecheck` clean. Host view must look
delicious at TV distance: chunky cartoon kitchen, big readable orders/score/
timer, smooth interpolated player motion. Controller must feel like a
gamepad: fullscreen, no scroll/zoom/text-selection, thumb-sized controls,
works in Safari iOS and Chrome Android.
