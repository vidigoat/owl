/**
 * The gate has to be the only gate.
 *
 * This project's claim is not "it diagnoses appliances". It is that **exactly one function can
 * authorise spending somebody's money**, that it refuses on four specific grounds, and that
 * everything else in the repository offers rather than decides.
 *
 * A claim of that shape is not proven by testing the gate. It is proven by there being nowhere
 * else. A second place that opens a cart, or decides a cause is upheld, or assigns a price, would
 * make the claim false in precisely the file a reviewer would not think to open.
 *
 * So this is a test about the shape of the repository rather than about behaviour, and it is the
 * one most likely to catch a future change that is individually reasonable.
 *
 * Run: node mcp/architecture.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

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

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'docs', 'eval']);

function sources(dir = ROOT, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, found);
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) found.push(full);
  }
  return found;
}

/**
 * Comments are stripped before any of this matches.
 *
 * The first version of this file failed three times and was wrong all three: it found the word
 * "prices" in a sentence explaining why the parser does not assign one, and `simulated: true`
 * inside a paragraph about why that flag matters. A structural test that fires on prose is a test
 * somebody deletes, and it deserves to be deleted — so it reads code only.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const FILES = sources().map((f) => ({
  rel: path.relative(ROOT, f),
  text: stripComments(fs.readFileSync(f, 'utf8')),
  raw: fs.readFileSync(f, 'utf8'),
}));
const find = (rel) => FILES.find((f) => f.rel === rel).text;

console.log('architecture');

it('one function decides whether money may be spent', () => {
  // Producing maySpend is deciding. Reading it is obeying. Only one file may do the first.
  const producers = FILES
    .filter((f) => /maySpend\s*:/.test(f.text))
    .map((f) => f.rel);
  assert.deepEqual(producers, ['mcp/tools/verify_diagnosis.js'],
    `these decide whether money may be spent: ${producers.join(', ')}`);
});

it('the only place a cart opens is behind that decision', () => {
  const src = find('mcp/tools/order_part.js');
  assert.match(src, /verify_diagnosis\(/, 'checkout no longer consults the gate at all');
  assert.match(src, /!verdict\.maySpend/, 'checkout no longer refuses when the gate says no');

  // And nothing else opens one. Passing a sessionId is using a checkout; MAKING one is opening it.
  const openers = FILES
    .filter((f) => f.rel !== 'mcp/tools/order_part.js')
    .filter((f) => /function beginCheckout|sessions\.set\(|state:\s*'open'/.test(f.text))
    .map((f) => f.rel);
  assert.deepEqual(openers, [], `these open a checkout of their own: ${openers.join(', ')}`);
});

it('the four refusals are all still in the gate', () => {
  // Each of these has a reason a person can act on, and losing one silently is the failure mode
  // this file exists for. They are the product.
  const src = find('mcp/tools/verify_diagnosis.js');
  assert.match(src, /mains/i, 'the mains-voltage refusal is gone');
  assert.match(src, /SEPARATION/, 'the too-close-to-call refusal is gone');
  assert.match(src, /ruledOut/, 'the cheaper-cause-first refusal is gone');
  assert.match(src, /abstain/, 'the gate no longer abstains at all');
});

it('a price comes from service data, never from a manual', () => {
  // The boundary the hostile-manual tests rely on. A learned machine can name a part; only the
  // catalogue can put a number on one.
  const learned = find('manual/faultgraph.js');
  assert.match(learned, /cost: null/, 'the manual parser has started assigning costs');
  assert.ok(!/price\s*[:=]|\$\d/.test(learned), 'the manual parser has started quoting prices');

  const catalogue = FILES.filter((f) => /CATALOGUE|ALTERNATIVE/.test(f.text)).map((f) => f.rel);
  assert.deepEqual(catalogue, ['mcp/tools/find_part.js'], `parts data lives in: ${catalogue.join(', ')}`);
});

it('the device decides nothing', () => {
  // Every fact on screen came back from a tool call. A front-end that computed a probability, a
  // severity or an eligibility would make the MCP surface decorative — and Alexa+ driving this
  // instead of a browser is the entire premise.
  const app = find('public/app.js');
  assert.ok(!/maySpend\s*:/.test(app), 'the device decides whether money may be spent');
  assert.ok(!/function\s+entropy|Math\.log2/.test(app), 'the device computes its own uncertainty');
  assert.ok(!/upheld\s*[:=]\s*(true|false)/.test(app), 'the device upholds a diagnosis by itself');
});

it('nothing outside see.js talks to Bedrock', () => {
  // One prompt, one parser, one place where a simulated read is labelled. Three of the four bugs
  // found on first contact with real AWS were in that seam; a second copy of it would be a second
  // set of them.
  const callers = FILES.filter((f) => /bedrock-runtime/.test(f.text)).map((f) => f.rel).sort();
  assert.deepEqual(callers, ['mcp/tools/read_manual.js', 'mcp/tools/see.js', 'scripts/preflight.js'],
    `these call Bedrock: ${callers.join(', ')}`);
  // read_manual is transcription and see.js is reading a panel — different prompts, deliberately,
  // because a transcription task is much harder to hijack. preflight exists to prove the path.
});

it('every simulated answer goes through one labeller', () => {
  const src = find('mcp/tools/see.js');
  assert.match(src, /function simulatedRead/, 'the one helper that cannot forget the label is gone');
  const label = (src.match(/simulated: true/g) || []).length;
  assert.equal(label, 1, `simulated: true is written in ${label} places; it should be one`);
});

console.log(`\n${passed} passed`);
