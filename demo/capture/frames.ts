// Somewhere to put screencast frames without stalling the CDP event loop.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface CapturedFrame {
  /** File name inside the sink's directory. */
  file: string;
  /** Chromium's frame timestamp, in seconds. Only the deltas matter. */
  t: number;
}

export class FrameSink {
  readonly frames: CapturedFrame[] = [];
  private n = 0;
  /** Serialised writes: JPEGs land in order and never overlap. */
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string) {}

  async open(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  push(base64: string, t: number): void {
    const file = `${String(this.n++).padStart(6, '0')}.jpg`;
    this.frames.push({ file, t });
    const buf = Buffer.from(base64, 'base64');
    this.tail = this.tail.then(() => writeFile(path.join(this.dir, file), buf));
  }

  async close(): Promise<void> {
    await this.tail;
  }
}
