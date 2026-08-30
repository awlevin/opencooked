import React from 'react';
import {
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import { tileFrac, tileFracH } from '../board.ts';
import { Callout } from '../components/Callout.tsx';
import { FONT } from '../font.ts';
import { PAL } from '../theme.ts';
import { CALLOUTS, FIRST_GRAB, FIRST_MOVE, GAMEPLAY_START, META, sec } from '../timeline.ts';

/* ------------------------------ phone frame ----------------------------- */

/** Outer size of the handset in the composition, bezel included. */
const PHONE_H = 596;
const BEZEL = 14;
const SCREEN_H = PHONE_H - BEZEL * 2;
const SCREEN_W = Math.round((SCREEN_H * META.phoneWidth) / META.phoneHeight);
const PHONE_W = SCREEN_W + BEZEL * 2;
/** Screen px -> composition px. */
const PHONE_K = SCREEN_H / META.phoneHeight;

/** A ring that ticks the eye toward one control on the handset. */
const Highlight: React.FC<{ cx: number; cy: number; r: number; label: string; hold: number }> = ({
  cx,
  cy,
  r,
  label,
  hold,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.6 } });
  const out = interpolate(frame, [hold - 8, hold], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const pulse = 1 + Math.sin(frame / 5) * 0.06;
  return (
    <div style={{ position: 'absolute', left: cx, top: cy, opacity: Math.min(pop, out) }}>
      <div
        style={{
          position: 'absolute',
          left: -r,
          top: -r,
          width: r * 2,
          height: r * 2,
          borderRadius: '50%',
          border: `6px solid ${PAL.butter}`,
          boxShadow: `0 0 26px rgba(255,210,63,0.55)`,
          transform: `scale(${pulse * interpolate(pop, [0, 1], [1.5, 1])})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -70,
          top: r + 8,
          width: 140,
          textAlign: 'center',
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: '0.16em',
          color: PAL.butter,
          textShadow: '0 3px 0 rgba(28,16,9,0.8)',
        }}
      >
        {label}
      </div>
    </div>
  );
};

const PhonePiP: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 12, fps, config: { damping: 14, mass: 1 } });

  const stickCx = (META.phoneStick.x + META.phoneStick.width / 2) * PHONE_K + BEZEL;
  const stickCy = (META.phoneStick.y + META.phoneStick.height / 2) * PHONE_K + BEZEL;
  const grabCx = (META.phoneGrab.x + META.phoneGrab.width / 2) * PHONE_K + BEZEL;
  const grabCy = (META.phoneGrab.y + META.phoneGrab.height / 2) * PHONE_K + BEZEL;

  return (
    <div
      style={{
        position: 'absolute',
        left: 56,
        bottom: 74,
        width: PHONE_W,
        height: PHONE_H,
        transform: `rotate(-3.5deg) translateY(${interpolate(enter, [0, 1], [90, 0])}px)`,
        opacity: enter,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 46,
          background: 'linear-gradient(160deg, #4b3421 0%, #2a1a11 100%)',
          border: `5px solid ${PAL.ink}`,
          boxShadow: '0 26px 50px rgba(0,0,0,0.55), inset 0 2px 0 rgba(255,246,227,0.18)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: BEZEL,
          top: BEZEL,
          width: SCREEN_W,
          height: SCREEN_H,
          borderRadius: 32,
          overflow: 'hidden',
          background: '#0d0b0a',
        }}
      >
        <OffthreadVideo
          src={staticFile('phone.mp4')}
          trimBefore={sec(GAMEPLAY_START)}
          muted
          style={{ width: SCREEN_W, height: SCREEN_H, objectFit: 'cover' }}
        />
      </div>
      {/* speaker slot */}
      <div
        style={{
          position: 'absolute',
          left: PHONE_W / 2 - 34,
          top: 5,
          width: 68,
          height: 7,
          borderRadius: 4,
          background: 'rgba(255,246,227,0.22)',
        }}
      />

      {FIRST_MOVE !== null ? (
        <Sequence from={sec(FIRST_MOVE)} durationInFrames={52} layout="none">
          <Highlight cx={stickCx} cy={stickCy} r={62} label="MOVE" hold={52} />
        </Sequence>
      ) : null}
      {FIRST_GRAB !== null ? (
        <Sequence from={sec(FIRST_GRAB) - 6} durationInFrames={46} layout="none">
          <Highlight cx={grabCx} cy={grabCy} r={48} label="GRAB" hold={46} />
        </Sequence>
      ) : null}
    </div>
  );
};

/* -------------------------------- scene --------------------------------- */

export const Gameplay: React.FC = () => (
  <div style={{ position: 'absolute', inset: 0, background: PAL.night }}>
    <OffthreadVideo
      src={staticFile('host.mp4')}
      trimBefore={sec(GAMEPLAY_START)}
      muted
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />

    <PhonePiP />

    {CALLOUTS.map((c) => {
      // Clear the station itself by half a tile so the stalk touches its edge.
      const at = tileFrac(c.tile.x, c.tile.y);
      const y = at.y + (c.flip ? 1 : -1) * tileFracH() * 0.55;
      return (
        <Sequence key={c.text} from={sec(c.at)} durationInFrames={62} layout="none">
          <Callout text={c.text} tint={c.tint} x={at.x} y={y} hold={62} flip={c.flip} />
        </Sequence>
      );
    })}
  </div>
);
