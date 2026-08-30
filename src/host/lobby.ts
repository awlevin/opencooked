// Lobby / title screen: room code, QR to the join URL, and the chef roster.

import { toCanvas } from 'qrcode';
import type { LobbyPlayer } from '../../shared/types';

const QR_PIXELS = 760; // rendered large, displayed small = crisp on a TV

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

export class LobbyScreen {
  private readonly codeEl = el<HTMLDivElement>('roomCode');
  private readonly urlEl = el<HTMLDivElement>('joinUrl');
  private readonly qrEl = el<HTMLCanvasElement>('qr');
  private readonly rosterEl = el<HTMLDivElement>('roster');
  private readonly chips = new Map<string, HTMLElement>();
  private qrUrl = '';

  constructor() {
    this.reset();
  }

  reset(): void {
    this.codeEl.textContent = '····';
    this.codeEl.classList.add('pending');
    this.urlEl.textContent = 'connecting…';
    this.qrUrl = '';
    const c = this.qrEl.getContext('2d');
    if (c) c.clearRect(0, 0, this.qrEl.width, this.qrEl.height);
    this.setPlayers([]);
  }

  setRoom(code: string, joinUrl: string): void {
    this.codeEl.textContent = code.toUpperCase();
    this.codeEl.classList.remove('pending');
    this.urlEl.textContent = joinUrl.replace(/^https?:\/\//, '');
    if (joinUrl === this.qrUrl) return;
    this.qrUrl = joinUrl;
    void toCanvas(this.qrEl, joinUrl, {
      width: QR_PIXELS,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#2a1710ff', light: '#ffffffff' },
    })
      .then(() => {
        // The library pins an inline pixel size; drop it so our CSS decides
        // how big the code is on screen (the bitmap stays high-res).
        this.qrEl.style.removeProperty('width');
        this.qrEl.style.removeProperty('height');
      })
      .catch(() => {
        this.urlEl.textContent = joinUrl;
      });
  }

  setPlayers(players: LobbyPlayer[]): void {
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
        chip.append(dot, name);
        this.chips.set(p.id, chip);
        this.rosterEl.append(chip);
      }
      chip.style.setProperty('--c', p.color);
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
