'use client';

// Host (TV) screen. A thin React shell: it renders the three-screen DOM
// skeleton once, then hands the subtree to the imperative host app
// (components/host/app.ts), which owns the socket and the canvas kitchen.
// Everything browser-only lives inside the effect, so this page prerenders.

import { Baloo_2 } from 'next/font/google';
import { useEffect, useRef } from 'react';
import { mountHostApp } from '@/components/host/app';
import '@/components/host/host.css';

// Baloo 2 is a variable font (400–800); one file covers every weight the
// kitchen uses. Replaces the <link> tags from the standalone index.html.
const baloo = Baloo_2({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-baloo',
});

export default function HostPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return mountHostApp(root, { fontFamily: baloo.style.fontFamily });
  }, []);

  return (
    <div
      ref={rootRef}
      className={`host-root ${baloo.variable}`}
      data-screen="lobby"
    >
      <section className="screen screen-lobby">
        <div className="backdrop">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="blob b3" />
        </div>
        <div className="stack">
          <header className="title">
            <div className="kicker">Get your aprons on</div>
            <h1>
              OVER<span className="hot">COOKED</span>
            </h1>
            <div className="sub">PARTY</div>
          </header>

          <div className="join">
            <div className="card code-card">
              <div className="card-label">Room code</div>
              <div data-el="roomCode" className="code pending">
                ····
              </div>
            </div>
            <div className="card qr-card">
              <div className="card-label">Scan to play</div>
              <div className="qr-frame">
                <canvas data-el="qr" width={8} height={8} />
              </div>
              <div data-el="joinUrl" className="join-url">
                connecting…
              </div>
            </div>
          </div>

          <p className="instruction">
            Scan to join — any chef presses <b>Start</b>
          </p>

          <div data-el="roster" className="roster" />
        </div>
      </section>

      <section className="screen screen-play">
        <canvas data-el="stage" className="stage" />
      </section>

      <section className="screen screen-over">
        <div className="backdrop">
          <div className="blob b1" />
          <div className="blob b2" />
        </div>
        <div className="stack">
          <div className="kicker">Service is over</div>
          <div data-el="stars" className="stars" />
          <div className="final-score">
            <div
              className="card-label"
              style={{ color: 'var(--cream-2)', opacity: 0.75 }}
            >
              Final score
            </div>
            <div data-el="finalScore" className="n">
              0
            </div>
          </div>
          <div className="tallies">
            <div className="tally good">
              <span data-el="finalServed" className="n">
                0
              </span>
              <em>served</em>
            </div>
            <div className="tally bad">
              <span data-el="finalMissed" className="n">
                0
              </span>
              <em>missed</em>
            </div>
          </div>
          <div data-el="verdict" className="verdict">
            Nice shift, chefs.
          </div>
          <p className="instruction">
            Any chef can press <b>Play Again</b>
          </p>
        </div>
      </section>

      <div data-el="conn" className="conn">
        <span className="dot" />
        <span data-el="connMsg">Reconnecting…</span>
      </div>
    </div>
  );
}
