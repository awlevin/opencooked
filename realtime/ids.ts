// Random ids, on the Web Crypto API only.
//
// This module is imported by `realtime/room.ts`, which now runs in a browser
// tab as well as on the server (local mode: the host tab owns the sim). So
// nothing here may touch `node:crypto` — `globalThis.crypto` is standard in
// Node 18+ and in every browser we target.

import { CODE_ALPHABET, CODE_LEN } from './config';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/** Unpadded base64url, the same alphabet `Buffer.toString('base64url')` uses. */
function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1: number | undefined = bytes[i + 1];
    const b2: number | undefined = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64URL[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64URL[b2 & 0b111111];
  }
  return out;
}

/** URL-safe random id. 12 bytes ≈ 96 bits; plenty for seat tokens. */
export function randomId(bytes = 12): string {
  return toBase64Url(randomBytes(bytes));
}

/** Unguessable seat token handed to a controller so it can reclaim its seat. */
export function makeToken(): string {
  return randomId(18);
}

/** Identifies this process across instances (ownership lease, bus routing). */
export const INSTANCE_ID = randomId(8);

/** One room code: 4 letters from an alphabet that survives a TV screen. */
export function makeCode(): string {
  const buf = randomBytes(CODE_LEN);
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  }
  return code;
}
