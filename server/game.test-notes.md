# Deliberate deviations from SPEC.md

Everything else follows §Game rules and the Button A table exactly. These six
points either fill a gap in the spec or fix a soft-lock.

## 1. A plate may be put down on an empty plain counter

The table lists only `ingredient | empty counter/board | place it`. Taken
literally, a plate can never leave a player's hands: the trash row says
`plate: empty its soup, keep plate`, and the serve window only accepts a
soup plate. A chef who grabs a plate too early would be stuck holding it for
the rest of the round, and eight chefs holding plates would dead-lock the
kitchen.

`server/game.ts` therefore accepts **any** held item on an empty plain
counter. Cutting boards still accept ingredients only — a plate is not
choppable, and this keeps boards free for the chop queue. Picking an item
back up is unchanged and already handles plates (`nothing | counter/board
with item | pick it up`).

## 2. A pot only counts down once it is full

`shared/types.ts` says `COOK_MS = 8000; // full pot -> done`, but the table
says adding an ingredient makes the pot "start/keep cooking". Both are
honoured: `Pot.state` becomes `'cooking'` on the first chopped ingredient
(so the host can render an active pot), while `Pot.cookMs` only advances
when `contents.length === POT_CAPACITY`. The 8 s therefore always measures
from the moment the third ingredient goes in. On the `done` transition
`cookMs` resets to 0 and is reused as the burn clock, per the `Pot.cookMs`
comment ("elapsed cooking (or burning) time").

## 3. Two chefs on one board do not chop twice as fast

Both players get `chopping: true` and both feel the completion buzz, but
`chopMs` advances once per board per tick. Co-chopping as a 2x speed-up is
not in the spec and would trivialise the round.

## 4. Serving a soup with no matching order still buzzes

The spec asks for a buzz on "successful pickup/place/serve/chop-complete".
An unmatched serve still consumes the plate, so the phone buzzes to confirm
the input landed. Score is unchanged (0 points), as specified.

## 5. Trashing an already-empty plate is a no-op

`any item | trash` with a clean plate has nothing to discard (the plate is
kept either way), so the action is ignored and no buzz is sent.

## 6. `PORT` environment override

`server/index.ts` listens on `Number(process.env.PORT) || SERVER_PORT`. The
default is still the contract value 3117; the override exists only so a test
harness can run against a spare port while another process holds 3117.
