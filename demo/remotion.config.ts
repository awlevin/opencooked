import { Config } from '@remotion/cli/config';

// PNG frames, not JPEG: JPEG input makes x264 tag the file full-range
// (yuvj420p), which some players re-map and wash out. PNG gives plain
// yuv420p / limited range — the format that plays the same everywhere.
Config.setVideoImageFormat('png');
Config.setCodec('h264');
Config.setPixelFormat('yuv420p');
Config.setCrf(18);
Config.setOverwriteOutput(true);
// The kitchen is a canvas; give each frame room to actually paint.
Config.setDelayRenderTimeoutInMilliseconds(60_000);
Config.setChromiumOpenGlRenderer('angle');
