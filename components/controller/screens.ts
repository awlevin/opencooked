// The controller's screens.
//
// Each screen is an object that builds its DOM once and then patches it in
// place from `update(props)`. That is the whole point: a phone repaints on
// every lobby broadcast, and rebuilding the screen each time made the level
// chooser blink — the element was thrown away and remounted, replaying the
// screen's fade-in from nothing, twice per tap. Only a change of *screen*
// swaps elements now; everything else is a text, class or canvas update.
//
// Every `update` is idempotent, so a broadcast that only echoes what is
// already shown costs nothing.

import { LEVELS, levelById, nextLevelId, worldOf } from '@/shared/levels';
import type { LobbyPlayer } from '@/shared/types';
import { controlsGuide, cookFlow } from './controls';
import { el } from './dom';
import { LevelPreview } from './preview';
import { rotateNote } from './rotate';

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

/** A mounted screen. The app swaps these only when the screen itself changes. */
export interface ScreenView<P> {
  readonly root: HTMLElement;
  update(props: P): void;
  destroy(): void;
}

/** Write text only if it differs: an unchanged node is never touched. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
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

export class JoinScreen implements ScreenView<JoinProps> {
  readonly root: HTMLElement;
  private props: JoinProps;
  private readonly codeInput: HTMLInputElement | null;
  private readonly nameInput: HTMLInputElement;
  private readonly submit: HTMLButtonElement;
  private readonly msg: HTMLElement;

  constructor(p: JoinProps) {
    this.props = p;
    this.root = el('div', 'screen screen--join');
    const card = el('form', 'card');
    card.setAttribute('novalidate', '');
    card.dataset.scroll = 'true';

    card.appendChild(el('div', 'brand', 'OPENCOOKED'));
    card.appendChild(el('div', 'brand__sub', 'PARTY'));
    card.appendChild(el('p', 'join-promise', 'Your phone becomes a gamepad. No download.'));

    if (p.roomLocked) {
      const badge = el('div', 'room-badge');
      badge.appendChild(el('span', 'room-badge__label', 'ROOM'));
      badge.appendChild(el('span', 'room-badge__code', p.room));
      card.appendChild(badge);
      const change = el('a', 'change-room', 'Wrong kitchen? Change code');
      change.href = '/join';
      card.appendChild(change);
      this.codeInput = null;
    } else {
      const field = el('label', 'field');
      field.appendChild(el('span', 'field__label', 'ROOM CODE'));
      const codeInput = el('input', 'input input--code');
      codeInput.value = p.room;
      codeInput.maxLength = MAX_CODE;
      codeInput.placeholder = '––––';
      codeInput.autocomplete = 'off';
      codeInput.spellcheck = false;
      codeInput.setAttribute('autocapitalize', 'characters');
      codeInput.setAttribute('autocorrect', 'off');
      codeInput.setAttribute('enterkeyhint', 'next');
      codeInput.addEventListener('input', () => {
        const cleaned = sanitizeCode(codeInput.value);
        if (codeInput.value !== cleaned) codeInput.value = cleaned;
      });
      field.appendChild(codeInput);
      card.appendChild(field);
      this.codeInput = codeInput;
    }

    const nameField = el('label', 'field');
    nameField.appendChild(el('span', 'field__label', 'CHEF NAME'));
    this.nameInput = el('input', 'input');
    this.nameInput.value = p.name;
    this.nameInput.maxLength = MAX_NAME;
    this.nameInput.placeholder = 'Chef';
    this.nameInput.setAttribute('autocomplete', 'nickname');
    this.nameInput.spellcheck = false;
    this.nameInput.setAttribute('autocapitalize', 'words');
    this.nameInput.setAttribute('autocorrect', 'off');
    this.nameInput.setAttribute('enterkeyhint', 'go');
    this.nameInput.addEventListener('input', () => {
      const cleaned = sanitizeName(this.nameInput.value);
      if (this.nameInput.value !== cleaned) this.nameInput.value = cleaned;
    });
    nameField.appendChild(this.nameInput);
    card.appendChild(nameField);

    this.submit = el('button', 'big-btn');
    this.submit.type = 'submit';
    card.appendChild(this.submit);

    // The message line is always in the layout, so a notice appearing does not
    // shove the form up under the player's thumb.
    this.msg = el('p', 'msg');
    this.msg.setAttribute('role', 'status');
    this.msg.setAttribute('aria-live', 'polite');
    card.appendChild(this.msg);

    card.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.props.busy) return;
      const room = this.props.roomLocked
        ? this.props.room
        : sanitizeCode(this.codeInput?.value ?? '');
      const name = sanitizeName(this.nameInput.value).trim();
      if (room.length !== MAX_CODE) {
        setText(this.msg, 'Enter the 4-letter code on the kitchen screen.');
        this.msg.classList.add('msg--error');
        this.msg.hidden = false;
        this.codeInput?.focus();
        return;
      }
      this.props.onSubmit(room, name || 'Chef');
    });

    this.root.appendChild(card);
    this.update(p);
  }

  update(p: JoinProps): void {
    this.props = p;
    // The inputs are never rewritten from props: the player is typing in them.
    setText(this.submit, p.busy ? 'JOINING…' : 'JOIN KITCHEN');
    this.submit.disabled = p.busy;
    const text = p.error ?? p.notice ?? '';
    setText(this.msg, text);
    this.msg.classList.toggle('msg--error', p.error !== null);
    this.msg.hidden = text === '';
  }

  destroy(): void {
    // Nothing to release: the listeners die with the element.
  }
}


/* ------------------------------ quick start ----------------------------- */

