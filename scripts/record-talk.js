#!/usr/bin/env node
/**
 * A screen recording of the live agent at /talk.html — real footage for the video.
 *
 *   AWS_PROFILE=bedrock npm start                 # in another terminal
 *   node scripts/record-talk.js [http://localhost:8792]
 *
 * The person's lines are typed on screen so it is plain which half is scripted; everything Alexa+
 * says, every tool call listed under it, and the card on the screen are that turn's, live. Nothing
 * is retaken: a recording that keeps only the good takes is the thing this project argues against.
 * About three cents of Bedrock. Writes public/media/talk.webm, which /talk.html plays where it cannot talk. Needs Playwright (not a dependency).
 */
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Needs Playwright (not a dependency of this project): npm i -g playwright, or set NODE_PATH.');
  process.exit(1);
}
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:8792';
const OUT = path.join(__dirname, '..', 'public', 'media'); // served, so the hosted /talk.html can play it
// The first conversation starts from the screen, not the keyboard: the house's own record offers
// "E24 on the dishwasher, three times" as something to ask about, and pressing it asks. Needs a
// household on record — `npm run home:demo` loads the made-up one.
const CONVERSATIONS = [
  [{ press: '.needs button' }],
  ['My Bosch dishwasher is showing E24. The model is SHE3AR75UC.', "No — it's completely silent.", 'Yes, order it.', 'Yes.', 'It arrived and I fitted it. It drains now.'],
  ['My SHE3AR75UC is showing E24 again.'],
];

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/talk.html`);
  await p.waitForTimeout(3200); // long enough to read what the house says needs attention
  for (const [i, lines] of CONVERSATIONS.entries()) {
    if (i) { await p.click('#restart'); await p.waitForTimeout(1200); }
    for (const line of lines) {
      const n = await p.locator('.turn').count();
      if (line.press) {
        if (!(await p.locator(line.press).count())) { console.log(`  (nothing to press at ${line.press} — no household on record; skipped)`); continue; }
        await p.hover(line.press);
        await p.waitForTimeout(700);
        await p.click(line.press);
      } else {
        await p.click('#input');
        await p.keyboard.type(line, { delay: 38 });
        await p.waitForTimeout(400);
        await p.click('#send');
      }
      await p.waitForFunction((n) => document.querySelectorAll('.turn').length > n, n, { timeout: 120000 });
      console.log(`  you     ${line.press ? '(pressed the first thing the house says needs attention)' : line}\n  alexa+  ${await p.textContent('#said')}`);
      await p.waitForTimeout(4200); // time to read the card and the line
    }
  }
  const video = p.video();
  await ctx.close();
  const file = path.join(OUT, 'talk.webm');
  fs.renameSync(await video.path(), file);
  console.log(`\n  ${file}`);
  await b.close();
})();
