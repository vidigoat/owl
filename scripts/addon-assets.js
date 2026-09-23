#!/usr/bin/env node
/**
 * The add-on's store images, rendered from the real thing.
 *
 *   npm start    # in another terminal (PORT=8799 npm start, or pass the URL)
 *   node scripts/addon-assets.js http://localhost:8792
 *
 * Icons from public/addon/icon.svg at the six sizes addon.json lists; carousel images are the real
 * MCP App card, in the reference host's bare mode, after real tool calls — not mockups. Needs
 * Playwright, which this project does not depend on: `npx playwright` or a global install.
 */
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Needs Playwright (not a dependency of this project): npm i -g playwright, or run with NODE_PATH set to one.');
  process.exit(1);
}
const fs = require('fs');
const OUT = require('node:path').join(__dirname, '..', 'public', 'addon');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const svg = fs.readFileSync(`${OUT}/icon.svg`, 'utf8');
  for (const n of [64, 72, 88, 126, 180, 241]) {
    const p = await b.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${n}" height="${n}" style="display:block" `)}</body></html>`);
    await p.screenshot({ path: `${OUT}/icon-${n}x${n}.png`, omitBackground: true });
    await p.close();
  }
  const base = process.argv[2] || 'http://localhost:8799';
  for (const [scenario, n, name, caption] of [
    ['pump', 2, 'carousel-1', 'It asks the one check that rules out the most — then waits for you.'],
    ['pump', 5, 'carousel-2', 'No part is sold until the diagnosis is verified and you have heard the total.'],
    ['mains', 2, 'carousel-3', 'Behind mains wiring, it sends you to a technician. At any confidence.'],
  ]) {
    const p = await b.newPage({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 1 });
    await p.goto(`${base}/app-host.html?bare&scenario=${scenario}&auto=${n}&caption=${encodeURIComponent(caption)}`);
    await p.waitForFunction(() => document.body.dataset.done === 'true', null, { timeout: 20000 });
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    await p.close();
  }
  await b.close();
})();