export interface TutorialProps {
  name: string;
  onReady: () => void;
}

export class TutorialScreen implements ScreenView<TutorialProps> {
  readonly root: HTMLElement;

  constructor(p: TutorialProps) {
    this.root = el('div', 'screen screen--tutorial');
    const head = el('div', 'tutorial-head');
    head.append(el('div', 'tutorial-kicker', `${p.name}, YOUR SHIFT STARTS NOW`));
    head.append(el('h1', 'tutorial-title', 'TWO THUMBS. ONE KITCHEN.'));
    head.append(el('p', 'msg tutorial-intro', 'Watch the big screen. Your phone stays a controller.'));
    this.root.appendChild(head);

    // The same picture the lobby folds away under "How to play", drawn big:
    // here it is the whole point of the screen rather than a reminder.
    const controls = controlsGuide();
    controls.classList.add('guide--big');
    this.root.appendChild(controls);
    this.root.appendChild(cookFlow());

    const actions = el('div', 'actions');
    const ready = el('button', 'big-btn big-btn--hero', 'GOT IT — LET’S COOK');
    ready.type = 'button';
    ready.addEventListener('click', p.onReady);
    actions.append(ready, el('p', 'msg', 'You can pause from the corner anytime.'));
    this.root.appendChild(actions);
  }

  update(_p: TutorialProps): void {}
  destroy(): void {}
}

/* ----------------------------- level chooser ---------------------------- */

/**
 * The kitchen chooser: one step back, one step forward, through every level of
 * every world in playing order, with a preview of where you are. Any chef may
 * move it and the TV follows — which is the whole reason it is two big arrows
 * and no menu.
 *
 * The world is named once, in the row between the arrows, and the card below
 * carries the level's own name and menu: naming the world twice in one control
 * reads as two controls.
 */
class LevelPicker {
  readonly root: HTMLElement;
  private readonly worldEl: HTMLElement;
  private readonly stepEl: HTMLElement;
  private readonly arrows: [HTMLButtonElement, HTMLButtonElement];
  private readonly preview = new LevelPreview();
  private levelId = '';

  constructor(private readonly select: (levelId: string) => void) {
    this.root = el('div', 'level-choose');

    const row = el('div', 'level-pick');
    const arrow = (label: string, delta: number): HTMLButtonElement => {
      const b = el('button', 'level-pick__arrow', label);
      b.type = 'button';
      b.setAttribute('aria-label', delta < 0 ? 'Previous kitchen' : 'Next kitchen');
      b.addEventListener('click', () => this.step(delta));
      return b;
    };
    const body = el('div', 'level-pick__body');
    this.worldEl = el('span', 'level-pick__world');
    this.stepEl = el('span', 'level-pick__step');
    body.append(this.worldEl, this.stepEl);
    this.arrows = [arrow('‹', -1), arrow('›', 1)];
    row.append(this.arrows[0], body, this.arrows[1]);

    this.root.append(row, this.preview.root);
  }

