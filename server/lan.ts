// The addresses this machine answers on for a LAN party.
//
// Two callers have to agree on this list: `server/local.ts` prints one of them
// as the join URL behind the QR code, and `next.config.ts` allowlists all of
// them as dev origins. In Next 16 dev the initial RSC payload streams over the
// /_next/hmr socket, and Next refuses that socket for any origin it was not
// told about — so a phone on an unlisted address never gets past SSR markup.

import { networkInterfaces } from 'node:os';

const isV4 = (family: string): boolean => family === 'IPv4' || family === '4';

/** Every external IPv4 this machine has, en0 first — that is the Wi-Fi one. */
export function lanIps(): string[] {
  const nets = networkInterfaces();
  const found = new Set<string>();
  for (const name of ['en0', ...Object.keys(nets)]) {
    for (const addr of nets[name] ?? []) {
      if (isV4(String(addr.family)) && !addr.internal) found.add(addr.address);
    }
  }
  return [...found];
}

/** The one we hand to phones. */
export function lanIp(): string {
  return lanIps()[0] ?? 'localhost';
}
