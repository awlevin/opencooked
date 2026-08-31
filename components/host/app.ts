// Host (TV) bootstrap: owns the socket, swaps between the three screens,
// and feeds snapshots to the canvas renderer.
//
// Imperative on purpose — the kitchen is a 60 fps canvas, not a React tree.
// `mountHostApp` is called from a `useEffect`, so nothing here runs on the
// server, and the returned disposer tears down every socket, timer, frame
// loop, peer connection and listener (React StrictMode mounts twice in dev).
//
// Local mode. Where a browser can do WebRTC, this tab asks the server for the
// sim (`claim-sim`), stands the real `Room` up in-tab from the seed the server
// sends back, and offers every chef a direct RTCDataChannel. Phones that take
// it get ~3 ms input; phones that cannot are relayed through the server to
// this tab and play exactly as well as they did before. Either way this file
// speaks one protocol — `S2C` in, `C2S` out — and mostly cannot tell which
// side of the room it is talking to.

import { asBusEnv } from '@/realtime/bridge';
import { connFromDataChannel } from '@/realtime/conn';
import { HostSim } from '@/realtime/host';
import type { S2C } from '@/shared/protocol';
import type { Phase } from '@/shared/types';
import { q } from './dom';
import { GameOverScreen } from './gameover';
import { LobbyScreen } from './lobby';
import { HostNet, type NetStatus } from './net';
import { PeerHub, peerSupported } from './peers';
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
  /** The room running in this tab, once the server hands us the sim. */
  let sim: HostSim | null = null;
  // Last figures seen in a snapshot, used if `gameover` ever arrives first.
  let tally = { score: 0, served: 0, missed: 0 };

  /** True for a chef whose phone is wired straight into this tab. */
  const isLocal = (id: string): boolean => sim?.isPeerSeat(id) === true;
  buffer.setLocalCheck(isLocal);

  // Under ?debug only: let an automated test read what the sim actually
  // believes, so "input over the DataChannel moved the chef" is assertable
  // without reaching into module internals. Never present in normal play.
  if (debug) {
    (window as unknown as Record<string, unknown>).__ocDebug = {
      snapshot: () => buffer.latest,
      isLocal,
    };
  }

  const hub = new PeerHub({
    signal: (to, data) => sim?.send({ t: 'signal', to, data }),
    // Hand the channel over as an ordinary connection and let the phone claim
    // its seat on it with its seat token — the same reclaim path a reconnect
    // uses, which is why the chef and everything it is holding survive.
    adopt: (_playerId, ch) => sim?.attachPeer(connFromDataChannel(ch)),
  });

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

  // --- local mode ----------------------------------------------------------

  function stopSim(): void {
    hub.setRoster([]);
    sim?.stop();
    sim = null;
  }

  /**
   * The server answered `claim-sim` with everything needed to stand the room
   * up here: its seats and their tokens, plus the round in flight if there is
   * one. A tab that is already running this room ignores the seed — it has
   * been simulating the whole time and its copy is the fresher one.
   */
  function startSim(env: ReturnType<typeof asBusEnv>): void {
    if (!env || env.k !== 'seed' || sim || roomCode === null) return;
    const code = roomCode;
    const next = new HostSim(code, {
      toServer: (out) => net.send({ t: 'bus', env: out }),
      onMessage: handle,
    });
    sim = next;
    void next
      .start(env.rec, env.snap)
      .then((ok) => {
        if (!ok && sim === next) {
          sim = null;
          next.stop();
        }
      })
      .catch((err) => {
        console.error('[host] could not take the sim:', err);
        if (sim === next) {
          sim = null;
          next.stop();
        }
      });
  }

  function onRoom(code: string): void {
    const upper = code.toUpperCase();
    // A different code means the resume failed and the server minted a fresh
    // room — drop the old round rather than showing a stale one.
    if (roomCode !== null && upper !== roomCode) {
      stopSim();
      resetToLobby();
    }
    roomCode = upper;
    net.setResumeRoom(upper);
    lobby.setRoom(upper);
    // Ask for the sim on every (re)connect. A tab that already owns this room
    // is re-claiming what it never stopped running; the server holds off on
    // taking the round back until it hears this.
    if (peerSupported()) net.send({ t: 'claim-sim' });
  }

  // --- messages ------------------------------------------------------------

  /** Game traffic, from whichever side of the room is authoritative. */
  function handle(msg: S2C): void {
    switch (msg.t) {
      case 'lobby':
        lobby.setPlayers(msg.players, isLocal);
        // Only chase peer connections for a room we are actually running.
        hub.setRoster(sim?.running ? msg.players.map((p) => p.id) : []);
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
      case 'signal':
        hub.accept(msg.from, msg.data);
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
        // 'room', 'sim' and 'bus' are the socket's business; 'joined' and
        // 'buzz' are a controller's.
        break;
    }
  }

  /** Everything arriving on the socket. */
  function fromServer(msg: S2C): void {
    switch (msg.t) {
      case 'room':
        onRoom(msg.code);
        return;
      case 'sim':
        // The server took the round back (we were away too long, or this
        // browser cannot run local mode). Its snapshots are the truth again.
        if (msg.owner === 'server') stopSim();
        return;
      case 'bus':
        if (sim) sim.fromServer(msg.env);
        else startSim(asBusEnv(msg.env));
        return;
      case 'err':
        handle(msg);
        return;
      default:
        // While we run the sim, the server's copy of the game is a frozen
        // shadow of ours. Ours is the one on screen.
        if (!sim?.running) handle(msg);
    }
  }

  const net = new HostNet({ onStatus: setStatus, onMessage: fromServer });

  root.dataset.screen = 'lobby';
  paintStatus();
  net.connect();

  return () => {
    if (errTimer !== null) clearTimeout(errTimer);
    hub.dispose();
    stopSim();
    net.dispose();
    view.destroy();
  };
}