  /** Show a kitchen. Idempotent, so an echoed broadcast repaints nothing. */
  update(levelId: string): void {
    if (levelId === this.levelId) return;
    this.levelId = levelId;
    const i = LEVELS.findIndex((l) => l.id === levelId);
    this.arrows[0].disabled = i <= 0;
    this.arrows[1].disabled = i < 0 || i + 1 >= LEVELS.length;
    try {
      const level = levelById(levelId);
      setText(this.worldEl, worldOf(levelId)?.name ?? '');
      setText(this.stepEl, `${level.index} / ${level.count}`);
    } catch {
      // An id this build does not know: name it rather than show an empty row.
      setText(this.worldEl, levelId);
      setText(this.stepEl, '');
    }
    this.preview.setLevel(levelId);
  }

  destroy(): void {
    this.preview.destroy();
  }

  private step(delta: number): void {
    const i = LEVELS.findIndex((l) => l.id === this.levelId);
    const next = i < 0 ? undefined : LEVELS[i + delta];
    if (next) this.select(next.id);
  }
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
  /** Already sanitised, non-empty, and different from the name on the chip. */
  onRename: (name: string) => void;
}

/**
 * Tall enough to hold the how-to open in the column and still fit the roster,
 * the chooser and the start button without a scroll. Above it the panel sits
 * in the layout and starts open, because it costs nothing; at or below it the
 * panel floats over the roster as a sheet and starts folded (`.how` in
 * controller.css keys off the same number). A sheet covers what is behind it,
 * so it also has to close like one: the next tap anywhere else puts it away.
 */
const HOW_SHEET_MAX_HEIGHT = 880;

export class LobbyScreen implements ScreenView<LobbyProps> {
  readonly root: HTMLElement;
  private props: LobbyProps;
  private readonly dot: HTMLElement;
  private readonly chip: HTMLButtonElement;
  private readonly chefName: HTMLElement;
  private readonly nameForm: HTMLFormElement;
  private readonly nameInput: HTMLInputElement;
  private readonly roomLine: HTMLElement;
  private readonly roster: HTMLElement;
  private readonly start: HTMLButtonElement;
  private readonly startNote: HTMLElement;
  private readonly picker: LevelPicker;
  /** What the roster list was last built from; rebuilt only when it changes. */
  private rosterKey = '';
  private readonly how: HTMLDetailsElement;
  private readonly sheetQuery: MediaQueryList;
  private readonly onSheetChange: () => void;
  /** Installed only while the how-to floats over the screen as a sheet. */
  private onOutsideTap: ((e: PointerEvent) => void) | null = null;
  /** True while this chef is typing a new name into the chip. */
  private editing = false;

