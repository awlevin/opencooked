// WebSocket endpoint on Vercel (Fluid Compute) — owned by the realtime agent.
// Will use experimental_upgradeWebSocket from @vercel/functions.
export const maxDuration = 300;

export async function GET() {
  return new Response('WebSocket endpoint not wired yet', { status: 426 });
}
