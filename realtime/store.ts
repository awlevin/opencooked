// Persistence + pub/sub contracts. Two implementations: memory (single
// process, the default) and Redis (many Vercel instances). Nothing above this
// file may assume which one it got.

import type { S2C } from '../shared/protocol';
import type { Phase, Snapshot } from '../shared/types';

/** One chef's seat in a room. `token` reclaims it after a reconnect. */
export interface Seat {
  playerId: string;
  name: string;
  color: string;
  token: string;
  connected: boolean;
  /** When the controller socket dropped; drives the grace timers. */
  disconnectedAt: number | null;
}

/** The registry entry for a room: everything needed to rebuild it elsewhere. */
export interface RoomRecord {
  code: string;
  createdAt: number;
  updatedAt: number;
  phase: Phase;
  /** Monotonic player-id counter, so a restored room never reuses an id. */
  seq: number;
  seats: Seat[];
  /** Instance that last ran the sim (informational; the lease is the truth). */
  owner: string | null;
  hostConnected: boolean;
}

export interface Store {
  readonly kind: string;
  /** Create only if the code is free. False means "pick another code". */
  createRoom(rec: RoomRecord): Promise<boolean>;
  getRoom(code: string): Promise<RoomRecord | null>;
  putRoom(rec: RoomRecord): Promise<void>;
  deleteRoom(code: string): Promise<void>;
  putSnapshot(code: string, snap: Snapshot): Promise<void>;
  getSnapshot(code: string): Promise<Snapshot | null>;
  /** Take ownership of a room's sim. Only succeeds when no lease is live. */
  acquireLease(code: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Extend our own lease. False means we lost it and must stand down. */
  renewLease(code: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLease(code: string, owner: string): Promise<void>;
  readLeaseOwner(code: string): Promise<string | null>;
  close(): Promise<void>;
}

export type Unsubscribe = () => void;

export interface Bus {
  readonly kind: string;
  publish(channel: string, payload: unknown): Promise<void>;
  subscribe(channel: string, fn: (payload: unknown) => void): Promise<Unsubscribe>;
  close(): Promise<void>;
}

export interface Backend {
  store: Store;
  bus: Bus;
}

// --- bus channels ----------------------------------------------------------
//
// A controller that lands on an instance which does not own its room becomes a
// proxy: it publishes everything it says on `<room>:in` and replays whatever
// arrives on its own `<room>:out:<addr>` and the room-wide `<room>:all`.
// The owning instance is the only subscriber of `:in` and the only publisher
// of `:out:*` / `:all`.

export const inChannel = (code: string): string => `room:${code}:in`;
export const outChannel = (code: string, addr: string): string => `room:${code}:out:${addr}`;
export const allChannel = (code: string): string => `room:${code}:all`;

/** Proxy -> owner. `connId` is the proxy's routing address. */
export type InEnvelope =
  | { k: 'msg'; connId: string; data: unknown }
  /** The proxy is now listening on `out:<playerId>`; safe to switch. */
  | { k: 'bound'; connId: string; playerId: string }
  | { k: 'bye'; connId: string };

/** Owner -> one proxy. `connId` guards against a stale proxy for the seat. */
export type OutEnvelope =
  | { k: 'send'; connId: string; msg: S2C }
  /** The proxy now also answers to `out:<playerId>`. */
  | { k: 'bind'; connId: string; playerId: string }
  | { k: 'close'; connId: string; msg?: S2C };

/** Owner -> every proxy in the room. */
export type AllEnvelope =
  | { k: 'send'; msg: S2C }
  /** A new instance claimed the room; unanswered proxies re-announce. */
  | { k: 'owner'; owner: string };