  constructor(p: LobbyProps) {
    this.props = p;
    this.root = el('div', 'screen screen--lobby');

    const head = el('div', 'lobby-head');
    head.appendChild(el('div', 'lobby-status', 'CONNECTED TO THE BIG SCREEN'));
    head.appendChild(el('h1', 'title', "You're in!"));
    // The chip is the rename control: the name a chef wants to change is the
    // one thing on this screen already big enough to aim a thumb at.
    this.chip = el('button', 'chef-chip chef-chip--edit');
    this.chip.type = 'button';
    this.chip.setAttribute('aria-label', 'Change your chef name');
    this.dot = el('span', 'chef-chip__dot');
    this.chefName = el('span', 'chef-chip__name');
    this.chip.append(this.dot, this.chefName, el('span', 'chef-chip__pen', '✎'));
    this.chip.addEventListener('click', () => this.beginEdit());
    head.appendChild(this.chip);

    // The editor stands exactly where the chip stood, rather than opening a
    // dialog: nothing below it may move while somebody is typing.
    this.nameForm = el('form', 'rename');
    this.nameForm.hidden = true;
    this.nameForm.setAttribute('novalidate', '');
    this.nameInput = el('input', 'input input--name');
    this.nameInput.maxLength = MAX_NAME;
    this.nameInput.placeholder = 'Chef';
    this.nameInput.setAttribute('aria-label', 'Chef name');
    this.nameInput.setAttribute('autocomplete', 'nickname');
    this.nameInput.spellcheck = false;
    this.nameInput.setAttribute('autocapitalize', 'words');
    this.nameInput.setAttribute('autocorrect', 'off');
    this.nameInput.setAttribute('enterkeyhint', 'done');
    this.nameInput.addEventListener('input', () => {
      const cleaned = sanitizeName(this.nameInput.value);
      if (this.nameInput.value !== cleaned) this.nameInput.value = cleaned;
    });
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.endEdit(false);
    });
    // Tapping away keeps what was typed: a phone keyboard that dismisses
    // itself must not throw the new name away.
    this.nameInput.addEventListener('blur', () => this.endEdit(true));
    const save = el('button', 'rename__ok', '✓');
    save.type = 'submit';
    save.setAttribute('aria-label', 'Save name');
    this.nameForm.append(this.nameInput, save);
    this.nameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.endEdit(true);
    });
    head.appendChild(this.nameForm);

    this.roomLine = el('p', 'msg');
    head.appendChild(this.roomLine);
    head.appendChild(rotateNote()); // portrait only; asks before the whistle
    this.root.appendChild(head);

    const rosterWrap = el('div', 'roster-wrap');
    rosterWrap.dataset.scroll = 'true';
    // A label for the list, not a tally: the head count belongs next to the
    // start button, where it is a reason to press it.
    this.roster = el('ul', 'roster');
    rosterWrap.append(el('div', 'roster__count', 'IN THE KITCHEN'), this.roster);
    this.root.appendChild(rosterWrap);

    this.sheetQuery = window.matchMedia(`(max-height: ${HOW_SHEET_MAX_HEIGHT}px)`);
    this.how = this.howToPlay();
    // A phone turned on its side changes which of the two the panel is, so it
    // goes back to what that shape starts with rather than being left as a
    // sheet nobody asked for — or as a column item there is no room for.
    this.onSheetChange = () => {
      this.how.open = !this.isSheet();
    };
    this.sheetQuery.addEventListener('change', this.onSheetChange);
    this.root.appendChild(this.how);

    const actions = el('div', 'actions');
    this.picker = new LevelPicker((levelId) => this.props.onSelect(levelId));
    this.start = el('button', 'big-btn big-btn--hero big-btn--go');
    this.start.type = 'button';
    this.start.addEventListener('click', () => {
      // A second tap while the first is in flight starts nothing and looks
      // broken. The server ignores it, so never send it.
      if (!this.props.busy) this.props.onStart();
    });
    this.startNote = el('p', 'msg start-note');
    actions.append(this.picker.root, this.start, this.startNote);
    this.root.appendChild(actions);

    this.update(p);
  }

  update(p: LobbyProps): void {
    this.props = p;
    // Never while the chef is typing: this runs on every lobby broadcast, and
    // the name in props is the old one until the server has agreed.
    if (!this.editing) setText(this.chefName, p.name);
    if (this.dot.style.background !== p.color) this.dot.style.background = p.color;
    setText(this.roomLine, `Room ${p.room} · look for your colour on the TV`);
    this.setRoster(p.players, p.playerId);
    this.picker.update(p.levelId);

    const chefs = p.players.length;
    setText(this.start, p.busy ? 'STARTING…' : 'START COOKING');
    this.start.disabled = p.busy;
    setText(
      this.startNote,
      p.busy
        ? 'Firing up the kitchen…'
        : `Anyone can start · ${chefs} chef${chefs === 1 ? '' : 's'} ready`,
    );
  }

  destroy(): void {
    this.sheetQuery.removeEventListener('change', this.onSheetChange);
    this.watchOutsideTap(false);
    this.picker.destroy();
  }

  /**
   * The pad, explained where the waiting happens. On a big phone it sits in
   * the column, open, because it costs nothing there. On anything smaller it
   * is folded away, and opening it floats it over the roster so the chooser
   * and the start button never move.
   */
  private howToPlay(): HTMLDetailsElement {
    const how = el('details', 'how');
    const summary = el('summary', 'how__summary');
    summary.append(el('span', 'how__label', 'How to play'), el('span', 'how__chevron', '▾'));
    // One body under the summary: on a short screen the whole of it lifts off
    // the column as a sheet, and a wrapper is what makes that one rule.
    const body = el('div', 'how__body');
    body.append(controlsGuide(), cookFlow());
    how.append(summary, body);
    how.open = !this.isSheet();
    how.addEventListener('toggle', () => this.watchOutsideTap(how.open && this.isSheet()));
    return how;
  }

  /** True when the how-to is floating rather than sitting in the column. */
  private isSheet(): boolean {
    return this.sheetQuery.matches;
  }

  /**
   * While the sheet is up it covers the chef chip and the roster, so anything
   * a thumb lands on out there means "put this away" — not "nothing happened".
   */
  private watchOutsideTap(on: boolean): void {
    if (on === (this.onOutsideTap !== null)) return;
    if (on) {
      this.onOutsideTap = (e: PointerEvent) => {
        const target = e.target;
        if (target instanceof Node && this.how.contains(target)) return;
        this.how.open = false;
      };
      // Capture: the tap must close the sheet even where something under it
      // stops the event on its way back up.
      document.addEventListener('pointerdown', this.onOutsideTap, true);
      return;
    }
    if (this.onOutsideTap) document.removeEventListener('pointerdown', this.onOutsideTap, true);
    this.onOutsideTap = null;
  }

  /* ------------------------------- renaming ------------------------------ */

  private beginEdit(): void {
    if (this.editing) return;
    this.editing = true;
    this.chip.hidden = true;
    this.nameForm.hidden = false;
    this.nameInput.value = this.props.name;
    this.nameInput.focus();
    this.nameInput.select();
  }

  /**
   * Put the chip back. An empty box, an unchanged name, or an Escape sends
   * nothing: the server's answer would be a broadcast repainting what is
   * already on the screen.
   */
  private endEdit(commit: boolean): void {
    if (!this.editing) return;
    this.editing = false;
    const typed = sanitizeName(this.nameInput.value).trim();
    this.nameForm.hidden = true;
    this.chip.hidden = false;
    setText(this.chefName, this.props.name);
    if (commit && typed && typed !== this.props.name) this.props.onRename(typed);
  }

  private setRoster(players: LobbyPlayer[], playerId: string): void {
    const key = players.map((p) => `${p.id}\u0000${p.name}\u0000${p.color}`).join('\u0001') + `|${playerId}`;
    if (key === this.rosterKey) return;
    this.rosterKey = key;

    this.roster.textContent = '';
    for (const pl of players) {
      const li = el('li', 'roster__item' + (pl.id === playerId ? ' is-me' : ''));
      const d = el('span', 'roster__dot');
      d.style.background = pl.color;
      li.append(d, el('span', 'roster__name', pl.name));
      this.roster.appendChild(li);
    }
    if (players.length === 0) {
      this.roster.appendChild(el('li', 'roster__empty', 'Waiting for chefs…'));
    }
  }
}

