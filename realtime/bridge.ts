// The tunnel between a host tab that owns a room's sim and the server that
// keeps the registry.
//
// `shared/protocol.ts` carries this as `{ t: 'bus', env }` in both directions
// and deliberately says nothing about `env`: the server must be able to relay
// a host tab's traffic without understanding a word of it. This file is what
// `env` actually is.
//
// The idea is one sentence long: **a host tab is just another instance.** It
// runs the same `RoomManager`, the same `Room`, over an in-memory store and
// bus — and this tunnel splices that private bus onto the real one, so a
// controller relayed through Vercel reaches the tab through the exact
// `RemoteAttachment` path that already handles a room owned somewhere else.
//
//   server                                     host tab
//   ------                                     --------
//   room:<code>:in        --- pub  --->        (memory bus) room:<code>:in
//   room:<code>:out:<a>   <--- pub ---         (memory bus) room:<code>:out:<a>
//   room:<code>:all       <--- pub ---         (memory bus) room:<code>:all
//   store.putRoom         <--- room ---        registry write-through
//   store.putSnapshot     <--- snap ---        checkpoint write-through
//
// The write-throughs are what make the tab disposable: the server's copy of
// the record and the last snapshot is always at most a checkpoint old, so if
// the tab dies the server resumes the round from it.

import type { RoomRecord } from './store';
import type { Snapshot } from '../shared/types';
import { allChannel, inChannel, outChannel } from './store';

export type BusEnv =
  /** Replay `p` on bus channel `ch`. Both directions; `ch` is always checked. */
  | { k: 'pub'; ch: string; p: unknown }
  /**
   * Server -> host tab, once, in answer to `claim-sim`: everything needed to
   * stand the room up in the tab exactly as it was — seats with their tokens
   * (so every phone reclaims its own chef) and the round in progress, if any.
   */
  | { k: 'seed'; rec: RoomRecord; snap: Snapshot | null }
  /** Host tab -> server: the room's registry entry moved on. */
  | { k: 'room'; rec: RoomRecord }
  /** Host tab -> server: a fresh checkpoint of the round. */
  | { k: 'snap'; snap: Snapshot };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Parse an `env` off the wire. Returns null for anything unexpected. */
export function asBusEnv(v: unknown): BusEnv | null {
  if (!isRecord(v)) return null;
  switch (v.k) {
    case 'pub':
      return typeof v.ch === 'string' ? { k: 'pub', ch: v.ch, p: v.p } : null;
    case 'seed':
      return isRecord(v.rec)
        ? {
            k: 'seed',
            rec: v.rec as unknown as RoomRecord,
            snap: isRecord(v.snap) ? (v.snap as unknown as Snapshot) : null,
          }
        : null;
    case 'room':
      return isRecord(v.rec) ? { k: 'room', rec: v.rec as unknown as RoomRecord } : null;
    case 'snap':
      return isRecord(v.snap) ? { k: 'snap', snap: v.snap as unknown as Snapshot } : null;
    default:
      return null;
  }
}

/**
 * Channels a host tab is allowed to publish on: replies to its own room's
 * proxies. It may not, for instance, publish `in` traffic for someone else's
 * kitchen.
 */
export function hostMayPublish(code: string, ch: string): boolean {
  return ch === allChannel(code) || ch.startsWith(`${outChannel(code, '')}`);
}

/** The only channel the server pushes down the tunnel. */
export function serverMayPublish(code: string, ch: string): boolean {
  return ch === inChannel(code);
}

/** A room record off the wire, normalized enough to be safe to persist. */
export function asRoomRecord(code: string, v: RoomRecord): RoomRecord | null {
  if (typeof v.seq !== 'number' || !Number.isFinite(v.seq)) return null;
  if (typeof v.phase !== 'string') return null;
  if (!Array.isArray(v.seats)) return null;
  for (const seat of v.seats) {
    if (!isRecord(seat)) return null;
    if (typeof seat.playerId !== 'string' || typeof seat.token !== 'string') return null;
    if (typeof seat.name !== 'string' || typeof seat.color !== 'string') return null;
  }
  return { ...v, code };
}
