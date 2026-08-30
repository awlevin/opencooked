// Redis-backed store + bus, used when REDIS_URL / KV_URL is set (Vercel).
// Rooms live in three keys: the registry record, the latest sim checkpoint,
// and the ownership lease. All of them expire, so a crashed instance cannot
// leave litter behind.

import Redis from 'ioredis';

import type { Snapshot } from '../shared/types';

import type { Bus, RoomRecord, Store, Unsubscribe } from './store';

const PREFIX = 'oc';
const roomKey = (code: string): string => `${PREFIX}:room:${code}`;
const snapKey = (code: string): string => `${PREFIX}:snap:${code}`;
const leaseKey = (code: string): string => `${PREFIX}:lease:${code}`;

/** Take the lease when it is free or already ours. Never steal a live one. */
const ACQUIRE_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur == false or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0`;

const RENEW_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0`;

const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
return 1`;

export function redisUrlFromEnv(): string | null {
  const url = process.env.REDIS_URL ?? process.env.KV_URL ?? null;
  return url && url.trim().length > 0 ? url.trim() : null;
}

export function createRedisClient(url: string): Redis {
  const secure = url.startsWith('rediss://');
  return new Redis(url, {
    lazyConnect: true,
    // A party must not stall on a sulking cache: fail fast, we degrade.
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    ...(secure ? { tls: {} } : {}),
  });
}

export class RedisStore implements Store {
  readonly kind = 'redis';

  constructor(
    private readonly client: Redis,
    private readonly ttlMs: number,
  ) {}

  async createRoom(rec: RoomRecord): Promise<boolean> {
    const res = await this.client.set(
      roomKey(rec.code),
      JSON.stringify(rec),
      'PX',
      this.ttlMs,
      'NX',
    );
    return res === 'OK';
  }

  async getRoom(code: string): Promise<RoomRecord | null> {
    return parse<RoomRecord>(await this.client.get(roomKey(code)));
  }

  async putRoom(rec: RoomRecord): Promise<void> {
    await this.client.set(roomKey(rec.code), JSON.stringify(rec), 'PX', this.ttlMs);
  }

  async deleteRoom(code: string): Promise<void> {
    await this.client.del(roomKey(code), snapKey(code));
  }

  async putSnapshot(code: string, snap: Snapshot): Promise<void> {
    await this.client.set(snapKey(code), JSON.stringify(snap), 'PX', this.ttlMs);
  }

  async getSnapshot(code: string): Promise<Snapshot | null> {
    return parse<Snapshot>(await this.client.get(snapKey(code)));
  }

  async acquireLease(code: string, owner: string, ttlMs: number): Promise<boolean> {
    const res = await this.client.eval(ACQUIRE_LUA, 1, leaseKey(code), owner, String(ttlMs));
    return res === 1;
  }

  async renewLease(code: string, owner: string, ttlMs: number): Promise<boolean> {
    const res = await this.client.eval(RENEW_LUA, 1, leaseKey(code), owner, String(ttlMs));
    return res === 1;
  }

  async releaseLease(code: string, owner: string): Promise<void> {
    await this.client.eval(RELEASE_LUA, 1, leaseKey(code), owner);
  }

  async readLeaseOwner(code: string): Promise<string | null> {
    return this.client.get(leaseKey(code));
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }
}

function parse<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class RedisBus implements Bus {
  readonly kind = 'redis';

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private wired = false;

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
  ) {}

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    this.sub.on('message', (channel: string, message: string) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      const payload = parse<unknown>(message);
      if (payload === null) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[bus] subscriber for ${channel} threw:`, err);
        }
      }
    });
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.pub.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, fn: (payload: unknown) => void): Promise<Unsubscribe> {
    this.wire();
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(fn);
    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(fn);
      if (s.size > 0) return;
      this.handlers.delete(channel);
      void this.sub.unsubscribe(channel).catch(() => undefined);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.sub.disconnect();
    this.pub.disconnect();
  }
}