/* -------------------------------- paused -------------------------------- */

export interface PausedProps {
  /** Who stopped the kitchen. Null is never rendered — the app unmounts first. */
  by: LobbyPlayer | null;
  /** True when this phone is the one that paused, so the copy reads right. */
  mine: boolean;
  onResume: () => void;
}

/**
 * What every phone shows while the kitchen is stopped. It replaces the pad
 * outright rather than covering it: a live joystick under a modal is a way to
 * walk into a fire you cannot see.
 */
export class PausedScreen implements ScreenView<PausedProps> {
  readonly root: HTMLElement;
  private props: PausedProps;
  private readonly dot: HTMLElement;
  private readonly who: HTMLElement;
  private readonly resume: HTMLButtonElement;

  constructor(p: PausedProps) {
    this.props = p;
    this.root = el('div', 'screen screen--paused');

    // Head in the middle of the screen, action at the bottom: the same shape
    // as the lobby, so RESUME lands where START did — under the thumb.
    const head = el('div', 'paused-head');
    head.appendChild(el('h1', 'title paused-title', 'PAUSED'));

    const chip = el('div', 'chef-chip');
    this.dot = el('span', 'chef-chip__dot');
    this.who = el('span', 'chef-chip__name');
    chip.append(this.dot, this.who);
    head.appendChild(chip);
    this.root.appendChild(head);

    const actions = el('div', 'actions');
    this.resume = el('button', 'big-btn big-btn--hero');
    this.resume.type = 'button';
    this.resume.textContent = 'RESUME';
    this.resume.addEventListener('click', () => this.props.onResume());
    actions.append(this.resume, el('p', 'msg', 'Any chef can resume.'));
    this.root.appendChild(actions);

    this.update(p);
  }

