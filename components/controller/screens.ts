// Screen builders. Each returns a detached element; the app swaps them in.

import { LEVELS, levelById, nextLevelId, worldOf } from '@/shared/levels';
import type { LobbyPlayer } from '@/shared/types';
import { el } from './dom';

export const MAX_NAME = 12;
export const MAX_CODE = 4;

export function sanitizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_CODE);
}

export function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trimStart().slice(0, MAX_NAME);
}

/* -------------------------------- join --------------------------------- */

export interface JoinProps {
  room: string;
  roomLocked: boolean; // came from ?room=, so show it rather than ask for it
  name: string;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onSubmit: (room: string, name: string) => void;
}

export function joinScreen(p: JoinProps): HTMLElement {
  const root = el('div', 'screen screen--join');
  const card = el('form', 'card');
  card.setAttribute('novalidate', '');

  card.appendChild(el('div', 'brand', 'OPENCOOKED'));
  card.appendChild(el('div', 'brand__sub', 'PARTY'));

  let codeInput: HTMLInputElement | null = null;

  if (p.roomLocked) {
    const badge = el('div', 'room-badge');
    badge.appendChild(el('span', 'room-badge__label', 'ROOM'));
    badge.appendChild(el('span', 'room-badge__code', p.room));
    card.appendChild(badge);
  } else {
    const field = el('label', 'field');
    field.appendChild(el('span', 'field__label', 'ROOM CODE'));
    codeInput = el('input', 'input input--code');
    codeInput.value = p.room;
    codeInput.maxLength = MAX_CODE;
    codeInput.placeholder = '––––';
    codeInput.autocomplete = 'off';
    codeInput.spellcheck = false;
    codeInput.setAttribute('autocapitalize', 'characters');
    codeInput.setAttribute('autocorrect', 'off');
    codeInput.setAttribute('enterkeyhint', 'next');
    codeInput.addEventListener('input', () => {
      const c = codeInput as HTMLInputElement;
      const cleaned = sanitizeCode(c.value);
      if (c.value !== cleaned) c.value = cleaned;
    });
    field.appendChild(codeInput);
    card.appendChild(field);
  }

  const nameField = el('label', 'field');
  nameField.appendChild(el('span', 'field__label', 'CHEF NAME'));
  const nameInput = el('input', 'input');
  nameInput.value = p.name;
  nameInput.maxLength = MAX_NAME;
  nameInput.placeholder = 'Chef';
  nameInput.setAttribute('autocomplete', 'nickname');
  nameInput.spellcheck = false;
  nameInput.setAttribute('autocapitalize', 'words');
  nameInput.setAttribute('autocorrect', 'off');
  nameInput.setAttribute('enterkeyhint', 'go');
  nameInput.addEventListener('input', () => {
    const cleaned = sanitizeName(nameInput.value);
    if (nameInput.value !== cleaned) nameInput.value = cleaned;
  });
  nameField.appendChild(nameInput);
  card.appendChild(nameField);

  const submit = el('button', 'big-btn', p.busy ? 'JOINING…' : 'JOIN');
  submit.type = 'submit';
  submit.disabled = p.busy;
  card.appendChild(submit);

  if (p.error) card.appendChild(el('p', 'msg msg--error', p.error));
  else if (p.notice) card.appendChild(el('p', 'msg', p.notice));

  card.addEventListener('submit', (e) => {
    e.preventDefault();
    if (p.busy) return;
    const room = p.roomLocked ? p.room : sanitizeCode(codeInput?.value ?? '');
    const name = sanitizeName(nameInput.value).trim();
    if (!room) {
      codeInput?.focus();
      return;
    }
    p.onSubmit(room, name || 'Chef');
  });

  root.appendChild(card);
  return root;
}

/* -------------------------------- lobby -------------------------------- */

export interface LobbyProps {
  name: string;
  color: string;
  room: string;
  players: LobbyPlayer[];
  playerId: string;
  busy: boolean;
  levelId: string;
  onStart: () => void;
  onSelect: (levelId: string) => void;
}

/**
 * The kitchen chooser: one step back, one step forward, through every level of
 * every world in playing order. Any chef may move it, and the TV follows —
 * which is the whole reason it is two big arrows and no menu.
 */
