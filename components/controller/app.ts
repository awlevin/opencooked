// Controller app: screen state machine + protocol wiring.
//
// This is an imperative app mounted into a React tree by app/join/page.tsx.
// It owns raw DOM because a gamepad must never have a control rebuilt under a
// live finger, which is exactly what a re-render would do. The contract with
// React is small: `new ControllerApp(root).start()` on mount, `.destroy()` on
// unmount — and destroy must be total, because StrictMode mounts twice and a
// leaked socket would join the room twice.

import type { S2C } from '@/shared/protocol';
import type { LobbyPlayer, Phase, Vec2 } from '@/shared/types';
import { clear, el } from './dom';
import { GamepadView } from './gamepad';
import { Net, type NetStatus } from './net';
import {
  buzz,
  loadName,
  loadRoom,
  lockGestures,
  releaseWakeLock,
  requestWakeLock,
  saveName,
  saveRoom,
} from './platform';
import { gameOverScreen, joinScreen, lobbyScreen, sanitizeCode } from './screens';
import { applyAccent, DEFAULT_ACCENT, resetAccent } from './theme';

type Screen = 'join' | 'lobby' | 'playing' | 'gameover';

// How long a START / PLAY AGAIN button stays disabled before we assume the
// server is not going to answer and give the player their tap back.
const ACTION_TIMEOUT_MS = 3000;

interface GameOverData {
  score: number;
  served: number;
  missed: number;
}

export class ControllerApp {
  private readonly net: Net;
  private readonly stage: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly overlayText: HTMLElement;

  private screen: Screen = 'join';
  private room = '';
  private roomLocked = false;
  private name = '';
  private playerId = '';
  private color = DEFAULT_ACCENT;
  private players: LobbyPlayer[] = [];
  private phase: Phase | null = null;
  private result: GameOverData = { score: 0, served: 0, missed: 0 };

  private joined = false;
  private busy = false; // a join / start / again is in flight
  private error: string | null = null;
  private notice: string | null = null;
  private status: NetStatus = 'idle';

  private pad: GamepadView | null = null;

  private started = false;
  private destroyed = false;
  private unlockGestures: (() => void) | null = null;
  private onVisibility: (() => void) | null = null;
  private actionTimer: number | null = null;

  constructor(private readonly root: HTMLElement) {
    this.stage = el('div', 'stage');
    this.overlay = el('div', 'overlay');
    this.overlayText = el('div', 'overlay__text', 'Reconnecting…');
    const spinner = el('div', 'overlay__spinner');
    const box = el('div', 'overlay__box');
    box.appendChild(spinner);
    box.appendChild(this.overlayText);
    box.appendChild(el('div', 'overlay__hint', 'Hold on — getting you back to the kitchen.'));
    this.overlay.appendChild(box);

    clear(this.root);
    this.root.appendChild(this.stage);
    this.root.appendChild(this.overlay);

    this.net = new Net({
      onMessage: (m) => this.onMessage(m),
      onStatus: (s) => this.onStatus(s),
    });
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;

    this.unlockGestures = lockGestures();
    applyAccent(DEFAULT_ACCENT);

    // Read the room off the URL here, not at import time: this module is part
    // of a server-rendered bundle and there is no location on the server.
    const params = new URLSearchParams(location.search);
    const fromQuery = sanitizeCode(params.get('room') ?? '');
    this.roomLocked = fromQuery.length > 0;
    this.room = fromQuery || sanitizeCode(loadRoom());
    this.name = loadName();

    // A phone that goes to sleep mid-round should reconnect the moment it wakes.
    this.onVisibility = () => {
      if (document.visibilityState === 'visible' && this.joined) this.net.retryNow();
    };
    document.addEventListener('visibilitychange', this.onVisibility);

    this.render();
  }

  /** Total teardown. Safe to call twice, and safe to call before start(). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.clearActionTimer();

    if (this.onVisibility) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
    if (this.unlockGestures) {
      this.unlockGestures();
      this.unlockGestures = null;
    }

    if (this.pad) {
      this.pad.destroy();
      this.pad = null;
    }

    this.net.stop();
    releaseWakeLock();
    resetAccent();
    clear(this.root);
  }

  /* ------------------------------ actions ------------------------------- */

  private doJoin(room: string, name: string): void {
    this.room = room;
    this.name = name;
    this.error = null;
    this.notice = 'Connecting…';
    this.busy = true;
    saveName(name);
    requestWakeLock();
    this.render();
    this.net.join(room, name);
  }

  /** Runs a start/again request with a bail-out so the UI never sticks. */
  private sendWithTimeout(msg: { t: 'start' } | { t: 'again' }, from: Screen): void {
    this.busy = true;
    this.net.send(msg);
    this.render();
    // The server drives the real transition; do not stay stuck.
    this.clearActionTimer();
    this.actionTimer = window.setTimeout(() => {
      this.actionTimer = null;
      if (this.destroyed) return;
      if (this.busy && this.screen === from) {
        this.busy = false;
        this.render();
      }
    }, ACTION_TIMEOUT_MS);
  }

