import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Backdrop } from '../components/Backdrop.tsx';
import { FONT } from '../font.ts';
import { outlined, PAL } from '../theme.ts';

const STEPS = ['Put the kitchen on the TV', 'Phones scan the QR', 'Cook together'];
/** Frame each step lights up on. */
const BEAT = [6, 46, 88];

/** A tiny hand-drawn kitchen, so the TV is showing the real thing. */
const MiniKitchen: React.FC = () => {
  const counters = [];
  for (let x = 0; x < 11; x++) {
    counters.push({ x, y: 0 });
    counters.push({ x, y: 5 });
  }
  for (let y = 1; y < 5; y++) {
    counters.push({ x: 0, y });
    counters.push({ x: 10, y });
  }
  counters.push({ x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 });
  const T = 48;
  return (
    <g>
      <rect x={0} y={0} width={11 * T} height={6 * T} rx={10} fill="#c98a4b" />
      {counters.map((c, i) => (
        <rect
          key={i}
          x={c.x * T + 3}
          y={c.y * T + 3}
          width={T - 6}
          height={T - 6}
          rx={8}
          fill="#fff2d8"
          stroke="#d9ab6f"
          strokeWidth={2}
        />
      ))}
      {[
        { x: 2.2, y: 1.4, c: PAL.tomato },
        { x: 8.0, y: 1.2, c: '#3498db' },
        { x: 3.4, y: 4.1, c: '#2ecc71' },
        { x: 7.6, y: 4.3, c: PAL.butter },
      ].map((p, i) => (
        <g key={i}>
          <circle cx={p.x * T + T / 2} cy={p.y * T + T / 2} r={17} fill={p.c} stroke={PAL.ink} strokeWidth={4} />
          <rect x={p.x * T + T / 2 - 14} y={p.y * T + T / 2 - 26} width={28} height={13} rx={6} fill="#fff" stroke={PAL.ink} strokeWidth={3.5} />
        </g>
      ))}
    </g>
  );
};

/** Blocky stand-in for the join QR — no downloaded assets anywhere here. */
const QrBlock: React.FC<{ size: number }> = ({ size }) => {
  const cells = 7;
  const s = size / cells;
  const on = [
    [0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2],
    [4, 0], [6, 0], [5, 1], [4, 2], [6, 2],
    [0, 4], [2, 4], [1, 5], [0, 6], [2, 6],
    [4, 4], [5, 4], [6, 5], [4, 6], [5, 6], [6, 6],
    [3, 3], [4, 3], [3, 5],
  ];
  return (
    <g>
      <rect x={0} y={0} width={size} height={size} rx={8} fill="#fff" />
      {on.map(([cx, cy], i) => (
        <rect key={i} x={cx * s + s * 0.1} y={cy * s + s * 0.1} width={s * 0.8} height={s * 0.8} fill={PAL.ink} />
      ))}
    </g>
  );
};

/** `tint` is the chef colour this phone drives — the same dot the TV shows. */
const Phone: React.FC<{ lit: number; tint: string }> = ({ lit, tint }) => (
  <g>
    <rect x={0} y={0} width={132} height={264} rx={22} fill="#241a14" stroke={PAL.ink} strokeWidth={6} />
    <rect x={9} y={12} width={114} height={240} rx={14} fill="#12100f" />
    {/* the controller's name chip */}
    <rect x={30} y={26} width={72} height={20} rx={10} fill="rgba(255,246,227,0.10)" />
    <circle cx={44} cy={36} r={7} fill={tint} opacity={0.35 + lit * 0.65} />
    <rect x={57} y={31} width={34} height={9} rx={4.5} fill={PAL.cream} fillOpacity={0.28} />
    <circle cx={40} cy={196} r={26} fill="none" stroke={PAL.cream} strokeOpacity={0.35 + lit * 0.4} strokeWidth={4} strokeDasharray="7 7" />
    <circle cx={40} cy={196} r={12} fill={PAL.cream} fillOpacity={0.15 + lit * 0.5} />
    <circle cx={95} cy={176} r={17} fill="#3f4a57" />
    <circle cx={101} cy={212} r={19} fill={PAL.tomato} fillOpacity={0.55 + lit * 0.45} />
  </g>
);

