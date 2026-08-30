import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Don't generate AGENTS.md/CLAUDE.md at the repo root.
  agentRules: false,
};

export default nextConfig;
