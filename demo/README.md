# Opencooked — launch demo

The video is not a mock-up. `capture/` boots the real game on a scratch port,
sits three bots and one phone at the table, plays a round, and films it.
`src/` is the Remotion edit that wraps that footage in a title, an explainer
and an outro.

## Two commands

```bash
cd demo
npm install            # once
npx playwright install chromium   # once

npm run capture        # film a round  -> captures/*.mp4 + captures/meta.json
npm run render         # cut the video -> out/demo.mp4 (1920x1080, H.264, 30 fps)
```

`npm run gif` then rebuilds `../assets/demo.gif` from the same footage.

## What `npm run capture` does

1. Starts `server/local.ts` on port 3777 in production mode. It needs a build,
   so run `npm run build` in the repo root first if `.next/` is stale.
2. Opens the host TV screen at exactly 1920x1080, `devicePixelRatio` 1.
3. Opens a controller at 390x844 with touch, joins it to the same room, and
   drives its joystick and GRAB button with real pointer events.
4. Seats three bots from `../scripts/demo-bots.ts`. They read the world off the
   host page's own WebSocket frames — a room has one host, so the capture
   driver forwards snapshots to them rather than opening a second host socket.
5. Records both pages with the Chromium screencast API (~60 fps at 1920x1080)
   and re-times the frames to a constant 30 fps with ffmpeg.
6. **Rejects the take unless the score really moved**: at least two soups
   served within 40 s of the whistle. It retries with a fresh room up to three
   times before giving up.

Everything it starts — the Next server, the browser — is killed on the way out.

Knobs: `DEMO_PORT`, `DEMO_SECONDS`, `DEMO_MIN_SERVES`, `DEMO_ACCEPT_WINDOW`.

## How the edit stays in sync with the footage

`captures/meta.json` records when things happened: every serve, every chop,
every pot that filled, and where the joystick and GRAB button sit on the phone
screen. `src/timeline.ts` turns that into the cut — it picks the 33 s gameplay
window so the last serve lands ~2.5 s before the outro, and pins the "Chop",
"Cook" and "Serve!" labels to moments that are genuinely on screen. Re-capture
and the edit re-times itself; no hand-tuned frame numbers.

## Layout

| Path | What |
|---|---|
| `capture/capture.ts` | Playwright driver: server, pages, bots, screencast, take validation |
| `capture/frames.ts` | Screencast frame sink |
| `capture/ffmpeg.ts` | Bundled ffmpeg/ffprobe, variable-rate frames -> constant 30 fps |
| `capture/make-gif.ts` | `assets/demo.gif`, stepped down until it fits 8 MB |
| `src/timeline.ts` | Scene lengths and every beat, derived from `meta.json` |
| `src/scenes/` | Title, How it works, Gameplay, Outro |
| `captures/`, `public/` | Raw footage (git-ignored — re-creatable with one command) |
| `out/demo.mp4` | The video |

No downloaded images or audio anywhere: the title, the TV/phone diagram and
the outro are drawn from shapes and Baloo 2, the same face the game uses. The
video is silent by design.
