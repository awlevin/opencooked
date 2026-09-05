// World 2 — Boardwalk Grill. Sun-bleached decking, teal shutters, a striped
// awning over the pass. Everything here goes through a pan: a patty has to be
// chopped *and* fried before it is worth anything, so the kitchen's rhythm
// changes from "fill the pot" to "keep the pans turning".

import type { WorldDef } from '../types';

export const GRILL: WorldDef = {
  id: 'grill',
  name: 'Boardwalk Grill',
  tagline: 'Patties, salt air, no shade',
  theme: {
    motif: 'seaside',
    ink: '#1c3238',
    shadow: 'rgba(10, 34, 38, 0.40)',
    floorA: '#e3cfa2',
    floorB: '#d8c294',
    floorSeam: '#b49b6d',
    floorGrain: 'rgba(96, 74, 40, 0.16)',
    vignette: 'rgba(12, 52, 58, 0.34)',
    counterTop: '#f4fdff',
    counterBottom: '#9ccdd4',
    counterFace: '#e7f7fa',
    frame: '#1c3238',
    backdropTop: '#1c6f78',
    backdropBottom: '#0a262c',
    hudBg: 'rgba(9, 40, 46, 0.94)',
    hudEdge: '#ffb03a',
    accent: '#ffb03a',
  },
  levels: [
    {
      // One dish, but a new verb: chop the patty, fry the patty, then plate it
      // with a bun. Two pans so nobody is ever queuing for heat.
      id: 'grill-1',
      name: 'Flat top',
      rows: [
        '#UR##F#F##BB#',
        '#...........#',
        '#.@.......@.#',
        '#....###....#',
        '#....#P#....#',
        '#.@.......@.#',
        '#..@.....@..#',
        '#X###E####W##',
      ],
      menu: ['burger'],
    },
    {
      // Three dishes, and every crate is on the south wall while every pan is
      // on the north one: the level is a lesson in carrying two things at once.
      id: 'grill-2',
      name: 'Cheese please',
      rows: [
        '##F##B###B##F##',
        '#.............#',
        '#.@.........@.#',
        '#....#####....#',
        '#....#P#W#....#',
        '#.@.........@.#',
        '#..@.......@..#',
        '#XU#R##E##C#L##',
      ],
      menu: ['burger', 'cheeseburger', 'side-salad'],
      orderMs: 55_000,
      orderSpawnMs: 14_000,
    },
    {
      // A counter wall splits the kitchen in two with one gap at the bottom and
      // one board *in* the wall — the fastest route for a chopped patty is to
      // hand it across. Four toppings, one board, tickets that do not wait.
      id: 'grill-3',
      name: 'Boardwalk deluxe',
      rows: [
        '#UR###F#F##W#',
        '#....#......#',
        '#.@..#..@...#',
        '#....B......#',
        '#....#......#',
        '#.@..#..@...#',
        '#..@.....@..#',
        '#X#C#L#E#P#B#',
      ],
      menu: ['cheeseburger', 'salad-burger', 'deluxe-burger'],
      orderMs: 45_000,
      orderSpawnMs: 12_000,
      maxOrders: 4,
    },
  ],
};
