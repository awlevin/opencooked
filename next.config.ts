import type { NextConfig } from 'next';

import { lanIps } from './server/lan';

const nextConfig: NextConfig = {
  // Don't generate AGENTS.md/CLAUDE.md at the repo root.
  agentRules: false,
  // Phones reach `npm run dev` by LAN IP, not by localhost. Next blocks its own
  // dev socket for origins it was not told about, and in Next 16 that socket
  // carries the RSC payload the page hydrates from — so an unlisted address
  // leaves the phone on static SSR markup forever. Trust this machine's own
  // addresses, and nothing else.
  allowedDevOrigins: lanIps(),
};

export default nextConfig;
