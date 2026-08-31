// The offering half of local mode: one RTCPeerConnection per chef.
//
// The host always offers and always creates the channel; the phone only ever
// answers (components/controller/peer.ts). Everything in here is optional
// speed — a handshake that stalls, fails, or is simply impossible (cellular,
// AP isolation, a browser without WebRTC) costs the player nothing, because
// the chef is already playing over the cloud path the whole time.
//
// `iceServers: []` on purpose: host candidates and mDNS `.local` candidates
// only. No STUN, no TURN, no third party. If the two devices are not on one
// network there is nothing to find, and finding that out in five seconds is
// better than paying a relay to hide it.

/** A handshake gets this long before we shrug and stay on the cloud. */
const HANDSHAKE_MS = 5000;
/** After a channel that never opened. Grows, then we stop trying. */
const RETRY_MS = [8000, 20000];
/** After a channel that worked and then dropped: try again almost at once. */
const REOPEN_MS = 1000;

export interface PeerHubOptions {
  /** Relay one payload to a chef as `{ t:'signal', to, data }`. */
  signal(to: string, data: unknown): void;
  /** The channel is open. Seat it — the phone claims its seat on it. */
  adopt(playerId: string, ch: RTCDataChannel): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Reads one payload from a phone. It sends bare shapes; we accept the wrapped
 * ones too, so neither side has to care what the other decided to do.
 */
function classify(
  data: unknown,
): { sdp: RTCSessionDescriptionInit } | { ice: RTCIceCandidateInit } | null {
  if (!isRecord(data)) return null;
  const inner = isRecord(data.description) ? data.description : data;
  if (typeof inner.sdp === 'string' && typeof inner.type === 'string') {
    return { sdp: inner as unknown as RTCSessionDescriptionInit };
  }
  const cand = isRecord(data.candidate) ? data.candidate : data;
  if (typeof cand.candidate === 'string') {
    return { ice: cand as unknown as RTCIceCandidateInit };
  }
  return null;
}

/** False on browsers without WebRTC; local mode simply never starts there. */
export function peerSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

class Attempt {
  readonly pc: RTCPeerConnection;
  private readonly ch: RTCDataChannel;
  private readonly earlyIce: RTCIceCandidateInit[] = [];
  private haveRemote = false;
  private timer: number | null = null;
  private dead = false;
  /** True once the channel opened, so the retry after it drops is quick. */
  opened = false;

  constructor(
    readonly playerId: string,
    private readonly opts: PeerHubOptions,
    private readonly onDone: (a: Attempt) => void,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: [] });
    // Unreliable and unordered: a stale joystick frame is worth less than
    // nothing, and head-of-line blocking is the whole enemy here.
    this.ch = this.pc.createDataChannel('play', { ordered: false, maxRetransmits: 0 });

    this.pc.onicecandidate = (e) => {
      if (this.dead || !e.candidate) return;
      this.opts.signal(this.playerId, e.candidate.toJSON());
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      // 'disconnected' is routine Wi-Fi noise; only terminal states count.
      if (s === 'failed' || s === 'closed') this.die();
    };
    this.ch.onopen = () => {
      if (this.dead || this.opened) return;
      this.opened = true;
      this.clearTimer();
      this.opts.adopt(this.playerId, this.ch);
    };
    this.ch.onclose = () => this.die();
    this.ch.onerror = () => this.die();

    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.opened) this.die();
    }, HANDSHAKE_MS);

    void this.offer();
  }

  private async offer(): Promise<void> {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      if (this.dead) return;
      // localDescription, not `offer`: the browser may have rewritten it.
      const local = this.pc.localDescription;
      if (local) this.opts.signal(this.playerId, { type: local.type, sdp: local.sdp });
    } catch {
      this.die();
    }
  }

  /** One payload from this chef's phone. Never throws at the caller. */
  accept(data: unknown): void {
    void this.consume(data).catch(() => {
      /* a bad frame from a phone is not a reason to drop the chef */
    });
  }

  private async consume(data: unknown): Promise<void> {
    if (this.dead) return;
    const parsed = classify(data);
    if (!parsed) return;

    if ('ice' in parsed) {
      // Candidates can overtake the answer through the relay.
      if (!this.haveRemote) {
        this.earlyIce.push(parsed.ice);
        return;
      }
      await this.addIce(parsed.ice);
      return;
    }

    // Only the phone answers. Anything else means somebody is confused.
    if (parsed.sdp.type !== 'answer' || this.haveRemote) return;
    await this.pc.setRemoteDescription(parsed.sdp);
    this.haveRemote = true;
    const queued = this.earlyIce.splice(0, this.earlyIce.length);
    for (const ice of queued) await this.addIce(ice);
  }

  private async addIce(ice: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(ice.candidate ? ice : undefined);
    } catch {
      /* one unusable candidate must not fail the whole connection */
    }
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  die(): void {
    if (this.dead) return;
    this.dead = true;
    this.clearTimer();
    this.ch.onopen = this.ch.onclose = this.ch.onerror = null;
    this.pc.onicecandidate = this.pc.onconnectionstatechange = null;
    try {
      this.ch.close();
    } catch {
      /* already gone */
    }
    try {
      this.pc.close();
    } catch {
      /* already gone */
    }
    this.onDone(this);
  }
}

/** One negotiation per chef, retried a couple of times, then left alone. */
export class PeerHub {
  private readonly live = new Map<string, Attempt>();
  private readonly retries = new Map<string, number>();
  private readonly timers = new Map<string, number>();
  private roster: string[] = [];
  private disposed = false;

  constructor(private readonly opts: PeerHubOptions) {}

  /** The room's current chefs. New ones get an offer; departed ones are dropped. */
  setRoster(ids: string[]): void {
    if (this.disposed) return;
    this.roster = [...ids];
    const present = new Set(ids);
    for (const [id, attempt] of [...this.live]) {
      if (!present.has(id)) {
        this.live.delete(id);
        attempt.die();
      }
    }
    for (const [id, timer] of [...this.timers]) {
      if (present.has(id)) continue;
      clearTimeout(timer);
      this.timers.delete(id);
      this.retries.delete(id);
    }
    for (const id of ids) this.start(id);
  }

  /** One `{ t:'signal', from }` payload. */
  accept(from: string, data: unknown): void {
    this.live.get(from)?.accept(data);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const attempt of [...this.live.values()]) attempt.die();
    this.live.clear();
    this.retries.clear();
  }

  private start(playerId: string): void {
    if (this.disposed || !peerSupported()) return;
    if (this.live.has(playerId) || this.timers.has(playerId)) return;
    this.live.set(
      playerId,
      new Attempt(playerId, this.opts, (a) => this.finished(a)),
    );
  }

  private finished(a: Attempt): void {
    if (this.live.get(a.playerId) === a) this.live.delete(a.playerId);
    if (this.disposed || !this.roster.includes(a.playerId)) return;

    // A channel that worked and then dropped means the network is fine and the
    // phone is waiting for another offer — it never initiates. Try again
    // straight away, and let it earn a full set of retries all over again.
    if (a.opened) {
      this.retries.delete(a.playerId);
      this.schedule(a.playerId, REOPEN_MS);
      return;
    }

    const n = this.retries.get(a.playerId) ?? 0;
    if (n >= RETRY_MS.length) return; // this phone cannot reach us; leave it be
    this.retries.set(a.playerId, n + 1);
    this.schedule(a.playerId, RETRY_MS[n]);
  }

  private schedule(playerId: string, delay: number): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(playerId);
      if (this.roster.includes(playerId)) this.start(playerId);
    }, delay);
    this.timers.set(playerId, timer);
  }
}
