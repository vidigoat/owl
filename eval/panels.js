#!/usr/bin/env node
/**
 * Rendered appliance panels, for measuring the reader before real photographs exist.
 *
 *   npm run panels      # draw them
 *   npm run eval        # score the reader against them, with real Bedrock
 *
 * **These are not photographs and must never be counted as photographs.** They are drawn, so they
 * are missing everything a kitchen adds: glare on gloss plastic, a hand in the frame, the phone at
 * an angle, a dark utility room, a scratched fascia. A reader that scores well here has proved it
 * can read a display; it has not proved it can read *your* display. `eval/photos/` stays the gold
 * standard and is reported separately.
 *
 * What they are good for is the thing that could not be done at all until today: exercising the
 * real Bedrock call, on the real prompt, and finding out whether the model returns something the
 * parser accepts — including on the panels where the correct answer is "no fault code", which is
 * where a vision model is most likely to invent one.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'rendered');
const CHROME =
  process.env.CHROME ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
   '/Applications/Chromium.app/Contents/MacOS/Chromium',
   '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

/* ── the panels ────────────────────────────────────────────────────────────
 * Filenames follow eval/photos/README.md, so the same scorer reads both:
 *   <brand>-<kind>-<expected>.png   ·  "clean" means there must be no code.
 */
const PANELS = [
  {
    file: 'bosch-dishwasher-panel-e24.png',
    note: 'red seven-segment on a dark fascia — the commonest way a dishwasher shows a fault',
    html: seg({ bg: '#15171a', ink: '#ff3b2f', text: 'E24', sub: 'BOSCH', width: 900, height: 620 }),
  },
  {
    file: 'lg-washer-panel-oe.png',
    note: 'LG letter-pair code, white on near-black, wide fascia',
    html: seg({ bg: '#0c0d0f', ink: '#eef2f8', text: 'OE', sub: 'LG', width: 1000, height: 560, letter: 0.08 }),
  },
  {
    file: 'whirlpool-washer-panel-f21.png',
    note: 'dot-matrix style, amber, with surrounding control text to distract from the code',
    html: matrix({ code: 'F21', brand: 'WHIRLPOOL', ink: '#ffb020' }),
  },
  {
    file: 'samsung-fridge-panel-clean.png',
    note: 'THE HARD ONE: numbers everywhere and no fault at all. It must not read 38 as a code.',
    html: fridge(),
  },
  {
    file: 'ge-oven-panel-clean.png',
    note: 'a clock. Also no fault. 12:47 is not a fault code.',
    html: seg({ bg: '#101215', ink: '#7fd4c1', text: '12:47', sub: 'GE', width: 900, height: 560 }),
  },
  {
    file: 'bosch-dishwasher-plate-she3ar75uc.png',
    note: 'a rating plate — small print, model number among a dozen other numbers',
    html: plate(),
  },
];

/* ── drawing ──────────────────────────────────────────────────────────────
 * Deliberately not photoreal. Pretending a render is a photograph would make the score a lie; the
 * point is a legible display in a plausible housing, so the reader is tested on reading rather than
 * on denoising.
 */

function shell(body, w, h) {
  return `<!doctype html><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=DSEG7-Classic&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap');
  *{box-sizing:border-box;margin:0}
  body{width:${w}px;height:${h}px;display:grid;place-items:center;background:#2a2d31;
       font-family:"IBM Plex Sans",system-ui,sans-serif}
  .housing{width:88%;height:80%;border-radius:18px;position:relative;overflow:hidden;
    box-shadow:0 30px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08)}
  /* a soft sheen, the one thing from a real fascia worth imitating */
  .housing::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(118deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,0) 38%)}
</style>${body}`;
}

function seg({ bg, ink, text, sub, width, height, letter = 0.06 }) {
  return shell(`<div class="housing" style="background:${bg};display:grid;place-items:center">
    <div style="text-align:center">
      <div style="font-family:'IBM Plex Mono',monospace;font-weight:600;color:${ink};
        font-size:${Math.round(height * 0.34)}px;letter-spacing:${letter}em;
        text-shadow:0 0 28px ${ink}55">${text}</div>
      <div style="margin-top:${Math.round(height * 0.07)}px;color:#8b93a1;letter-spacing:.34em;
        font-size:${Math.round(height * 0.035)}px">${sub}</div>
    </div></div>`, width, height);
}

