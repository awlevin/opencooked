// World 3 — Night Sushi Bar. Ink-blue floor, neon over the pass, lanterns in
// the corners. Rice is the twist: it boils one portion at a time, so a pot is
// a fast trip rather than a batch, and a menu of three rolls means six pots
// are all busy at once — and every one of them burns.

import type { WorldDef } from '../types';

export const SUSHI: WorldDef = {
  id: 'sushi',
  name: 'Night Sushi Bar',
  tagline: 'Rice by the portion, neon on the pass',
  theme: {
    motif: 'night',
    ink: '#10141d',
    shadow: 'rgba(4, 6, 12, 0.55)',
    floorA: '#2b3346',
    floorB: '#252c3c',
    floorSeam: '#171c28',
    floorGrain: 'rgba(126, 214, 255, 0.10)',
    vignette: 'rgba(4, 8, 18, 0.55)',
    counterTop: '#46506a',
    counterBottom: '#232a3a',
    counterFace: '#3a4258',
    frame: '#0b0e16',
    backdropTop: '#1a2136',
    backdropBottom: '#070a11',
    hudBg: 'rgba(10, 13, 22, 0.94)',
    hudEdge: '#4be1d8',
    accent: '#4be1d8',
  },
  levels: [
    {
      // Two parts, no pan, no batching to think about: press rice, chop fish.
      // The point of the level is to teach that a pot can also mean "one".
      id: 'sushi-1',
      name: 'Rice & fish',
      rows: [
        '#I#S#S#S#H#H#',
        '#...........#',
        '#.@.......@.#',
        '#...#B#B#...#',
        '#...#####...#',
        '#.@.......@.#',
        '#..@.....@..#',
        '#X##E####P#W#',
      ],
      menu: ['nigiri'],
    },
    {
      // The nori and the plates live behind a counter wall, so the rolls are
      // built on the far side of the room from the rice.
      id: 'sushi-2',
      name: 'Rolling',
      rows: [
        '#I#S#S###S#S#I#',
        '#.............#',
        '#.@.........@.#',
        '#...#######...#',
        '#...#V#P#V#...#',
        '#.@.........@.#',
        '#..@.......@..#',
        '#X#B#H#E#H#B#W#',
      ],
      menu: ['nigiri', 'maki'],
      orderMs: 55_000,
      orderSpawnMs: 13_000,
    },
    {
      // Omakase: three rolls, four tickets at once, one every eleven seconds,
      // and forty-five to finish each. Six rice pots on the back wall and one
      // extinguisher on the opposite one, because they will all be lit.
      id: 'sushi-3',
      name: 'Omakase',
      rows: [
        '#S#S#S###S#S#S#',
        '#.............#',
        '#.@.........@.#',
        '#..#B#####B#..#',
        '#..#I#V#H#L#..#',
        '#.@.........@.#',
        '#..@.......@..#',
        '#X##P###E###W##',
      ],
      menu: ['nigiri', 'maki', 'veggie-roll'],
      orderMs: 45_000,
      orderSpawnMs: 11_000,
      maxOrders: 4,
    },
  ],
};
