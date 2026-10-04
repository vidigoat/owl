#!/usr/bin/env node
/**
 * Put the made-up demo household where the tools read it, so the screen and the agent share one
 * record when recording or trying the live agent on a machine that has remembered nothing.
 *
 *   npm run home:demo            # refuses if a household is already recorded here
 *   npm run home:demo -- --undo  # removes it again — only if it is the demo one
 *
 * It never overwrites a real household: `data/home.json` is somebody's home, and a demo is not
 * worth losing one for. The seeded file carries `demo: true`, and every screen that shows it says so.
 */
const fs = require('node:fs');
const path = require('node:path');
const { STORE } = require('../mcp/tools/home');

const DEMO = path.join(__dirname, '..', 'public', 'home-demo.json');
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const existing = read(STORE);
const holdsSomething = existing && (Object.keys(existing.appliances || {}).length || (existing.receipts || []).length);

if (process.argv.includes('--undo')) {
  if (!existing) { console.log('  Nothing recorded here.'); process.exit(0); }
  if (existing.demo !== true) { console.error('  That is a real household, not the demo one. Left alone.'); process.exit(1); }
  fs.unlinkSync(STORE);
  console.log('  Demo household removed.');
  process.exit(0);
}
if (holdsSomething) {
  console.error(`  A household is already recorded at ${path.relative(process.cwd(), STORE)}${existing.demo === true ? ' (the demo one)' : ''}. Left alone.`);
  process.exit(existing.demo === true ? 0 : 1);
}
const demo = read(DEMO);
if (!demo) { console.error('  public/home-demo.json is missing — build it with node scripts/make-home-demo.js'); process.exit(1); }
fs.mkdirSync(path.dirname(STORE), { recursive: true });
fs.writeFileSync(STORE, JSON.stringify(demo, null, 2));
console.log(`  Demo household loaded: ${Object.keys(demo.appliances || {}).length} machines, ${(demo.receipts || []).length} repairs. Remove it with: npm run home:demo -- --undo`);
