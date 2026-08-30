// Every byte on the wire comes from a phone. Nothing in here throws.

import type { Btn } from '../shared/protocol';
import type { Vec2 } from '../shared/types';

import { CODE_ALPHABET, CODE_LEN, MAX_NAME_LEN } from './config';

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function asVec2(v: unknown): Vec2 | null {
  const o = asRecord(v);
  if (!o) return null;
  const { x, y } = o;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function asBtn(v: unknown): Btn | null {
  return v === 'a' || v === 'b' ? v : null;
}

export function asToken(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  // Tokens are base64url; anything else is junk and must not match a seat.
  return t.length >= 8 && t.length <= 128 && /^[A-Za-z0-9_-]+$/.test(t) ? t : undefined;
}

/** Drop ASCII control characters (a phone keyboard can emit anything). */
function stripControl(v: string): string {
  let out = '';
  for (const ch of v) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

export function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const name = stripControl(v).trim().slice(0, MAX_NAME_LEN);
  return name.length > 0 ? name : fallback;
}

/** Uppercase a user-typed room code, or null when it cannot be one. */
export function normalizeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  if (code.length !== CODE_LEN) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Parse a client frame. Returns null for anything that is not a `{t:string}`. */
export function parseFrame(raw: string): Record<string, unknown> | null {
  if (raw.length > 64 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const msg = asRecord(parsed);
  return msg && typeof msg.t === 'string' ? msg : null;
}
