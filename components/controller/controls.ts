// How the pad works, in one picture.
//
// The same block is used twice: full size on the quick-start screen a new chef
// lands on, and folded into the lobby, where "how does this thing work" is the
// question everybody asks while they wait. It is a portrait of the real pad —
// same colours, same words on the same buttons — so when the round starts the
// player is looking at something they have already seen.
//
// This is the only place the controls are described. A button that learns a
// new trick is re-worded here and both screens follow.

import { el } from './dom';

interface Control {
  /** Which control to draw: the stick, or one of the two buttons. */
  kind: 'stick' | 'a' | 'b';
  /** What the real button says on it, so the picture and the pad agree. */
  label: string;
  /** What it does, in as few words as will carry it. */
  copy: string;
}

const CONTROLS: readonly Control[] = [
  { kind: 'stick', label: '', copy: 'DRAG TO MOVE' },
  { kind: 'a', label: 'GRAB', copy: 'PICK UP · PUT DOWN' },
  // Wording that stays true whichever button ends up doing the chopping.
  { kind: 'b', label: 'CHOP', copy: 'HOLD TO CHOP · TAP TO DASH' },
];

/** The round in five words. Arrows are drawn between them. */
const FLOW = ['GRAB', 'CHOP', 'COOK', 'PLATE', 'SERVE'];

/**
 * The three controls, left to right in the order a thumb meets them.
 * Decorative: every word in it is repeated on the pad itself.
 */
export function controlsGuide(): HTMLElement {
  const root = el('div', 'guide');
  for (const c of CONTROLS) {
    const cell = el('div', 'guide__cell');
    cell.appendChild(c.kind === 'stick' ? stickGlyph() : buttonGlyph(c));
    cell.appendChild(el('div', 'guide__copy', c.copy));
    root.appendChild(cell);
  }
  return root;
}

/** Ingredient to ticket, in one line: the loop the whole game is made of. */
export function cookFlow(): HTMLElement {
  const root = el('div', 'flow');
  FLOW.forEach((step, i) => {
    if (i > 0) root.appendChild(el('i', 'flow__arrow', '→'));
    root.appendChild(el('span', 'flow__step', step));
  });
  return root;
}

/** A joystick at rest with the thumb pushed off-centre — the drag, drawn. */
function stickGlyph(): HTMLElement {
  const stick = el('div', 'guide-stick');
  stick.appendChild(el('span', 'guide-stick__thumb'));
  return stick;
}

function buttonGlyph(c: Control): HTMLElement {
  return el('div', `guide-btn guide-btn--${c.kind}`, c.label);
}
