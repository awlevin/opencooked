// The local-mode data path: a direct RTCDataChannel from this phone to the
// host laptop when both are on the same Wi-Fi.
//
// This module is the *answering* half of the handshake and nothing else. The
// host is always the offerer and always creates the DataChannel — a phone that
// cannot negotiate simply never gets one, and keeps playing over the cloud.
// Nothing in here is allowed to throw into the caller: every failure is a
// silent `onClose`, because a broken handshake must never cost a player a
// round. See .private/plans/local-mode-webrtc.md.
//
// No STUN, no TURN, no third party: `iceServers: []` means host candidates and
// mDNS `.local` candidates only, which is exactly the reachability we want. If
// the two devices are not on the same network there is nothing to find, and we
// want to find that out fast rather than pay a relay to hide it.

import type { C2S } from '@/shared/protocol';

export interface PeerOptions {
  /** Sends one payload back to the host as `{t:'signal', to:'host', data}`. */
  signal: (data: unknown) => void;
  /** One raw server->client frame arrived over the channel. */
  onData: (raw: string) => void;
  /** The channel opened. Traffic may flow. */
  onOpen: () => void;
  /** This link is finished, for any reason. Fires at most once. */
  onClose: () => void;
}

/** False on browsers without WebRTC; every entry point checks it first. */
export function peerSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Reads one relayed payload. The server forwards `data` verbatim, so this
 * accepts the two shapes a host can plausibly put on the wire: a bare
 * `RTCSessionDescriptionInit` / `RTCIceCandidateInit`, or either of those
 * wrapped in `{description}` / `{candidate}`.
 */
function classify(
  data: unknown,
): { sdp: RTCSessionDescriptionInit } | { ice: RTCIceCandidateInit } | null {
  if (!isRecord(data)) return null;

  const inner = isRecord(data.description) ? data.description : data;
  if (typeof inner.sdp === 'string' && typeof inner.type === 'string') {
    return { sdp: inner as unknown as RTCSessionDescriptionInit };
  }

  // `candidate` is a string on a real RTCIceCandidateInit, so an object there
  // means the host wrapped it.
  const cand = isRecord(data.candidate) ? data.candidate : data;
  if (typeof cand.candidate === 'string') {
    return { ice: cand as unknown as RTCIceCandidateInit };
  }
  return null;
}

export class PeerLink {
  private pc: RTCPeerConnection | null = null;
  private ch: RTCDataChannel | null = null;
  // Candidates can overtake the offer through the relay; hold them until
  // there is a remote description to attach them to.
  private earlyIce: RTCIceCandidateInit[] = [];
  private haveRemote = false;
  private dead = false;
  private opened = false;

  constructor(private readonly opts: PeerOptions) {}

  get isOpen(): boolean {
    return !this.dead && this.ch !== null && this.ch.readyState === 'open';
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** Feeds one payload from `{t:'signal', from:'host'}`. Never throws. */
  accept(data: unknown): void {
    void this.consume(data).catch(() => this.die());
  }

  /** Sends one client->server message. False means "use the socket". */
  send(msg: C2S): boolean {
    const ch = this.ch;
    if (this.dead || !ch || ch.readyState !== 'open') return false;
    try {
      ch.send(JSON.stringify(msg));
      return true;
    } catch {
      // Buffer full or channel closing between the check and the send.
      return false;
    }
  }

  /** Tears everything down without calling back. Idempotent. */
  dispose(): void {
    this.dead = true;
    this.detach();
  }

  /* ---------------------------- negotiation ----------------------------- */

  private async consume(data: unknown): Promise<void> {
    if (this.dead) return;
    const parsed = classify(data);
    if (!parsed) return; // junk on the relay is not our problem

    if ('ice' in parsed) {
      if (!this.pc || !this.haveRemote) {
        this.earlyIce.push(parsed.ice);
        return;
      }
      await this.addIce(parsed.ice);
      return;
    }

    // Only the host offers. An answer arriving here means someone else is
    // confused; ignoring it is safer than tripping over our own state.
    if (parsed.sdp.type !== 'offer') return;

    const pc = this.ensurePc();
    await pc.setRemoteDescription(parsed.sdp);
    this.haveRemote = true;

    const queued = this.earlyIce;
    this.earlyIce = [];
    for (const ice of queued) await this.addIce(ice);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (this.dead) return;
    // localDescription rather than `answer`: the browser may have rewritten it.
    const local = pc.localDescription;
    if (local) this.opts.signal({ type: local.type, sdp: local.sdp });
  }

  private async addIce(ice: RTCIceCandidateInit): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    try {
      // An empty candidate is "end of candidates"; browsers differ on whether
      // they accept it, and nothing breaks if they do not.
      await pc.addIceCandidate(ice.candidate ? ice : undefined);
    } catch {
      /* one unusable candidate must not fail the whole connection */
    }
  }

  private ensurePc(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;

    pc.onicecandidate = (e) => {
      if (this.dead || !e.candidate) return;
      this.opts.signal(e.candidate.toJSON());
    };

    // We never create the channel; we adopt the host's.
    pc.ondatachannel = (e) => this.adopt(e.channel);

    pc.onconnectionstatechange = () => {
      // 'disconnected' is often transient on Wi-Fi, so only the terminal
      // states count. A stall is caught by the caller's deadline instead.
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this.die();
    };

    return pc;
  }

  private adopt(ch: RTCDataChannel): void {
    if (this.dead) {
      try {
        ch.close();
      } catch {
        /* already gone */
      }
      return;
    }
    this.ch = ch;
    ch.onopen = () => {
      if (this.dead || this.opened) return;
      this.opened = true;
      this.opts.onOpen();
    };
    ch.onmessage = (e: MessageEvent<unknown>) => {
      if (this.dead || typeof e.data !== 'string') return;
      this.opts.onData(e.data);
    };
    ch.onclose = () => this.die();
    ch.onerror = () => this.die();

    // A channel handed to us already open fires no 'open' event.
    if (ch.readyState === 'open') {
      this.opened = true;
      this.opts.onOpen();
    }
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.detach();
    this.opts.onClose();
  }

  private detach(): void {
    const ch = this.ch;
    this.ch = null;
    if (ch) {
      ch.onopen = ch.onmessage = ch.onclose = ch.onerror = null;
      try {
        ch.close();
      } catch {
        /* already gone */
      }
    }
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onicecandidate = pc.ondatachannel = pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* already gone */
      }
    }
    this.earlyIce = [];
  }
}
