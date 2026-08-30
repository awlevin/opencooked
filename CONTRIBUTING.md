# Contributing

Thanks for looking. This is a small project — issues and pull requests are
both welcome.

## Setup

```sh
npm install
npm run dev        # custom Next server on :3000, HMR + websockets
```

Open `http://localhost:3000` for the host screen and
`http://localhost:3000/join` for a controller. A second browser window works
fine as a second player; a real phone on the same Wi-Fi is better. Add
`?debug` to the host URL for tile coordinates.

Before you push:

```sh
npm run typecheck  # tsc --noEmit, strict — must be clean
npm run build
```

## The bar for realtime changes

`npm run smoke` is the end-to-end test. It drives a running server over real
WebSockets and checks the whole loop: lobby, join errors, malformed payloads,
start, snapshots, movement, orders, controller seat reclaim, and host resume.

**Any change under `realtime/`, `server/`, `app/api/ws/`, `game/`, or
`shared/` must keep it green.**

```sh
npm run dev              # one shell
npm run smoke            # another
```

If you touch reconnect, ownership, or anything that persists state, also run
the multi-instance path — two processes, one Redis. Use `npm start`, not
`npm run dev`: Next allows only one dev server per project.

```sh
docker run -d --rm -p 6379:6379 redis:7-alpine
npm run build

export REDIS_URL=redis://localhost:6379
PORT=3131 npm start &
PORT=3132 npm start &

PORT=3131 CROSS_PORTS=3131,3132 npm run smoke
```

That covers the bus relay and the ownership handover a Vercel host reconnect
causes. CI runs the single-process path only, so run this one yourself.

## SPEC.md is the rules contract

[SPEC.md](SPEC.md) holds the game rules: the interaction table, timings,
scoring, movement, and the round loop. The simulation in `game/game.ts` must
agree with it.

If you change behaviour, change SPEC.md in the same pull request. If the code
and the spec disagree, that is a bug — say which one you think is wrong.

## The wire contract is frozen

`shared/protocol.ts` and `shared/types.ts` define every message and every
shape that crosses the socket. Treat them as an API, not as scratch space.

Changing them means updating **all three layers** in the same pull request:

1. **the server** — `realtime/` (and `game/` if the snapshot shape moves),
2. **the host view** — `components/host/`,
3. **the controller** — `components/controller/`.

Then re-run the smoke test, which type-checks itself against the same
protocol. Old clients reconnect to new servers all the time during a party, so
prefer additive changes over renames.

## Style

- TypeScript strict. No `any` you cannot justify.
- Comments explain *why*, not *what*.
- Keep `game/` pure — no I/O, no timers, no sockets. It is the only part that
  is easy to reason about, and it should stay that way.
