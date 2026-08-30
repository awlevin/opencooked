// Single-process store + bus. This is the whole backend for a LAN party, and
// the fallback whenever Redis is absent or unhappy.

import type { Snapshot } from '../shared/types';

import type { Bus, RoomRecord, Store, Unsubscribe } from './store';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

function live<T>(e: Entry<T> | undefined, now: number): T | null {
  if (!e) return null;
  return e.expiresAt > now ? e.value : null;
}

/** Deep clone so callers cannot mutate what is "persisted". */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class MemoryStore implements Store {
  readonly kind = 'memory';

  private readonly rooms = new Map<string, Entry<RoomRecord>>();
  private readonly snaps = new Map<string, Entry<Snapshot>>();
  private readonly leases = new Map<string, Entry<string>>();

  private sweep(now: number): void {
    for (const [k, e] of this.rooms) if (e.expiresAt <= now) this.rooms.delete(k);
    for (const [k, e] of this.snaps) if (e.expiresAt <= now) this.snaps.delete(k);
    for (const [k, e] of this.leases) if (e.expiresAt <= now) this.leases.delete(k);
  }

  constructor(private readonly ttlMs: number) {}

  async createRoom(rec: RoomRecord): Promise<boolean> {
    const now = Date.now();
    this.sweep(now);
    if (live(this.rooms.get(rec.code), now)) return false;
    this.rooms.set(rec.code, { value: clone(rec), expiresAt: now + this.ttlMs });
    return true;
  }

  async getRoom(code: string): Promise<RoomRecord | null> {
    const rec = live(this.rooms.get(code), Date.now());
    return rec ? clone(rec) : null;
  }

  async putRoom(rec: RoomRecord): Promise<void> {
    this.rooms.set(rec.code, { value: clone(rec), expiresAt: Date.now() + this.ttlMs });
  }

  async deleteRoom(code: string): Promise<void> {
    this.rooms.delete(code);
    this.snaps.delete(code);
  }

  async putSnapshot(code: string, snap: Snapshot): Promise<void> {
    this.snaps.set(code, { value: clone(snap), expiresAt: Date.now() + this.ttlMs });
  }

  async getSnapshot(code: string): Promise<Snapshot | null> {
    const snap = live(this.snaps.get(code), Date.now());
    return snap ? clone(snap) : null;
  }

  async acquireLease(code: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const held = live(this.leases.get(code), now);
    // Takeover only once the previous owner stopped renewing.
    if (held !== null && held !== owner) return false;
    this.leases.set(code, { value: owner, expiresAt: now + ttlMs });
    return true;
  }

  async renewLease(code: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const held = live(this.leases.get(code), now);
    if (held !== owner) return false;
    this.leases.set(code, { value: owner, expiresAt: now + ttlMs });
    return true;
  }

  async releaseLease(code: string, owner: string): Promise<void> {
    if (live(this.leases.get(code), Date.now()) === owner) this.leases.delete(code);
  }

  async readLeaseOwner(code: string): Promise<string | null> {
    return live(this.leases.get(code), Date.now());
  }

  async close(): Promise<void> {
    this.rooms.clear();
    this.snaps.clear();
    this.leases.clear();
  }
}

export class MemoryBus implements Bus {
  readonly kind = 'memory';

  private readonly subs = new Map<string, Set<(payload: unknown) => void>>();

  async publish(channel: string, payload: unknown): Promise<void> {
    const set = this.subs.get(channel);
    if (!set) return;
    // Clone so a subscriber cannot mutate the publisher's object, matching
    // what the Redis bus does for free.
    const frozen = clone(payload);
    for (const fn of [...set]) {
      try {
        fn(clone(frozen));
      } catch (err) {
        console.error(`[bus] subscriber for ${channel} threw:`, err);
      }
    }
  }

  async subscribe(channel: string, fn: (payload: unknown) => void): Promise<Unsubscribe> {
    let set = this.subs.get(channel);
    if (!set) {
      set = new Set();
      this.subs.set(channel, set);
    }
    set.add(fn);
    return () => {
      const s = this.subs.get(channel);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.subs.delete(channel);
    };
  }

  async close(): Promise<void> {
    this.subs.clear();
  }
}
