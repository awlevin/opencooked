// Host (TV) bootstrap: owns the socket, swaps between the three screens,
// and feeds snapshots to the canvas renderer.
//
// Imperative on purpose — the kitchen is a 60 fps canvas, not a React tree.
// `mountHostApp` is called from a `useEffect`, so nothing here runs on the
// server, and the returned disposer tears down every socket, timer, frame
// loop and listener (React StrictMode mounts twice in development).

import type { S2C } from '@/shared/protocol';
import type { Phase } from '@/shared/types';
import { q } from './dom';
import { GameOverScreen } from './gameover';
import { LobbyScreen } from './lobby';
import { HostNet, type NetStatus } from './net';
import { GameView } from './render/game';
import { setFontFamily } from './render/theme';
import { SnapshotBuffer } from './state';

export interface HostAppOptions {
  /** Resolved `next/font` family, so canvas text matches the DOM screens. */
  fontFamily?: string;
}

const ERR_PILL_MS = 4000;

export function mountHostApp(
  root: HTMLElement,
  options: HostAppOptions = {},
): () => void {
  setFontFamily(options.fontFamily ?? null);

  const debug = location.search.toLowerCase().includes('debug');

  const stage = q<HTMLCanvasElement>(root, '[data-el="stage"]');
  const connEl = q<HTMLElement>(root, '[data-el="conn"]');
  const connMsgEl = q<HTMLElement>(root, '[data-el="connMsg"]');

  const lobby = new LobbyScreen(root);
  const over = new GameOverScreen(root);
  const buffer = new SnapshotBuffer();
  const view = new GameView(stage, buffer, debug);

  let phase: Phase = 'lobby';
  let status: NetStatus = 'connecting';
  let errTimer: number | null = null;
  /** Room code the server last gave us; also what we resume with. */
  let roomCode: string | null = null;
  // Last figures seen in a snapshot, used if `gameover` ever arrives first.
  let tally = { score: 0, served: 0, missed: 0 };

  function setPhase(next: Phase): void {
    if (next === phase) return;
    phase = next;
    root.dataset.screen = next;
    if (next === 'playing') {
      view.start();
    } else {
      view.stop();
      if (next === 'lobby') buffer.clear();
    }
  }

  function paintStatus(): void {
    connEl.classList.toggle('show', status !== 'open');
    connMsgEl.textContent =
      status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  }

  function setStatus(next: NetStatus): void {
    status = next;
    if (errTimer !== null) {
      clearTimeout(errTimer);
      errTimer = null;
    }
    paintStatus();
  }

  /** A brand-new room: forget everything and go back to the title screen. */
  function resetToLobby(): void {
    buffer.clear();
    lobby.reset();
    tally = { score: 0, served: 0, missed: 0 };
    view.stop();
    phase = 'lobby';
    root.dataset.screen = 'lobby';
  }

  function handle(msg: S2C): void {
    switch (msg.t) {
      case 'room': {
        const code = msg.code.toUpperCase();
        // A different code means the resume failed and the server minted a
        // fresh room — drop the old round rather than showing a stale one.
        if (roomCode !== null && code !== roomCode) resetToLobby();
        roomCode = code;
        net.setResumeRoom(code);
        lobby.setRoom(code);
        break;
      }
      case 'lobby':
        lobby.setPlayers(msg.players);
        break;
      case 'phase':
        // If the server only announces the phase, fall back to the last
        // figures we saw in a snapshot so the results screen is never blank.
        if (msg.phase === 'gameover') {
          over.show(tally.score, tally.served, tally.missed);
        }
        setPhase(msg.phase);
        break;
      case 'state':
        tally = {
          score: msg.s.score,
          served: msg.s.served,
          missed: msg.s.missed,
        };
        buffer.push(msg.s);
        // Snapshots carry the authoritative phase too; trust it.
        setPhase(msg.s.phase);
        break;
      case 'gameover':
        tally = {
          score: msg.score,
          served: msg.served,
          missed: msg.missed,
        };
        over.show(msg.score, msg.served, msg.missed);
        setPhase('gameover');
        break;
      case 'err':
        connEl.classList.add('show');
        connMsgEl.textContent = msg.msg;
        if (errTimer !== null) clearTimeout(errTimer);
        errTimer = window.setTimeout(() => {
          errTimer = null;
          paintStatus();
        }, ERR_PILL_MS);
        break;
      default:
        // 'joined' and 'buzz' are controller-only.
        break;
    }
  }

  const net = new HostNet({ onStatus: setStatus, onMessage: handle });

  root.dataset.screen = 'lobby';
  paintStatus();
  net.connect();

  return () => {
    if (errTimer !== null) clearTimeout(errTimer);
    net.dispose();
    view.destroy();
  };
}
