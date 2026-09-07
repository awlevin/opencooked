'use client';

import { Baloo_2 } from 'next/font/google';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { mountHostApp } from '@/components/host/app';
import { mapPixels } from '@/components/host/levelcard';
import { QR_PIXELS } from '@/components/host/lobby';
import { DEFAULT_LEVEL_ID, levelById, worldOf } from '@/shared/levels';
import { menuLine } from '@/shared/levels/minimap';
import '@/components/host/host.css';

const baloo = Baloo_2({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-baloo',
});

const START_LEVEL = levelById(DEFAULT_LEVEL_ID);
const START_WORLD = worldOf(DEFAULT_LEVEL_ID);
const START_MAP = mapPixels(START_LEVEL);

function PhoneWelcome({ onHost }: { onHost: () => void }) {
  return (
    <main className="welcome-root">
      <div className="welcome-glow welcome-glow--one" />
      <div className="welcome-glow welcome-glow--two" />
      <section className="welcome-card">
        <div className="welcome-brand" aria-label="Opencooked party">
          <span>OPEN</span><strong>COOKED</strong><em>PARTY</em>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="welcome-ticket">ORDER UP!</div>
          <div className="welcome-pan">🍳</div>
          <Image className="welcome-chef" src="/icon.png" width={512} height={512} priority alt="" />
          <div className="welcome-spark welcome-spark--one">✦</div>
          <div className="welcome-spark welcome-spark--two">✦</div>
        </div>
        <div className="welcome-copy">
          <div className="welcome-kicker">your phone is the controller</div>
          <h1>turn any screen into a party game.</h1>
          <p>open opencooked on a laptop or tv, then everyone joins from their phone.</p>
        </div>
        <div className="welcome-actions">
          <a className="welcome-primary" href="/join">join a kitchen</a>
          <button className="welcome-secondary" type="button" onClick={onHost}>
            this is the big screen
          </button>
        </div>
        <ol className="welcome-steps" aria-label="How to play">
          <li><b>1</b><span>open the big screen</span></li>
          <li><b>2</b><span>scan its code</span></li>
          <li><b>3</b><span>cook together</span></li>
        </ol>
      </section>
    </main>
  );
}

function HostScreen() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return mountHostApp(root, { fontFamily: baloo.style.fontFamily });
  }, []);

  return (
    <div ref={rootRef} className={`host-root ${baloo.variable}`} data-screen="lobby">
      <section className="screen screen-lobby">
        <div className="backdrop"><div className="blob b1" /><div className="blob b2" /><div className="blob b3" /></div>
        <div className="stack">
          <header className="title">
            <div className="kicker">phones out, aprons on</div>
            <h1>OPEN<span className="hot">COOKED</span></h1>
            <div className="sub">PARTY</div>
          </header>

          <div className="join">
            <div className="card code-card">
              <div className="card-label">or enter this code</div>
              <div data-el="roomCode" className="code pending">····</div>
              <div className="code-helper">at opencooked.vercel.app/join</div>
            </div>
            <div className="card qr-card">
              <div className="card-label">1. scan with your phone</div>
              <div className="qr-frame"><canvas data-el="qr" width={QR_PIXELS} height={QR_PIXELS} /></div>
              <div data-el="joinUrl" className="join-url">connecting…</div>
            </div>
          </div>

          <div className="card level-card">
            <canvas data-el="levelMap" className="level-map" width={START_MAP.width} height={START_MAP.height} />
            <div className="level-info">
              <div data-el="levelWorld" className="card-label level-world">{START_WORLD?.name ?? ''}</div>
              <div data-el="levelName" className="level-name">{START_LEVEL.name}</div>
              <div className="level-line">
                <span data-el="levelStep" className="level-step">{`${START_LEVEL.index} / ${START_LEVEL.count}`}</span>
                <span data-el="levelMenu" className="level-menu">{menuLine(START_LEVEL)}</span>
              </div>
            </div>
          </div>

          <p className="instruction"><b>2.</b> pick a chef name &nbsp;·&nbsp; <b>3.</b> press start on any phone</p>
          <div data-el="roster" className="roster" />
        </div>
      </section>

      <section className="screen screen-play"><canvas data-el="stage" className="stage" /></section>
      <section className="screen screen-over">
        <div className="backdrop"><div className="blob b1" /><div className="blob b2" /></div>
        <div className="stack">
          <div className="kicker">service is over</div>
          <div data-el="overLevel" className="over-level">Home Kitchen · Mise en place</div>
          <div data-el="stars" className="stars" />
          <div className="final-score"><div className="card-label final-score-label">final score</div><div data-el="finalScore" className="n">0</div></div>
          <div className="tallies"><div className="tally good"><span data-el="finalServed" className="n">0</span><em>served</em></div><div className="tally bad"><span data-el="finalMissed" className="n">0</span><em>missed</em></div></div>
          <div data-el="verdict" className="verdict">Nice shift, chefs.</div>
          <p className="instruction">any chef can press <b>play again</b></p>
        </div>
      </section>
      <div data-el="conn" className="conn"><span className="dot" /><span data-el="connMsg">Reconnecting…</span></div>
    </div>
  );
}

export default function HomePage() {
  const [mode, setMode] = useState<'detecting' | 'welcome' | 'host'>('detecting');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const phoneLike = matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)').matches;
    setMode(params.has('host') || !phoneLike ? 'host' : 'welcome');
  }, []);

  if (mode === 'detecting') return <div className="entry-loading">warming up…</div>;
  if (mode === 'welcome') return <PhoneWelcome onHost={() => setMode('host')} />;
  return <HostScreen />;
}
