import React from 'react';
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from 'remotion';

import { Gameplay } from './scenes/Gameplay.tsx';
import { HowItWorks } from './scenes/HowItWorks.tsx';
import { Outro } from './scenes/Outro.tsx';
import { Title } from './scenes/Title.tsx';
import { PAL } from './theme.ts';
import { FADE_S, GAMEPLAY_S, HOW_S, OUTRO_S, SCENE_STARTS, sec, TITLE_S } from './timeline.ts';

const FADE = sec(FADE_S);

/** Cross-dissolve wrapper: fades in over FADE and out over the last FADE. */
const Scene: React.FC<{ frames: number; fadeIn: boolean; children: React.ReactNode }> = ({
  frames,
  fadeIn,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(
    fadeIn ? interpolate(frame, [0, FADE], [0, 1], { extrapolateRight: 'clamp' }) : 1,
    interpolate(frame, [frames - FADE, frames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Demo: React.FC = () => (
  <AbsoluteFill style={{ background: PAL.night }}>
    <Sequence from={sec(SCENE_STARTS.title)} durationInFrames={sec(TITLE_S)}>
      <Scene frames={sec(TITLE_S)} fadeIn={false}>
        <Title />
      </Scene>
    </Sequence>

    <Sequence from={sec(SCENE_STARTS.how)} durationInFrames={sec(HOW_S)}>
      <Scene frames={sec(HOW_S)} fadeIn>
        <HowItWorks />
      </Scene>
    </Sequence>

    <Sequence from={sec(SCENE_STARTS.gameplay)} durationInFrames={sec(GAMEPLAY_S)}>
      <Scene frames={sec(GAMEPLAY_S)} fadeIn>
        <Gameplay />
      </Scene>
    </Sequence>

    <Sequence from={sec(SCENE_STARTS.outro)} durationInFrames={sec(OUTRO_S)}>
      <Scene frames={sec(OUTRO_S)} fadeIn>
        <Outro />
      </Scene>
    </Sequence>
  </AbsoluteFill>
);
