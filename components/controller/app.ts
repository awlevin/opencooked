// Controller app: screen state machine + protocol wiring.
//
// This is an imperative app mounted into a React tree by app/join/page.tsx.
// It owns raw DOM because a gamepad must never have a control rebuilt under a
// live finger, which is exactly what a re-render would do. The contract with
// React is small: `new ControllerApp(root).start()` on mount, `.destroy()` on
// unmount — and destroy must be total, because StrictMode mounts twice and a
// leaked socket would join the room twice.

import { DEFAULT_LEVEL_ID } from '@/shared/levels';
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
import {
  GameOverScreen,
  JoinScreen,
  LobbyScreen,
  sanitizeCode,
  type GameOverProps,
  type JoinProps,
  type LobbyProps,
} from './screens';
import { applyAccent, DEFAULT_ACCENT, resetAccent } from './theme';

type Screen = 'join' | 'lobby' | 'playing' | 'gameover';

// How long a START / PLAY AGAIN button stays disabled before we assume the
// server is not going to answer and give the player their tap back.
const ACTION_TIMEOUT_MS = 3000;

/** The screen object currently mounted in the stage. */
type MountedScreen =
  | { kind: 'join'; v: JoinScreen }
  | { kind: 'lobby'; v: LobbyScreen }
  | { kind: 'playing'; v: GamepadView }
  | { kind: 'gameover'; v: GameOverScreen };

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
  /** The kitchen the room is set to; the lobby broadcast is the truth. */
  private levelId = DEFAULT_LEVEL_ID;
  private phase: Phase | null = null;
  private result: GameOverData = { score: 0, served: 0, missed: 0 };

  private joined = false;
  private busy = false; // a join / start / again is in flight
  private error: string | null = null;
  private notice: string | null = null;
  private status: NetStatus = 'idle';

  /**
   * The screen that is mounted. Screens are objects that patch themselves in
   * place; only a change of `kind` swaps the element under the player.
   */
  private view: MountedScreen | null = null;

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

    this.view?.v.destroy();
    this.view = null;

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

  /**
   * Move the room to another kitchen. The chooser repaints straight away
   * rather than waiting for the round trip — a chooser that lags feels broken
   * — and the server's lobby broadcast is still what decides in the end. When
   * that echo agrees with us, which is the normal case, it paints nothing.
   */
  private selectLevel(levelId: string): void {
    if (levelId === this.levelId) return;
    this.levelId = levelId;
    this.net.send({ t: 'select', levelId });
    this.render();
  }

  /** Runs a start/again request with a bail-out so the UI never sticks. */
  private sendWithTimeout(
    msg: { t: 'start' } | { t: 'again'; levelId?: string },
    from: Screen,
  ): void {
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
        if (this.view?.kind === 'playing') this.view.v.resync();
        break;
      }
      case 'lobby': {
        this.players = msg.players;
        this.levelId = msg.levelId;
        // Cheap and idempotent: an echo of our own choice repaints nothing.
        // The game-over screen cares too — it offers the level after this one.
        if (this.screen === 'lobby' || this.screen === 'gameover') this.render();
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
      if (!this.joined) {
        this.notice = 'Cannot reach the kitchen. Retrying…';
        this.render();
      } else if (this.net.transport === 'cloud') {
        this.showOverlay('Reconnecting…');
      }
      // A dead socket while the game is running over a direct channel is not
      // something the player is experiencing, so we do not say it is.
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

  /**
   * Paint the current screen. A screen that is already mounted is *updated*,
   * never rebuilt: tearing the lobby down and building it again is what made
   * the chooser blink, since the new element replays the screen's fade-in from
   * nothing — once for the tap, once for the server's echo of it.
   */
  private render(): void {
    if (this.destroyed) return;

    switch (this.screen) {
      case 'join': {
        const props: JoinProps = {
          room: this.room,
          roomLocked: this.roomLocked,
          name: this.name,
          busy: this.busy && this.status !== 'reconnecting',
          error: this.error,
          notice: this.notice,
          onSubmit: (room, name) => this.doJoin(room, name),
        };
        if (this.view?.kind === 'join') this.view.v.update(props);
        else this.mount({ kind: 'join', v: new JoinScreen(props) });
        break;
      }

      case 'lobby': {
        const props: LobbyProps = {
          name: this.name,
          color: this.color,
          room: this.room,
          players: this.players,
          playerId: this.playerId,
          busy: this.busy,
          levelId: this.levelId,
          onStart: () => this.sendWithTimeout({ t: 'start' }, 'lobby'),
          onSelect: (levelId) => this.selectLevel(levelId),
        };
        if (this.view?.kind === 'lobby') this.view.v.update(props);
        else this.mount({ kind: 'lobby', v: new LobbyScreen(props) });
        break;
      }

      case 'playing': {
        // The gamepad owns live pointer state; never rebuild it under a finger.
        if (this.view?.kind === 'playing') break;
        const pad = new GamepadView(
          {
            onMove: (move: Vec2) => this.net.send({ t: 'input', move }),
            onPress: (btn) => this.net.send({ t: 'press', btn }),
            onRelease: (btn) => this.net.send({ t: 'release', btn }),
          },
          this.name,
        );
        this.mount({ kind: 'playing', v: pad });
        break;
      }

      case 'gameover': {
        const props: GameOverProps = {
          ...this.result,
          busy: this.busy,
          levelId: this.levelId,
          onAgain: () => this.sendWithTimeout({ t: 'again' }, 'gameover'),
          onNext: (levelId) => this.sendWithTimeout({ t: 'again', levelId }, 'gameover'),
        };
        if (this.view?.kind === 'gameover') this.view.v.update(props);
        else this.mount({ kind: 'gameover', v: new GameOverScreen(props) });
        break;
      }
    }
  }

  /** Swap the mounted screen for another kind, tearing the old one down. */
  private mount(next: MountedScreen): void {
    this.view?.v.destroy();
    clear(this.stage);
    this.view = next;
    this.stage.appendChild(next.v.root);
  }
}
