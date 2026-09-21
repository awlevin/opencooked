// "Turn your phone" — the one thing a new player is never told otherwise.
//
// The kitchen is a wide room and the pad is a wide instrument: held upright,
// both thumbs land in the same corner. So both hints below are pure CSS
// presence — `.rotate` is display:none until `@media (orientation: portrait)`
// — which means rotating the phone answers them instantly, with no listener,
// no resize maths and nothing to get out of step with the screen.
//
// Typing is nicer in portrait, so nothing here ever goes near the join form.

import { el } from './dom';

/**
 * Dismissed for the rest of this page's life. A phone with rotation lock on
 * cannot rotate, and nagging it every round is worse than a player who has
 * decided. It is deliberately not persisted: a reload is a new party.
 */
let waived = false;

/** The rotating phone glyph, drawn in CSS so it can animate for nothing. */
function glyph(): HTMLElement {
  const g = el('div', 'rotate__glyph');
  g.setAttribute('aria-hidden', 'true');
  g.appendChild(el('span', 'rotate__phone'));
  return g;
}

/**
 * The gamepad's hint: it covers the pad, because a pad in portrait is the
 * problem being reported. One tap plays on anyway — a rotation lock must never
 * be able to hold a chef out of the kitchen.
 */
export function rotateOverlay(): HTMLElement {
  const root = el('div', 'rotate rotate--overlay');
  root.hidden = waived;

  const box = el('div', 'rotate__box');
  box.append(
    glyph(),
    el('div', 'rotate__title', 'TURN YOUR PHONE'),
    el('p', 'rotate__copy', 'The kitchen plays sideways — both thumbs, room to move.'),
  );

  const waive = el('button', 'rotate__waive', 'Play upright anyway');
  waive.type = 'button';
  waive.addEventListener('click', () => {
    waived = true;
    root.hidden = true;
  });
  box.appendChild(waive);

  root.appendChild(box);
  return root;
}

/**
 * The lobby's hint: a line, not a wall. Nobody is playing yet, so this only
 * asks people to turn the phone before the whistle goes.
 */
export function rotateNote(): HTMLElement {
  const root = el('div', 'rotate rotate--note');
  root.append(glyph(), el('span', 'rotate__note-copy', 'Turn your phone sideways to cook'));
  return root;
}
