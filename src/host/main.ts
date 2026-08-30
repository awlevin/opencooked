// Host (TV) entry point: owns the socket, swaps between the three screens,
// and feeds snapshots to the canvas renderer.

import type { S2C } from '../../shared/protocol';
import type { Phase } from '../../shared/types';
import { GameOverScreen } from './gameover';
import { LobbyScreen } from './lobby';
import { HostNet, type NetStatus } from './net';
import { GameView } from './render/game';
import { SnapshotBuffer } from './state';

const debug = location.search.toLowerCase().includes('debug');

const stage = document.getElementById('stage') as HTMLCanvasElement | null;
if (!stage) throw new Error('missing #stage canvas');

const lobby = new LobbyScreen();
const over = new GameOverScreen();
const buffer = new SnapshotBuffer();
const view = new GameView(stage, buffer, debug);

const connEl = document.getElementById('conn');
const connMsgEl = document.getElementById('connMsg');

let phase: Phase = 'lobby';
// Last figures seen in a snapshot, used if `gameover` ever arrives first.
let tally = { score: 0, served: 0, missed: 0 };

function setPhase(next: Phase): void {
  if (next === phase) return;
  phase = next;
  document.body.dataset.screen = next;
  if (next === 'playing') {
    view.start();
  } else {
    view.stop();
    if (next === 'lobby') buffer.clear();
  }
}

function setStatus(status: NetStatus): void {
  if (!connEl || !connMsgEl) return;
  connEl.classList.toggle('show', status !== 'open');
  connMsgEl.textContent =
    status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
}

function handle(msg: S2C): void {
  switch (msg.t) {
    case 'room':
      lobby.setRoom(msg.code, msg.joinUrl);
      break;
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
      if (connEl && connMsgEl) {
        connEl.classList.add('show');
        connMsgEl.textContent = msg.msg;
        window.setTimeout(() => setStatus('open'), 4000);
      }
      break;
    default:
      // 'joined' and 'buzz' are controller-only.
      break;
  }
}

const net = new HostNet({
  onStatus: setStatus,
  onMessage: handle,
  onReset: () => {
    // Fresh socket means a fresh room; start over from the title screen.
    buffer.clear();
    lobby.reset();
    setPhase('lobby');
    document.body.dataset.screen = 'lobby';
  },
});

net.connect();
