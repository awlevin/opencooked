// World 1 — Home Kitchen. Warm wood, cream counters, one pot of soup at a
// time. This is where a table of people who have never played learns the
// controls, so the ramp is gentle: one dish, then a mixed soup book, then a
// menu that needs the pan as well as the pots.

import type { WorldDef } from '../types';

export const HOME: WorldDef = {
  id: 'home',
  name: 'Home Kitchen',
  tagline: 'Where every chef starts',
  theme: {
    motif: 'home',
    ink: '#3b2314',
    shadow: 'rgba(28, 16, 9, 0.42)',
    floorA: '#c98a4b',
    floorB: '#bd7d40',
    floorSeam: '#9c6432',
    floorGrain: 'rgba(94, 56, 24, 0.20)',
    vignette: 'rgba(40, 20, 8, 0.42)',
    counterTop: '#fffaf0',
    counterBottom: '#d9ab6f',
    counterFace: '#fff2d8',
    frame: '#3b2314',
    backdropTop: '#39200f',
    backdropBottom: '#1c110a',
    hudBg: 'rgba(38, 22, 13, 0.94)',
    hudEdge: '#ffd23f',
    accent: '#ffd23f',
  },
  levels: [
    {
      // Nothing to decide: one dish, one ingredient, an empty floor. The whole
      // level is "walk there, hold the button, walk back".
      id: 'home-1',
      name: 'Mise en place',
      rows: [
        '##O#S#S#O##B#',
        '#...........#',
        'B.@.......@.#',
        '#...........#',
        '#...@...@...#',
        '#.@.......@.#',
        '#...........#',
        '#X###E###P#W#',
      ],
      menu: ['onion-soup'],
    },
    {
      // Three vegetables and a centre island: now there is a wrong way round
      // the kitchen, and two chefs can want the same board.
      id: 'home-2',
      name: 'Dinner rush',
      rows: [
        '#OTM##S#S##B#',
        '#...........#',
        '#.@.......@.#',
        '#...#B#B#...#',
        '#...#####...#',
        '#.@.......@.#',
        '#..@.....@..#',
        '#X##E####P#W#',
      ],
      menu: ['onion-soup', 'tomato-soup', 'mushroom-soup', 'garden-soup'],
      orderSpawnMs: 14_000,
    },
    {
      // The full family: soups and burgers off one line. Two pots and a pan
      // means the kitchen has two rhythms running at once, and the crates for
      // each are at opposite ends of the room.
      id: 'home-3',
      name: 'Family reunion',
      rows: [
        '#OTM###F#S#S#',
        '#.....@.....#',
        'U.@.......@.#',
        'R...#B###...#',
        'C...###B#...#',
        '#.@.......@.#',
        '#.....@.....P',
        '#X######E##W#',
      ],
      menu: [
        'onion-soup',
        'tomato-soup',
        'mushroom-soup',
        'garden-soup',
        'burger',
        'cheeseburger',
      ],
    },
  ],
};
