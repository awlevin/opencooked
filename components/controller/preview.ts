// The level preview on the phone: the same picture the TV shows, thumb-sized.
//
// Two things make this worth its own file. The box is fixed and the map is
// letterboxed inside it, so stepping from an 11x7 kitchen to a 15x8 one never
// moves the START button under a thumb. And the swap is a crossfade between
// two stacked canvases: the outgoing picture stays put at full opacity while
// the incoming one fades in on top of it, so there is never a frame with
// nothing in the box.

import type { Level } from '@/shared/levels';
import { levelById, themeOf } from '@/shared/levels';
import { drawMiniMap, menuLine } from '@/shared/levels/minimap';
import { el } from './dom';

export interface PreviewOptions {
  /** Small eyebrow above the map, e.g. "UP NEXT". Omitted when empty. */
  label?: string;
  /** Shorter box, for screens that have other things to say. */
  compact?: boolean;
}

export class LevelPreview {
  readonly root: HTMLElement;
  private readonly box: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly menuEl: HTMLElement;
  private readonly info: HTMLElement;
  /** [showing, spare] — the spare is where the next kitchen is painted. */
  private canvases: [HTMLCanvasElement, HTMLCanvasElement];
  private observer: ResizeObserver | null = null;
  private level: Level | null = null;
  private levelId = '';
  private painted = false;

  constructor(options: PreviewOptions = {}) {
    this.root = el('div', 'level-preview' + (options.compact ? ' level-preview--compact' : ''));
    if (options.label) this.root.appendChild(el('div', 'level-preview__label', options.label));

    this.box = el('div', 'level-preview__map');
    const a = el('canvas', 'level-preview__canvas is-on');
    const b = el('canvas', 'level-preview__canvas');
    this.box.append(a, b);
    this.canvases = [a, b];
    this.root.appendChild(this.box);

    this.info = el('div', 'level-preview__info');
    this.nameEl = el('div', 'level-preview__name');
    this.menuEl = el('div', 'level-preview__menu');
    this.info.append(this.nameEl, this.menuEl);
    this.root.appendChild(this.info);

    // The box has no size until it is in the layout, and it changes size when
    // the phone is turned. Repaint from the box, not from a guess.
    this.observer = new ResizeObserver(() => this.paint(false));
    this.observer.observe(this.box);
  }

  /** Show a kitchen. Idempotent: the same id twice repaints nothing. */
  setLevel(levelId: string): void {
    if (levelId === this.levelId) return;
    let level: Level;
    try {
      level = levelById(levelId);
    } catch {
      return; // an id this build does not know: keep showing the last one
    }
    this.levelId = levelId;
    this.level = level;
    this.nameEl.textContent = level.name;
    this.menuEl.textContent = menuLine(level);
    // Replay the little rise on the text, so the words and the map change
    // together rather than the map alone looking animated.
    this.info.classList.remove('is-fresh');
    void this.info.offsetWidth; // reflow: without it the class re-add is a no-op
    this.info.classList.add('is-fresh');
    this.paint(this.painted);
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * Paint the current level. `crossfade` brings the new picture up over the
   * old one; a resize repaints in place instead, which must not animate.
   */
  private paint(crossfade: boolean): void {
    const level = this.level;
    if (!level) return;
    const w = this.box.clientWidth;
    const h = this.box.clientHeight;
    if (w <= 0 || h <= 0) return;

    const [showing, spare] = this.canvases;
    const target = crossfade ? spare : showing;
    // Device pixels, so the map is crisp on a 3x phone screen.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (target.width !== pw || target.height !== ph) {
      target.width = pw;
      target.height = ph;
    }
    const c = target.getContext('2d');
    if (!c) return;
    drawMiniMap(c, level, themeOf(level.worldId), pw, ph);
    this.painted = true;

    if (!crossfade) return;
    // Stack the new picture on top and fade it in. The old one is left fully
    // opaque underneath, so the box is never empty and never dims mid-swap.
    this.box.appendChild(spare);
    spare.classList.add('is-instant'); // hide it with no transition of its own
    spare.classList.remove('is-on');
    void spare.offsetWidth; // reflow, so the fade starts from 0 and not from 1
    spare.classList.remove('is-instant');
    spare.classList.add('is-on');
    this.canvases = [spare, showing];
  }
}
