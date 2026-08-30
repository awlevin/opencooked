import { randomBytes } from 'node:crypto';

import { CODE_ALPHABET, CODE_LEN } from './config';

/** URL-safe random id. 12 bytes ≈ 96 bits; plenty for seat tokens. */
export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
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
