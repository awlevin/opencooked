import React from 'react';
import { Composition } from 'remotion';

import { Demo } from './Demo.tsx';
import { ReviewWalkthrough, REVIEW_FRAMES } from './ReviewWalkthrough.tsx';
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './timeline.ts';

export const RemotionRoot: React.FC = () => (
  <>
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
  <Composition id="ReviewWalkthrough" component={ReviewWalkthrough} durationInFrames={REVIEW_FRAMES} fps={30} width={1920} height={1080} />
  </>
);