export const HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const tv = spring({ frame: frame - BEAT[0], fps, config: { damping: 13, mass: 0.9 } });
  const phone1 = spring({ frame: frame - BEAT[1], fps, config: { damping: 12, mass: 0.8 } });
  const crowd = spring({ frame: frame - BEAT[2], fps, config: { damping: 13, mass: 0.85 } });
  const scan = interpolate(frame, [BEAT[1] + 6, BEAT[1] + 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: FONT, color: PAL.cream }}>
      <Backdrop />

      <div
        style={{
          position: 'absolute',
          top: 74,
          width: '100%',
          textAlign: 'center',
          fontSize: 72,
          fontWeight: 800,
          ...outlined(0.055),
        }}
      >
        How it works
      </div>

      <svg
        viewBox="0 0 1920 720"
        style={{ position: 'absolute', top: 210, left: 0, width: 1920, height: 720 }}
      >
        {/* TV: bezel hugs the kitchen, stand underneath */}
        <g transform={`translate(760 46) scale(${interpolate(tv, [0, 1], [0.82, 1])})`} opacity={tv}>
          <rect x={-26} y={-22} width={596} height={341} rx={28} fill="#2a1a11" stroke={PAL.ink} strokeWidth={10} />
          <g transform="scale(1.03)">
            <MiniKitchen />
          </g>
          <rect x={-26} y={-22} width={596} height={341} rx={28} fill="none" stroke={PAL.butter} strokeWidth={5} opacity={0.5} />
          <rect x={252} y={319} width={40} height={36} fill="#2a1a11" />
          <rect x={152} y={349} width={240} height={20} rx={10} fill="#2a1a11" stroke={PAL.ink} strokeWidth={6} />
          {/* the join QR, stuck on the corner of the screen like the lobby's card */}
          <g transform="translate(452 208)" opacity={interpolate(scan, [0, 0.35], [0.3, 1], { extrapolateRight: 'clamp' })}>
            <rect x={-14} y={-14} width={162} height={186} rx={18} fill={PAL.cream} stroke={PAL.ink} strokeWidth={7} />
            <g transform="translate(7 0)">
              <QrBlock size={120} />
            </g>
            <text
              x={60}
              y={152}
              textAnchor="middle"
              fill={PAL.inkSoft}
              style={{ font: '700 22px sans-serif', letterSpacing: '2px' }}
            >
              SCAN
            </text>
          </g>
        </g>

        {/* scan beam, from the front phone up to the QR card */}
        <path
          d="M 470 452 C 700 452 980 400 1210 300"
          fill="none"
          stroke={PAL.butter}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray="18 22"
          strokeDashoffset={-frame * 2.2}
          opacity={scan * 0.85}
        />

        {/* phones */}
        <g transform={`translate(350 340) rotate(-7) scale(${interpolate(phone1, [0, 1], [0.7, 1])})`} opacity={phone1}>
          <Phone lit={scan} tint={PAL.tomato} />
        </g>
        <g transform={`translate(120 386) rotate(-16) scale(${interpolate(crowd, [0, 1], [0.6, 0.9])})`} opacity={crowd * 0.95}>
          <Phone lit={crowd} tint="#3498db" />
        </g>
        <g transform={`translate(560 400) rotate(11) scale(${interpolate(crowd, [0, 1], [0.6, 0.9])})`} opacity={crowd * 0.95}>
          <Phone lit={crowd} tint="#2ecc71" />
        </g>
      </svg>

      <div
        style={{
          position: 'absolute',
          bottom: 88,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 26,
          fontSize: 40,
          fontWeight: 700,
        }}
      >
        {STEPS.map((s, i) => {
          const lit = interpolate(frame, [BEAT[i], BEAT[i] + 12], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <React.Fragment key={s}>
              {i > 0 ? (
                <span style={{ color: PAL.butter, opacity: lit * 0.9, fontSize: 46 }}>→</span>
              ) : null}
              <span
                style={{
                  padding: '10px 26px 14px',
                  borderRadius: 999,
                  color: lit > 0.5 ? '#2a1710' : PAL.cream2,
                  background: `rgba(255, 210, 63, ${lit})`,
                  border: `4px solid rgba(59,35,20,${0.25 + lit * 0.75})`,
                  opacity: 0.45 + lit * 0.55,
                  transform: `translateY(${interpolate(lit, [0, 1], [10, 0])}px)`,
                }}
              >
                {s}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
