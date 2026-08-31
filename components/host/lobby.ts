// Lobby / title screen: room code, QR to the join URL, and the chef roster.
//
// The join URL is built here, on the client, from the page's own origin —
// the server never sees it. `/join?room=CODE` is the controller route.

import type { LobbyPlayer } from '@/shared/types';
import { q } from './dom';

const QR_PIXELS = 760; // rendered large, displayed small = crisp on a TV

/** `${location.origin}/join?room=CODE` — what the QR encodes. */
export function joinUrlFor(code: string): string {
  return `${location.origin}/join?room=${encodeURIComponent(code)}`;
}

export class LobbyScreen {
  private readonly codeEl: HTMLDivElement;
  private readonly urlEl: HTMLDivElement;
  private readonly qrEl: HTMLCanvasElement;
  private readonly rosterEl: HTMLDivElement;
  private readonly chips = new Map<string, HTMLElement>();
  private qrUrl = '';
  /** Bumped on every reset so a late QR render cannot paint a dead code. */
  private qrGen = 0;

  constructor(root: ParentNode) {
    this.codeEl = q<HTMLDivElement>(root, '[data-el="roomCode"]');
    this.urlEl = q<HTMLDivElement>(root, '[data-el="joinUrl"]');
    this.qrEl = q<HTMLCanvasElement>(root, '[data-el="qr"]');
    this.rosterEl = q<HTMLDivElement>(root, '[data-el="roster"]');
    this.reset();
  }

  reset(): void {
    this.qrGen += 1;
    this.codeEl.textContent = '····';
    this.codeEl.classList.add('pending');
    this.urlEl.textContent = 'connecting…';
    this.qrUrl = '';
    const c = this.qrEl.getContext('2d');
    if (c) c.clearRect(0, 0, this.qrEl.width, this.qrEl.height);
    this.setPlayers([]);
  }

  setRoom(code: string): void {
    const joinUrl = joinUrlFor(code);
    this.codeEl.textContent = code.toUpperCase();
    this.codeEl.classList.remove('pending');
    this.urlEl.textContent = joinUrl.replace(/^https?:\/\//, '');
    if (joinUrl === this.qrUrl) return;
    this.qrUrl = joinUrl;

    const gen = this.qrGen;
    // qrcode is browser-only and chunky; keep it out of the first paint.
    void import('qrcode')
      .then(({ toCanvas }) =>
        toCanvas(this.qrEl, joinUrl, {
          width: QR_PIXELS,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#2a1710ff', light: '#ffffffff' },
        }),
      )
      .then(() => {
        if (gen !== this.qrGen) return;
        // The library pins an inline pixel size; drop it so our CSS decides
        // how big the code is on screen (the bitmap stays high-res).
        this.qrEl.style.removeProperty('width');
        this.qrEl.style.removeProperty('height');
      })
      .catch(() => {
        if (gen !== this.qrGen) return;
        this.urlEl.textContent = joinUrl;
      });
  }

  /**
   * `isLocal` marks the chefs whose phones are wired straight into this tab.
   * No toggle and no explanation: a small bolt on the chip, so the speed is
   * visible without ever being a decision the player has to make.
   */
  setPlayers(players: LobbyPlayer[], isLocal: (id: string) => boolean = () => false): void {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      let chip = this.chips.get(p.id);
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'chef';
        const dot = document.createElement('span');
        dot.className = 'dot';
        const name = document.createElement('span');
        name.className = 'nm';
        const bolt = document.createElement('span');
        bolt.className = 'bolt';
        bolt.textContent = '⚡';
        bolt.title = 'Playing over the local network';
        chip.append(dot, name, bolt);
        this.chips.set(p.id, chip);
        this.rosterEl.append(chip);
      }
      chip.style.setProperty('--c', p.color);
      chip.classList.toggle('is-local', isLocal(p.id));
      const nameEl = chip.querySelector('.nm');
      if (nameEl && nameEl.textContent !== p.name) nameEl.textContent = p.name;
    }

    for (const [id, chip] of this.chips) {
      if (!seen.has(id)) {
        chip.remove();
        this.chips.delete(id);
      }
    }

    const waiting = this.rosterEl.querySelector('.waiting');
    if (players.length === 0 && !waiting) {
      const ghost = document.createElement('div');
      ghost.className = 'waiting';
      ghost.textContent = 'Waiting for chefs…';
      this.rosterEl.append(ghost);
    } else if (players.length > 0 && waiting) {
      waiting.remove();
    }
  }
}
