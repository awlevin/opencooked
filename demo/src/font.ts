// Baloo 2 is the game's face; the video uses the same one.

import { loadFont } from '@remotion/google-fonts/Baloo2';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '600', '700', '800'],
  subsets: ['latin'],
});

export const FONT = `${fontFamily}, 'Baloo 2', 'Fredoka', 'Trebuchet MS', system-ui, sans-serif`;
