// Tuning for the transport/room layer. Game tuning lives in shared/types.ts.

/** No I/O/0/1 — codes get read off a TV and typed on a phone. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LEN = 4;
export const MAX_NAME_LEN = 14;
export const MAX_PAYLOAD_BYTES = 16 * 1024;
/** Longest dt a single tick may integrate, so a stalled loop cannot teleport. */
export const MAX_DT_MS = 250;
/** Keepalive for the local (`ws`) server. */
export const PING_MS = 25_000;

/** Snapshot checkpoint cadence while playing. */
export const CHECKPOINT_MS = 1_000;
/** Registry + checkpoint lifetime. Refreshed on every write. */
export const ROOM_TTL_MS = 10 * 60_000;
/** Idle rooms rewrite their registry entry this often so it cannot expire. */
export const REGISTRY_REFRESH_MS = 60_000;

/** Ownership lease: a room's sim runs on exactly one instance. */
export const LEASE_MS = 15_000;
export const LEASE_RENEW_MS = 5_000;

/** A room with no host survives this long, frozen, for a host reconnect. */
export const HOST_GRACE_MS = 120_000;
/** A disconnected chef keeps their body this long mid-round. */
export const SEAT_GRACE_PLAYING_MS = 90_000;
/** Outside a round the roster stays honest: seats drop quickly. */
export const SEAT_GRACE_LOBBY_MS = 10_000;
/** Housekeeping cadence (grace timers, lease renew, ownership watch). */
export const SWEEP_MS = 1_000;

/**
 * Local mode: after a host socket (re)attaches to a room whose sim was handed
 * to a host tab, how long the server waits for that tab to say `claim-sim`
 * again before taking the round back over from its checkpoint. Long enough to
 * cover a socket reconnect, short enough that a host page which cannot run the
 * sim is not left staring at a frozen kitchen.
 */
export const RELAY_CLAIM_GRACE_MS = 3_000;

/** A controller relayed over the bus re-announces itself until answered. */
export const REMOTE_JOIN_RETRY_MS = 1_500;
export const REMOTE_JOIN_TIMEOUT_MS = 20_000;
/** How long to wait for the backend (Redis) to come up before degrading. */
export const REDIS_CONNECT_TIMEOUT_MS = 3_000;
