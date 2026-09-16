#!/usr/bin/env node
/**
 * docs/media/flow.gif — the whole loop, end to end, no cuts.
 *
 *   npm run gif
 *
 * Shoots the run one step at a time and stitches the frames together. Not a screen recording and
 * not an edit: frame N is the device after exactly N presses, so the GIF cannot show a state the
 * software could not reach, and nothing can be quietly trimmed out of the middle.
 *
 * Needs Chrome and ffmpeg.
 */

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME =
  process.env.CHROME ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
   '/Applications/Chromium.app/Contents/MacOS/Chromium',
   '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

const need = (what, hint) => { console.error(`${what} not found. ${hint}`); process.exit(1); };
if (!CHROME) need('Chrome', 'Set CHROME=/path/to/chrome.');
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { need('ffmpeg', 'brew install ffmpeg'); }

const OUT = path.join(__dirname, '..', 'docs', 'media', 'flow.gif');
const FRAMES = Number(process.env.GIF_FRAMES || 13); // the loop is about a dozen presses long
const PORT = 8798;
const SIZE = '1120,880';

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssoh-gif-'));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  process.on('exit', () => { server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/session`)).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  process.stdout.write('  shooting ');
  for (let n = 0; n < FRAMES; n++) {
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb',
      `--window-size=${SIZE}`,
      '--virtual-time-budget=20000',
      `--screenshot=${path.join(tmp, String(n).padStart(3, '0') + '.png')}`,
      `http://localhost:${PORT}/?steps=${n}`,
    ], { stdio: 'ignore' });
    process.stdout.write('·');
  }
  console.log(` ${FRAMES} frames`);
  server.kill();

  // Two passes: build a palette from the whole run, then map to it. One pass produces banding on
  // the flat panels, which is most of this interface.
  const palette = path.join(tmp, 'palette.png');
  const input = ['-framerate', '1/1.15', '-i', path.join(tmp, '%03d.png')];
  const scale = 'scale=880:-1:flags=lanczos';

  execFileSync('ffmpeg', ['-y', ...input, '-vf', `${scale},palettegen=max_colors=192`, palette], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-y', ...input, '-i', palette,
    '-lavfi', `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    '-loop', '0', OUT], { stdio: 'ignore' });

  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log(`  docs/media/flow.gif  ${mb} MB${mb > 9 ? '   ← large for a README; lower GIF_FRAMES or the scale' : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
