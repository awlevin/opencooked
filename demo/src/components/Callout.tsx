import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { FONT } from '../font.ts';
import { outlined, PAL } from '../theme.ts';

export interface CalloutProps {
  text: string;
  tint: string;
  /** Fractional position in the 1920x1080 frame. */
  x: number;
  y: number;
  /** How long the label stays up, in frames. */
  hold: number;
  /** Put the label below the anchor with the stalk on top (for the top row). */
  flip?: boolean;
}

/**
 * A chunky game-style label with a little stalk pointing at the pan it is
 * talking about. Springs in, sits still, fades out.
 */
export const Callout: React.FC<CalloutProps> = ({ text, tint, x, y, hold, flip = false }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 11, mass: 0.6, stiffness: 130 } });
  const out = interpolate(frame, [hold - 9, hold], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bob = Math.sin(frame / 7) * 3;
  const slide = interpolate(pop, [0, 1], [flip ? -26 : 26, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: x * width,
        top: y * height,
        transform: `translate(-50%, ${flip ? '0%' : '-100%'}) translateY(${bob + slide}px) scale(${interpolate(
          pop,
          [0, 1],
          [0.6, 1],
        )})`,
        opacity: Math.min(pop, out),
        fontFamily: FONT,
        display: 'flex',
        flexDirection: flip ? 'column-reverse' : 'column',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          padding: '6px 30px 12px',
          borderRadius: 22,
          background: tint,
          border: `6px solid ${PAL.ink}`,
          boxShadow: '0 10px 0 rgba(28,16,9,0.45)',
          color: '#2a1710',
          fontSize: 56,
          fontWeight: 800,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          ...outlined(0),
        }}
      >
        {text}
      </div>
      <svg
        width="34"
        height="30"
        viewBox="0 0 34 30"
        style={{ marginTop: flip ? 0 : -4, marginBottom: flip ? -4 : 0, transform: flip ? 'rotate(180deg)' : undefined }}
      >
        <path d="M3 0 L31 0 L17 27 Z" fill={tint} stroke={PAL.ink} strokeWidth={6} strokeLinejoin="round" />
      </svg>
    </div>
  );
};
