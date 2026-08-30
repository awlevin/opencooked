import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Backdrop } from '../components/Backdrop.tsx';
import { FONT } from '../font.ts';
import { outlined, PAL } from '../theme.ts';

const Line: React.FC<{ delay: number; children: React.ReactNode }> = ({ delay, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 13, mass: 0.8 } });
  return (
    <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [26, 0])}px)` }}>
      {children}
    </div>
  );
};

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.8 } });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        fontFamily: FONT,
        color: PAL.cream,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 34,
      }}
    >
      <Backdrop />

      <div
        style={{
          position: 'relative',
          textAlign: 'center',
          lineHeight: 0.95,
          transform: `scale(${interpolate(pop, [0, 1], [0.82, 1])})`,
          opacity: pop,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 116, fontWeight: 800, ...outlined(0.075) }}>
          OVER<span style={{ color: PAL.butter }}>COOKED</span> PARTY
        </h1>
      </div>

      <Line delay={9}>
        <div
          style={{
            padding: '14px 52px 22px',
            borderRadius: 999,
            background: PAL.butter,
            border: `7px solid ${PAL.ink}`,
            boxShadow: '0 12px 0 rgba(28,16,9,0.45)',
            color: '#2a1710',
            fontSize: 62,
            fontWeight: 800,
            letterSpacing: '0.01em',
          }}
        >
          overcooked-bay.vercel.app
        </div>
      </Line>

      <Line delay={18}>
        <div
          style={{
            fontSize: 44,
            fontWeight: 700,
            color: PAL.cream,
            opacity: 0.95,
            letterSpacing: '0.02em',
          }}
        >
          github.com/awlevin/overcooked
        </div>
      </Line>

      <Line delay={26}>
        <div
          style={{
            marginTop: 6,
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: PAL.cream2,
            opacity: 0.72,
          }}
        >
          MIT licensed fan remake
        </div>
      </Line>
    </div>
  );
};
