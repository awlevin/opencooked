#!/usr/bin/env node
/* ---------------------------------------------------------------
   Overcooked Party — brand asset generator.

   Each asset is an HTML page in this folder, laid out at its exact
   export size. This script serves the folder over http (ES modules
   are blocked on file://), screenshots each page with Playwright,
   writes the PNGs, then verifies every output's IHDR dimensions.

   A rename or a palette change is one edit + `npm run generate`.
   --------------------------------------------------------------- */

import { createServer } from 'node:http';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../..');

/** Every asset: source page, export size, destination. */
const ASSETS = [
  { page: 'banner.html', width: 2400, height: 800, out: 'assets/banner.png' },
  { page: 'og.html', width: 1200, height: 630, out: 'app/opengraph-image.png' },
  { page: 'icon.html', width: 512, height: 512, out: 'app/icon.png' },
];

/** Byte-for-byte duplicates, written after the pages render. */
const COPIES = [{ from: 'app/opengraph-image.png', to: 'app/twitter-image.png' }];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function serve() {
  const server = createServer(async (req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(
      /^\/+/,
      '',
    );
    try {
      // Deliberately flat: only files directly inside this folder are served.
      if (!name || name.includes('/')) throw new Error('not found');
      const body = await readFile(join(HERE, name));
      res.writeHead(200, {
        'content-type': MIME[extname(name)] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () =>
      ok({ server, port: server.address().port }),
    );
  });
}

/** PNG IHDR is always the first chunk: width at byte 16, height at 20. */
async function pngSize(path) {
  const buf = await readFile(path);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error(`${path}: not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  const { server, port } = await serve();
  const browser = await chromium.launch();
  const results = [];

  try {
    for (const a of ASSETS) {
      const page = await browser.newPage({
        viewport: { width: a.width, height: a.height },
        deviceScaleFactor: 1,
      });
      await page.goto(`http://127.0.0.1:${port}/${a.page}`, {
        waitUntil: 'networkidle',
      });
      // Both the drawing scripts and the webfont must have landed, or the
      // lockup renders in a fallback face and every metric shifts.
      await page.waitForSelector('body[data-ready="1"]');
      await page.evaluate(() => document.fonts.ready);

      const usedFallback = await page.evaluate(() =>
        document.fonts.check('800 100px "Baloo 2"') ? false : true,
      );
      if (usedFallback && a.page !== 'icon.html') {
        throw new Error(
          `${a.page}: Baloo 2 did not load — the lockup would render in a fallback face`,
        );
      }

      // Guard against a rename silently pushing type out of the frame or
      // under the artwork: every text/card box must sit inside the export.
      const spills = await page.evaluate(() => {
        const frame = document.getElementById('frame').getBoundingClientRect();
        const out = [];
        for (const el of document.querySelectorAll(
          '.lockup > *, .title h1, .card',
        )) {
          const r = el.getBoundingClientRect();
          if (
            r.left < frame.left - 0.5 ||
            r.top < frame.top - 0.5 ||
            r.right > frame.right + 0.5 ||
            r.bottom > frame.bottom + 0.5
          ) {
            out.push(`${el.className || el.tagName} ${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}`);
          }
        }
        return out;
      });
      if (spills.length > 0) {
        throw new Error(`${a.page}: content outside the frame:\n    ${spills.join('\n    ')}`);
      }

      const dest = join(REPO, a.out);
      await mkdir(resolve(dest, '..'), { recursive: true });
      await page.locator('#frame').screenshot({ path: dest, type: 'png' });
      await page.close();

      const size = await pngSize(dest);
      results.push({ out: a.out, got: size, want: { width: a.width, height: a.height } });
    }

    for (const cp of COPIES) {
      const dest = join(REPO, cp.to);
      await copyFile(join(REPO, cp.from), dest);
      const src = ASSETS.find((a) => a.out === cp.from);
      results.push({
        out: cp.to,
        got: await pngSize(dest),
        want: { width: src.width, height: src.height },
      });
    }

    // A 32px proof of the icon, upscaled with nearest-neighbour so the
    // downscaled silhouette can actually be inspected by eye.
    await mkdir(join(HERE, '.preview'), { recursive: true });
    const proof = await browser.newPage({
      viewport: { width: 320, height: 320 },
    });
    const iconData = (await readFile(join(REPO, 'app/icon.png'))).toString(
      'base64',
    );
    await proof.setContent(
      `<body style="margin:0;background:#fff">
         <canvas id="a" width="320" height="320"></canvas>
         <script>
           const img = new Image();
           img.onload = () => {
             const s = document.createElement('canvas');
             s.width = 32; s.height = 32;
             s.getContext('2d').drawImage(img, 0, 0, 32, 32);
             const c = document.getElementById('a').getContext('2d');
             c.imageSmoothingEnabled = false;
             c.drawImage(s, 0, 0, 320, 320);
             document.body.dataset.ready = '1';
           };
           img.src = 'data:image/png;base64,${iconData}';
         </script>
       </body>`,
    );
    await proof.waitForSelector('body[data-ready="1"]');
    await proof
      .locator('#a')
      .screenshot({ path: join(HERE, '.preview/icon-32.png') });
    await proof.close();
  } finally {
    await browser.close();
    server.close();
  }

  let bad = 0;
  for (const r of results) {
    const ok = r.got.width === r.want.width && r.got.height === r.want.height;
    if (!ok) bad += 1;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${r.out.padEnd(28)} ${r.got.width}×${r.got.height}` +
        (ok ? '' : ` (expected ${r.want.width}×${r.want.height})`),
    );
  }
  if (bad > 0) {
    console.error(`\n${bad} asset(s) have the wrong dimensions.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll brand assets regenerated at the expected sizes.');
}

await main();
