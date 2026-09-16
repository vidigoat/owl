#!/usr/bin/env node
/**
 * The README's images, taken from a real run.
 *
 *   npm run capture
 *
 * Headless Chrome presses the same buttons a person would — there is no back door into a state the
 * software cannot reach on its own. The rule in docs/media/README.md is that nothing is committed
 * unless it is a real capture of a real run; the simplest way to keep that rule is to make the
 * capture the only way an image gets here.
 */

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHROME =
  process.env.CHROME ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
   '/Applications/Chromium.app/Contents/MacOS/Chromium',
   '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('No Chrome found. Set CHROME=/path/to/chrome, or capture by hand — the frames are listed in docs/media/README.md');
  process.exit(1);
}

const OUT = path.join(__dirname, '..', 'docs', 'media');
const PORT = 8799; // not the usual port, so this never fights a server you have open
const BASE = `http://localhost:${PORT}`;

/** Each frame names a moment the device can actually reach. See FRAMES in public/app.js. */
const SHOTS = [
  { file: 'hero.png', at: 'hero', size: '1280,1000' },
  { file: 'collapse.png', at: 'collapse', size: '1280,1000' },
  { file: 'refusal.png', at: 'refusal', size: '1280,900' },
  { file: 'teach.png', at: 'teach', size: '1280,1000' },
  { file: 'learned.png', at: 'learned', size: '1280,1000' },
  { file: 'guide.png', at: 'guide', size: '1280,900' },
  { file: 'checkout.png', at: 'checkout', size: '1280,1000' },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  process.on('exit', () => server.kill());

  let up = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/api/session`)).ok) { up = true; break; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!up) {
    console.error(`The server never came up on ${PORT}. Try \`npm start\` and look at the error.`);
    server.kill();
    process.exit(1);
  }

  for (const shot of SHOTS) {
    const dest = path.join(OUT, shot.file);
    execFileSync(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      `--window-size=${shot.size}`,
      '--virtual-time-budget=20000', // the device answers questions on a timer; let it get there
      `--screenshot=${dest}`,
      `${BASE}/?at=${shot.at}`,
    ], { stdio: 'ignore' });

    const kb = Math.round(fs.statSync(dest).size / 1024);
    console.log(`  ${shot.file.padEnd(16)} ${shot.size.padEnd(11)} ${kb} kB${kb < 12 ? '   ← suspiciously small, look at it' : ''}`);
  }

  server.kill();
  console.log(`\n${SHOTS.length} frames in docs/media/ — every one a real run, nothing posed.`);
})();
