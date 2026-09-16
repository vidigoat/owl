/**
 * Does the interface actually connect to itself?
 *
 * This whole front end was written without a browser to look at, so the failure mode is a button
 * that exists in the markup and is never wired, or a handler reaching for an element that was
 * renamed. Neither shows up as an error anywhere — the button simply does nothing, which you only
 * discover while recording.
 *
 * Static checks, no DOM needed.
 *
 * Run: node public/wiring.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const app = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');

let passed = 0;
const it = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n       ', e.message);
    process.exitCode = 1;
  }
};

// Ids the page declares, plus ids the script renders into a screen itself. Reaching for anything
// outside that union is the bug this catches: a rename in index.html that the script still chases.
const idsInHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const idsRendered = new Set([...app.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]));
const idsAvailable = new Set([...idsInHtml, ...idsRendered]);

const idsWanted = [...app.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)|querySelector\('#([a-zA-Z0-9_-]+)'\)/g)]
  .map((m) => m[1] || m[2])
  .filter(Boolean);

console.log('interface wiring');

it('every element the script reaches for exists in the markup', () => {
  const missing = [...new Set(idsWanted)].filter((id) => !idsAvailable.has(id));
  assert.deepEqual(missing, [], `script looks for #${missing.join(', #')} which nothing creates`);
});

it('every button on the page is wired to something', () => {
  const buttonIds = [...html.matchAll(/<button[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(buttonIds.length >= 4, 'expected several controls');
  const unwired = buttonIds.filter((id) => !app.includes(`'#${id}'`));
  assert.deepEqual(unwired, [], `these buttons do nothing: ${unwired.join(', ')}`);
});

it('every screen the flow can reach is actually defined', () => {
  const flowBlock = app.match(/const FLOW = \{([\s\S]*?)\};/);
  assert.ok(flowBlock, 'no FLOW table found');
  const handlers = [...flowBlock[1].matchAll(/:\s*(\w+)/g)].map((m) => m[1]);
  handlers.forEach((fn) => {
    assert.ok(new RegExp(`function ${fn}\\b`).test(app), `FLOW points at ${fn}() which does not exist`);
  });
});

it('every stage a screen sets is reachable by the flow table', () => {
  const flowBlock = app.match(/const FLOW = \{([\s\S]*?)\};/)[1];
  const flowKeys = new Set([...flowBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));
  const assigned = new Set([...app.matchAll(/\bstage = '(\w+)'/g)].map((m) => m[1]));
  // 'done' is terminal: it is assigned but nothing advances from it, which is correct.
  const orphans = [...assigned].filter((s) => !flowKeys.has(s) && s !== 'done');
  assert.deepEqual(orphans, [], `these stages are set but the flow cannot continue from them: ${orphans.join(', ')}`);
});

it('every class the script renders has a style', () => {
  // Only the structural ones — a missing rule here means an unstyled screen on camera.
  const structural = ['s-space', 's-question', 's-refuse', 's-teach', 's-part', 's-done', 'space', 'cause', 'question', 'answer', 'totals', 'sim-badge'];
  const missing = structural.filter((c) => !css.includes(`.${c}`));
  assert.deepEqual(missing, [], `no styles for: ${missing.join(', ')}`);
});

it('the demo appliance is defined in exactly one place', () => {
  // Anything that hard-codes E24 or SHE3AR75UC elsewhere breaks the moment it is taught a different
  // machine. Two exceptions, both deliberate: the single DEFAULT_APPLIANCE definition, and the
  // refusal demo, which is a fixed illustration of a mains fault on a known model.
  const stripped = app
    .replace(/const DEFAULT_APPLIANCE = \{[^}]*\};/, '')
    .replace(/async function showRefusal[\s\S]*?\n}/, '');

  const hardcoded = [...stripped.matchAll(/'(E24|SHE3AR75UC)'|"(E24|SHE3AR75UC)"/g)].map((m) => m[0]);
  assert.deepEqual(hardcoded, [], `hard-coded appliance values: ${hardcoded.join(', ')}`);
  assert.ok(app.includes('DEFAULT_APPLIANCE'), 'there should be a single definition to point at');
});

console.log(`\n${passed} passed`);