function levelPicker(levelId: string, onSelect: (id: string) => void): HTMLElement {
  const row = el('div', 'level-pick');
  const i = LEVELS.findIndex((l) => l.id === levelId);
  const step = (delta: number): void => {
    const next = LEVELS[i + delta];
    if (next) onSelect(next.id);
  };

  const arrow = (label: string, delta: number): HTMLButtonElement => {
    const b = el('button', 'level-pick__arrow', label);
    b.type = 'button';
    b.disabled = i < 0 || LEVELS[i + delta] === undefined;
    b.setAttribute('aria-label', delta < 0 ? 'Previous kitchen' : 'Next kitchen');
    b.addEventListener('click', () => step(delta));
    return b;
  };

  const body = el('div', 'level-pick__body');
  let world = '';
  let name = levelId;
  let stepLabel = '';
  try {
    const level = levelById(levelId);
    world = worldOf(levelId)?.name ?? '';
    name = level.name;
    stepLabel = `${level.index} / ${level.count}`;
  } catch {
    // An id this build does not know: show it raw rather than an empty row.
  }
  body.appendChild(el('span', 'level-pick__world', world));
  body.appendChild(el('span', 'level-pick__name', name));
  body.appendChild(el('span', 'level-pick__step', stepLabel));

  row.appendChild(arrow('‹', -1));
  row.appendChild(body);
  row.appendChild(arrow('›', 1));
  return row;
}

export function lobbyScreen(p: LobbyProps): HTMLElement {
  const root = el('div', 'screen screen--lobby');

  const head = el('div', 'lobby-head');
  head.appendChild(el('h1', 'title', "You're in! 🧑‍🍳"));
  const chip = el('div', 'chef-chip');
  const dot = el('span', 'chef-chip__dot');
  dot.style.background = p.color;
  chip.appendChild(dot);
  chip.appendChild(el('span', 'chef-chip__name', p.name));
  head.appendChild(chip);
  head.appendChild(el('p', 'msg', `Room ${p.room} · look for your colour on the TV`));
  root.appendChild(head);

  const rosterWrap = el('div', 'roster-wrap');
  rosterWrap.dataset.scroll = 'true';
  rosterWrap.appendChild(
    el('div', 'roster__count', `${p.players.length} chef${p.players.length === 1 ? '' : 's'} ready`),
  );
  const roster = el('ul', 'roster');
  for (const pl of p.players) {
    const li = el('li', 'roster__item' + (pl.id === p.playerId ? ' is-me' : ''));
    const d = el('span', 'roster__dot');
    d.style.background = pl.color;
    li.appendChild(d);
    li.appendChild(el('span', 'roster__name', pl.name));
    roster.appendChild(li);
  }
  if (p.players.length === 0) roster.appendChild(el('li', 'roster__empty', 'Waiting for chefs…'));
  rosterWrap.appendChild(roster);
  root.appendChild(rosterWrap);

  const actions = el('div', 'actions');
  actions.appendChild(levelPicker(p.levelId, p.onSelect));
  const start = el('button', 'big-btn big-btn--hero', p.busy ? 'STARTING…' : 'START');
  start.type = 'button';
  start.disabled = p.busy;
  start.addEventListener('click', () => p.onStart());
  actions.appendChild(start);
  root.appendChild(actions);

  return root;
}

/* ------------------------------ game over ------------------------------ */

export interface GameOverProps {
  score: number;
  served: number;
  missed: number;
  busy: boolean;
  levelId: string;
  onAgain: () => void;
  onNext: (levelId: string) => void;
}

export function gameOverScreen(p: GameOverProps): HTMLElement {
  const root = el('div', 'screen screen--over');

  root.appendChild(el('h1', 'title', 'SERVICE OVER'));

  const scoreBox = el('div', 'score');
  scoreBox.appendChild(el('span', 'score__label', 'SCORE'));
  scoreBox.appendChild(el('span', 'score__value', String(p.score)));
  root.appendChild(scoreBox);

  const stats = el('div', 'stats');
  for (const [label, value] of [
    ['SERVED', p.served],
    ['MISSED', p.missed],
  ] as const) {
    const s = el('div', 'stat');
    s.appendChild(el('span', 'stat__value', String(value)));
    s.appendChild(el('span', 'stat__label', label));
    stats.appendChild(s);
  }
  root.appendChild(stats);

  const actions = el('div', 'actions');
  const next = nextLevelId(p.levelId);
  if (next) {
    // Forward is the offer; playing the same level again is the fallback.
    const nextBtn = el('button', 'big-btn big-btn--hero', p.busy ? 'WAITING…' : 'NEXT LEVEL');
    nextBtn.type = 'button';
    nextBtn.disabled = p.busy;
    nextBtn.addEventListener('click', () => p.onNext(next));
    actions.appendChild(nextBtn);
  }
  const again = el(
    'button',
    next ? 'big-btn big-btn--ghost' : 'big-btn big-btn--hero',
    p.busy ? 'WAITING…' : 'PLAY AGAIN',
  );
  again.type = 'button';
  again.disabled = p.busy;
  again.addEventListener('click', () => p.onAgain());
  actions.appendChild(again);
  root.appendChild(actions);

  return root;
}
