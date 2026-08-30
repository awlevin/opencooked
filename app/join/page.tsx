'use client';

// Phone controller. The gamepad itself is imperative DOM (components/
// controller/): a re-render must never rebuild a button that a thumb is
// currently holding down, and pointer capture does not survive reconciliation.
// React's only job here is to own the mount point and the lifecycle.

import { useEffect, useRef } from 'react';
import { ControllerApp } from '@/components/controller/app';
import '@/components/controller/controller.css';

export default function JoinPage() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // start() reads ?room= off window.location, so nothing here runs during
    // SSR. destroy() closes the socket and removes every listener, which keeps
    // StrictMode's mount/unmount/mount from joining the room twice.
    const app = new ControllerApp(host);
    app.start();
    return () => app.destroy();
  }, []);

  return <div className="controller-app" ref={hostRef} />;
}
