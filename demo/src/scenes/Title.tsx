import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Backdrop } from '../components/Backdrop.tsx';
import { FONT } from '../font.ts';
import { outlined, PAL } from '../theme.ts';

/** The lobby lockup, springing in the way the real screen does. */
export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.8, stiffness: 110 } });
  const sub = spring({ frame: frame - 10, fps, config: { damping: 11, mass: 0.7 } });
  const kicker = interpolate(frame, [4, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const chefs = spring({ frame: frame - 18, fps, config: { damping: 13, mass: 0.9 } });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        fontFamily: FONT,
        color: PAL.cream,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Backdrop />
      <div style={{ position: 'relative', textAlign: 'center', lineHeight: 0.92 }}>
        <div
          style={{
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            color: PAL.cream2,
            opacity: kicker * 0.8,
            marginBottom: '0.5em',
            transform: `translateY(${interpolate(kicker, [0, 1], [14, 0])}px)`,
          }}
        >
          Get your aprons on
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 190,
            fontWeight: 800,
            letterSpacing: '0.01em',
            color: PAL.cream,
            ...outlined(0.09),
            transform: `scale(${interpolate(pop, [0, 1], [0.72, 1])})`,
            opacity: interpolate(pop, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          OVER<span style={{ color: PAL.butter }}>COOKED</span>
        </h1>

        <div
          style={{
            display: 'inline-block',
            marginTop: '0.15em',
            padding: '0.06em 0.7em 0.14em',
            fontSize: 74,
            fontWeight: 800,
            letterSpacing: '0.32em',
            textIndent: '0.32em',
            color: '#2a1710',
            background: PAL.butter,
            border: `0.09em solid ${PAL.ink}`,
            borderRadius: 999,
            boxShadow: '0 0.14em 0 rgba(59, 35, 20, 0.5)',
            transform: `rotate(-1.6deg) scale(${interpolate(sub, [0, 1], [0.6, 1])})`,
            opacity: sub,
          }}
        >
          PARTY
        </div>

        <div
          style={{
            marginTop: 54,
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: PAL.cream2,
            opacity: chefs * 0.92,
            transform: `translateY(${interpolate(chefs, [0, 1], [22, 0])}px)`,
          }}
        >
          Four chefs. One tiny kitchen. Three minutes.
        </div>
      </div>
    </div>
  );
};
