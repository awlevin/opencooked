// WebSocket endpoint on Vercel (Fluid Compute).
//
// The upgrade hands us a `ws` socket; from there it is the same room manager
// the local server uses. The invocation must stay alive for as long as the
// socket does, so the handler resolves only when the socket closes — capped
// by maxDuration, after which the client reconnects and resumes (the host
// with `hello-host {resume}`, controllers with their seat token).

import { experimental_upgradeWebSocket } from '@vercel/functions';

import { MAX_PAYLOAD_BYTES } from '../../../realtime/config';
import { attachWebSocket } from '../../../realtime';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    return await experimental_upgradeWebSocket(
      (ws) =>
        new Promise<void>((resolve) => {
          attachWebSocket(ws);
          ws.on('close', () => resolve());
          ws.on('error', () => resolve());
        }),
      { maxPayload: MAX_PAYLOAD_BYTES },
    );
  } catch (err) {
    // Plain `next dev` cannot upgrade sockets; the LAN server does that.
    console.error('[ws] upgrade unavailable:', err);
    return new Response('WebSocket upgrade is not available here. Run server/local.ts.', {
      status: 426,
    });
  }
}
