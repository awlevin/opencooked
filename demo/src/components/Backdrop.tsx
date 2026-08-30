import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { BACKDROP, WEAVE } from '../theme.ts';

/** Drifting warm blobs, as on the lobby screen. */
const Blob: React.FC<{
  size: number;
  color: string;
  left: string;
  top: string;
  phase: number;
}> = ({ size, color, left, top, phase }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) * 0.35 + phase;
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        filter: 'blur(60px)',
        opacity: 0.4,
        transform: `translate(${Math.sin(t) * 40}px, ${Math.cos(t * 0.8) * 26}px)`,
      }}
    />
  );
};

export const Backdrop: React.FC<{ weave?: boolean }> = ({ weave = true }) => (
  <div style={{ position: 'absolute', inset: 0, background: BACKDROP, overflow: 'hidden' }}>
    <Blob size={520} color="#ff9d3d" left="-6%" top="-12%" phase={0} />
    <Blob size={620} color="#e8503a" left="72%" top="52%" phase={2.1} />
    <Blob size={420} color="#2ec4a0" left="46%" top="-18%" phase={4.2} />
    {weave ? <div style={{ position: 'absolute', inset: '-10%', background: WEAVE }} /> : null}
  </div>
);