function matrix({ code, brand, ink }) {
  return shell(`<div class="housing" style="background:#141416;display:flex;align-items:center;
      justify-content:space-between;padding:0 7%">
      <div style="color:#5d6470;font-size:19px;line-height:2.1;letter-spacing:.12em">
        NORMAL<br>HEAVY<br>DELICATE<br>RINSE
      </div>
      <div style="text-align:center">
        <div style="font-family:'IBM Plex Mono',monospace;font-weight:600;color:${ink};
          font-size:150px;letter-spacing:.07em;text-shadow:0 0 30px ${ink}55">${code}</div>
        <div style="margin-top:16px;color:#6b7280;letter-spacing:.3em;font-size:16px">${brand}</div>
      </div>
      <div style="color:#5d6470;font-size:19px;line-height:2.1;letter-spacing:.12em;text-align:right">
        START<br>PAUSE<br>DELAY<br>LOCK
      </div>
    </div>`, 1100, 560);
}

/** Numbers everywhere, none of them a fault. This is where a vision model invents one. */
function fridge() {
  return shell(`<div class="housing" style="background:#0a1420;display:flex;align-items:center;
      justify-content:space-around;color:#6fc3ff;font-family:'IBM Plex Mono',monospace">
      <div style="text-align:center">
        <div style="font-size:112px;font-weight:600;text-shadow:0 0 26px #6fc3ff44">38</div>
        <div style="color:#5b7288;letter-spacing:.26em;font-size:15px;margin-top:10px">FRIDGE °F</div>
      </div>
      <div style="width:1px;height:58%;background:#1b3448"></div>
      <div style="text-align:center">
        <div style="font-size:112px;font-weight:600;text-shadow:0 0 26px #6fc3ff44">0</div>
        <div style="color:#5b7288;letter-spacing:.26em;font-size:15px;margin-top:10px">FREEZER °F</div>
      </div>
      <div style="text-align:left;color:#4d6478;font-size:17px;line-height:2.2;letter-spacing:.1em">
        ICE MAKER ON<br>FILTER OK<br>DOOR CLOSED<br>SAMSUNG
      </div>
    </div>`, 1200, 540);
}

/** A rating plate: the model number hidden among a dozen equally plausible numbers. */
function plate() {
  return shell(`<div class="housing" style="background:#e8e6e0;color:#16181b;padding:5% 6%;
      font-family:'IBM Plex Mono',monospace;font-size:20px;line-height:1.95">
      <div style="font-family:'IBM Plex Sans';font-weight:600;font-size:30px;letter-spacing:.06em">BOSCH</div>
      <div style="height:1px;background:#16181b33;margin:14px 0 18px"></div>
      <div>MODEL&nbsp;&nbsp;&nbsp;&nbsp;SHE3AR75UC</div>
      <div>FD&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;9902&nbsp;&nbsp;&nbsp;&nbsp;E-NR 0123</div>
      <div>SERIAL&nbsp;&nbsp;&nbsp;471002839</div>
      <div>120V ~ 60Hz&nbsp;&nbsp;&nbsp;12A&nbsp;&nbsp;&nbsp;1440W</div>
      <div style="margin-top:12px;font-size:16px;color:#444a52">
        MADE IN USA&nbsp;&nbsp;·&nbsp;&nbsp;BSH HOME APPLIANCES&nbsp;&nbsp;·&nbsp;&nbsp;UL 749
      </div>
    </div>`, 980, 620);
}

/* ── render ───────────────────────────────────────────────────────────────── */

if (require.main === module) {
  if (!CHROME) {
    console.error('No Chrome found. Set CHROME=/path/to/chrome.');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'panels-'));

  for (const p of PANELS) {
    const src = path.join(tmp, p.file.replace(/\.png$/, '.html'));
    fs.writeFileSync(src, p.html);
    const m = p.html.match(/width:(\d+)px;height:(\d+)px/);
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb',
      `--window-size=${m[1]},${m[2]}`, '--virtual-time-budget=4000',
      `--screenshot=${path.join(OUT, p.file)}`, `file://${src}`,
    ], { stdio: 'ignore' });
    console.log(`  ${p.file.padEnd(42)} ${Math.round(fs.statSync(path.join(OUT, p.file)).size / 1024)} kB`);
    console.log(`    ${p.note}`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${PANELS.length} panels in eval/rendered/ — drawn, not photographed.`);
  console.log('They measure whether the reader reads. Only eval/photos/ measures whether it reads a kitchen.');
}

module.exports = { PANELS, OUT };