  private clearActionTimer(): void {
    if (this.actionTimer !== null) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  /* ----------------------------- protocol ------------------------------- */

  private onMessage(msg: S2C): void {
    if (this.destroyed) return;
    switch (msg.t) {
      case 'joined': {
        this.joined = true;
        this.busy = false;
        this.error = null;
        this.notice = null;
        this.playerId = msg.playerId;
        this.color = msg.color;
        this.name = msg.name;
        saveName(msg.name);
        saveRoom(this.room); // only remember codes that actually worked
        applyAccent(msg.color);
        this.net.markJoined();
        this.hideOverlay();
        requestWakeLock();
        // A reconnect keeps whatever phase we were in — so a socket that died
        // to Vercel's connection cap mid-round drops the player straight back
        // onto the gamepad, holding the same chef the token reclaimed. A fresh
        // join starts in the lobby until the server says otherwise.
        this.setScreen(this.screenForPhase(this.phase ?? 'lobby'));
        this.pad?.resync();
        break;
      }
      case 'lobby': {
        this.players = msg.players;
        if (this.screen === 'lobby') this.render();
        break;
      }
      case 'phase': {
        this.phase = msg.phase;
        this.busy = false;
        if (this.joined) this.setScreen(this.screenForPhase(msg.phase));
        break;
      }
      case 'gameover': {
        this.result = { score: msg.score, served: msg.served, missed: msg.missed };
        this.phase = 'gameover';
        this.busy = false;
        if (this.joined) this.setScreen('gameover');
        break;
      }
      case 'buzz': {
        buzz(msg.ms);
        break;
      }
      case 'err': {
        // A hard rejection: the room is gone, full, or our token is stale.
        // Drop the token so the next attempt is a clean first join.
        this.net.stop('failed');
        this.net.forgetToken();
        this.joined = false;
        this.busy = false;
        this.notice = null;
        this.phase = null;
        this.error = msg.msg || 'The kitchen turned us away.';
        this.hideOverlay();
        this.setScreen('join', true);
        break;
      }
      // 'room' and 'state' are for the host page; ignore them here.
      default:
        break;
    }
  }

  private onStatus(status: NetStatus): void {
    if (this.destroyed) return;
    this.status = status;
    if (status === 'reconnecting') {
      if (this.joined) {
        this.showOverlay('Reconnecting…');
      } else {
        this.notice = 'Cannot reach the kitchen. Retrying…';
        this.render();
      }
    } else if (status === 'open' && !this.joined) {
      this.notice = 'Joining…';
      this.render();
    }
  }

  private screenForPhase(phase: Phase): Screen {
    if (phase === 'playing') return 'playing';
    if (phase === 'gameover') return 'gameover';
    return 'lobby';
  }

  /* ------------------------------ overlay ------------------------------- */

  private showOverlay(text: string): void {
    this.overlayText.textContent = text;
    this.overlay.classList.add('is-shown');
  }

  private hideOverlay(): void {
    this.overlay.classList.remove('is-shown');
  }

  /* ------------------------------ rendering ----------------------------- */

  private setScreen(screen: Screen, force = false): void {
    if (this.screen === screen && !force) return;
    this.screen = screen;
    this.render();
  }

  private render(): void {
    if (this.destroyed) return;
    // The gamepad owns live pointer state; never rebuild it under a finger.
    if (this.screen === 'playing' && this.pad) return;

    if (this.pad && this.screen !== 'playing') {
      this.pad.destroy();
      this.pad = null;
    }
    clear(this.stage);

    switch (this.screen) {
      case 'join':
        this.stage.appendChild(
          joinScreen({
            room: this.room,
            roomLocked: this.roomLocked,
            name: this.name,
            busy: this.busy && this.status !== 'reconnecting',
            error: this.error,
            notice: this.notice,
            onSubmit: (room, name) => this.doJoin(room, name),
          }),
        );
        break;

      case 'lobby':
        this.stage.appendChild(
          lobbyScreen({
            name: this.name,
            color: this.color,
            room: this.room,
            players: this.players,
            playerId: this.playerId,
            busy: this.busy,
            onStart: () => this.sendWithTimeout({ t: 'start' }, 'lobby'),
          }),
        );
        break;

      case 'playing': {
        const pad = new GamepadView(
          {
            onMove: (move: Vec2) => this.net.send({ t: 'input', move }),
            onPress: (btn) => this.net.send({ t: 'press', btn }),
            onRelease: (btn) => this.net.send({ t: 'release', btn }),
          },
          this.name,
        );
        this.pad = pad;
        this.stage.appendChild(pad.root);
        break;
      }

      case 'gameover':
        this.stage.appendChild(
          gameOverScreen({
            ...this.result,
            busy: this.busy,
            onAgain: () => this.sendWithTimeout({ t: 'again' }, 'gameover'),
          }),
        );
        break;
    }
  }
}
