import React from 'react';
import { Composition } from 'remotion';

import { Demo } from './Demo.tsx';
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './timeline.ts';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