  update(p: PausedProps): void {
    this.props = p;
    const name = p.by?.name ?? 'A chef';
    const color = p.by?.color ?? '';
    setText(this.who, p.mine ? 'You paused' : `${name} paused`);
    if (color && this.dot.style.background !== color) this.dot.style.background = color;
  }

  destroy(): void {
    // Nothing to release: the listener dies with the element.
  }
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

export class GameOverScreen implements ScreenView<GameOverProps> {
  readonly root: HTMLElement;
  private props: GameOverProps;
  private readonly score: HTMLElement;
  private readonly served: HTMLElement;
  private readonly missed: HTMLElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly again: HTMLButtonElement;
  private readonly preview = new LevelPreview({ label: 'Up next', compact: true });
  private next: string | null = null;

  constructor(p: GameOverProps) {
    this.props = p;
    this.root = el('div', 'screen screen--over');
    this.root.appendChild(el('h1', 'title', 'SERVICE OVER'));

    const scoreBox = el('div', 'score');
    this.score = el('span', 'score__value');
    scoreBox.append(el('span', 'score__label', 'SCORE'), this.score);
    this.root.appendChild(scoreBox);

    const stats = el('div', 'stats');
    this.served = el('span', 'stat__value');
    this.missed = el('span', 'stat__value');
    for (const [label, value] of [
      ['SERVED', this.served],
      ['MISSED', this.missed],
    ] as const) {
      const s = el('div', 'stat');
      s.append(value, el('span', 'stat__label', label));
      stats.appendChild(s);
    }
    this.root.appendChild(stats);

    const actions = el('div', 'actions');
    // Forward is the offer, so the kitchen it leads to is shown with it;
    // playing the same level again is the fallback underneath.
    this.nextBtn = el('button', 'big-btn big-btn--hero');
    this.nextBtn.type = 'button';
    this.nextBtn.addEventListener('click', () => {
      if (this.next) this.props.onNext(this.next);
    });
    this.again = el('button', 'big-btn');
    this.again.type = 'button';
    this.again.addEventListener('click', () => this.props.onAgain());
    actions.append(this.preview.root, this.nextBtn, this.again);
    this.root.appendChild(actions);

    this.update(p);
  }

  update(p: GameOverProps): void {
    this.props = p;
    setText(this.score, String(p.score));
    setText(this.served, String(p.served));
    setText(this.missed, String(p.missed));

    this.next = nextLevelId(p.levelId);
    this.nextBtn.hidden = this.next === null;
    this.preview.root.hidden = this.next === null;
    if (this.next) this.preview.setLevel(this.next);
    setText(this.nextBtn, p.busy ? 'WAITING…' : 'NEXT LEVEL');
    this.nextBtn.disabled = p.busy;

    setText(this.again, p.busy ? 'WAITING…' : 'PLAY AGAIN');
    this.again.disabled = p.busy;
    this.again.className = this.next ? 'big-btn big-btn--ghost' : 'big-btn big-btn--hero';
  }

  destroy(): void {
    this.preview.destroy();
  }
}
