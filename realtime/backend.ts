// Picks the persistence + bus implementation once per process.
//
//   REDIS_URL / KV_URL set -> Redis (many instances share rooms)
//   otherwise              -> memory (LAN party, or Vercel without a cache)
//
// Redis is never allowed to take the party down: any failure degrades to the
// in-memory backend with exactly one warning.

import { ROOM_TTL_MS, REDIS_CONNECT_TIMEOUT_MS } from './config';
import { MemoryBus, MemoryStore } from './memory';
import { createRedisClient, redisUrlFromEnv, RedisBus, RedisStore } from './redis';
import type { Backend, Bus, RoomRecord, Store, Unsubscribe } from './store';
import type { Snapshot } from '../shared/types';

class Degrader {
  degraded = false;

  constructor(private readonly reason: string) {}

  trip(err: unknown): void {
    if (this.degraded) return;
    this.degraded = true;
    console.warn(
      `[realtime] ${this.reason} — falling back to the in-memory backend for this instance.`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Runs against Redis until Redis misbehaves, then against memory forever. */
class DegradingStore implements Store {
  constructor(
    private readonly primary: Store,
    private readonly fallback: Store,
    private readonly flag: Degrader,
  ) {}

  get kind(): string {
    return this.flag.degraded ? this.fallback.kind : this.primary.kind;
  }

  private async run<T>(op: (s: Store) => Promise<T>, fallbackFirst = false): Promise<T> {
    if (this.flag.degraded || fallbackFirst) return op(this.fallback);
    try {
      return await op(this.primary);
    } catch (err) {
      this.flag.trip(err);
      return op(this.fallback);
    }
  }

  createRoom(rec: RoomRecord): Promise<boolean> {
    return this.run((s) => s.createRoom(rec));
  }
  getRoom(code: string): Promise<RoomRecord | null> {
    return this.run((s) => s.getRoom(code));
  }
  putRoom(rec: RoomRecord): Promise<void> {
    return this.run((s) => s.putRoom(rec));
  }
  deleteRoom(code: string): Promise<void> {
    return this.run((s) => s.deleteRoom(code));
  }
  putSnapshot(code: string, snap: Snapshot): Promise<void> {
    return this.run((s) => s.putSnapshot(code, snap));
  }
  getSnapshot(code: string): Promise<Snapshot | null> {
    return this.run((s) => s.getSnapshot(code));
  }
  acquireLease(code: string, owner: string, ttlMs: number): Promise<boolean> {
    return this.run((s) => s.acquireLease(code, owner, ttlMs));
  }
  renewLease(code: string, owner: string, ttlMs: number): Promise<boolean> {
    return this.run((s) => s.renewLease(code, owner, ttlMs));
  }
  releaseLease(code: string, owner: string): Promise<void> {
    return this.run((s) => s.releaseLease(code, owner));
  }
  readLeaseOwner(code: string): Promise<string | null> {
    return this.run((s) => s.readLeaseOwner(code));
  }
  async close(): Promise<void> {
    await Promise.allSettled([this.primary.close(), this.fallback.close()]);
  }
}

class DegradingBus implements Bus {
  constructor(
    private readonly primary: Bus,
    private readonly fallback: Bus,
    private readonly flag: Degrader,
  ) {}

  get kind(): string {
    return this.flag.degraded ? this.fallback.kind : this.primary.kind;
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    if (this.flag.degraded) return this.fallback.publish(channel, payload);
    try {
      await this.primary.publish(channel, payload);
    } catch (err) {
      this.flag.trip(err);
      await this.fallback.publish(channel, payload);
    }
  }

  async subscribe(channel: string, fn: (payload: unknown) => void): Promise<Unsubscribe> {
    if (this.flag.degraded) return this.fallback.subscribe(channel, fn);
    try {
      return await this.primary.subscribe(channel, fn);
    } catch (err) {
      this.flag.trip(err);
      return this.fallback.subscribe(channel, fn);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.primary.close(), this.fallback.close()]);
  }
}

let pending: Promise<Backend> | null = null;

async function build(): Promise<Backend> {
  const memory: Backend = { store: new MemoryStore(ROOM_TTL_MS), bus: new MemoryBus() };
  const url = redisUrlFromEnv();
  if (!url) return memory;

  const flag = new Degrader('Redis is unavailable');
  try {
    const pub = createRedisClient(url);
    const sub = createRedisClient(url);
    // An 'error' with no listener is an unhandled throw in ioredis.
    pub.on('error', (err) => flag.trip(err));
    sub.on('error', (err) => flag.trip(err));
    await Promise.race([
      Promise.all([pub.connect(), sub.connect()]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('connect timed out')), REDIS_CONNECT_TIMEOUT_MS).unref?.(),
      ),
    ]);
    if (flag.degraded) return memory;
    console.log('[realtime] backend: redis');
    return {
      store: new DegradingStore(new RedisStore(pub, ROOM_TTL_MS), memory.store, flag),
      bus: new DegradingBus(new RedisBus(pub, sub), memory.bus, flag),
    };
  } catch (err) {
    flag.trip(err);
    return memory;
  }
}

/** Memoized; every caller in the process shares one backend. */
export function getBackend(): Promise<Backend> {
  if (!pending) pending = build();
  return pending;
}

/** Tests and the local server's shutdown path. */
export async function resetBackend(): Promise<void> {
  const current = pending;
  pending = null;
  if (!current) return;
  const backend = await current.catch(() => null);
  if (!backend) return;
  await Promise.allSettled([backend.store.close(), backend.bus.close()]);
}
