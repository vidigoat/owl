/**
 * The README has to still be true.
 *
 * Three numbers here have already rotted in prose while the code stayed right: a check count in
 * AGENTS.md, and a tool count and a check count in the judging document. Each read as carelessness
 * to exactly the reviewer it was written for, and each was caught by somebody reading carefully,
 * which is not a process.
 *
 * `scripts/check-readme.js` is the process: run the commands, scrape the figures, fail on drift.
 *
 * Run: node readme.test.js
 */

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
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

const README = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');

console.log('readme');

it('every figure it quotes is one a command still produces', () => {
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'check-readme.js')],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    assert.fail(`the README has drifted from the commands:\n${e.stdout || e.message}`);
  }
  assert.match(out, /Every figure these documents quote/);
});

it('no document promises a command that does not exist', () => {
  /*
   * The first thing a reviewer tries. A document pointing at a script that is not there costs more
   * trust than a wrong number does.
   *
   * This was the README only, and matched `[a-z-]+` — so it saw neither `npm run mcp:session`,
   * because of the colon, nor `npm run verify-against-pages` in the recording script, because that
   * is a different file. Both were named in documents while one of them was not a script at all,
   * which is exactly what somebody discovers with a camera running.
   */
  const scripts = require('./package.json').scripts;
  const docs = [
    'README.md',
    ...fs.readdirSync(path.join(__dirname, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join('docs', f)),
  ];

  for (const doc of docs) {
    const text = fs.readFileSync(path.join(__dirname, doc), 'utf8');
    const promised = [...text.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]);
    const missing = [...new Set(promised)].filter((s) => !scripts[s]);
    assert.deepEqual(missing, [], `${doc} promises: ${missing.map((m) => `npm run ${m}`).join(', ')}`);
  }
});

it('every file it points at is really there', () => {
  const linked = [...README.matchAll(/\]\((docs\/[^)#]+|[a-z]+\/[a-z_-]+\.js|[a-z-]+\.js)\)/g)].map((m) => m[1]);
  const missing = [...new Set(linked)].filter((f) => !fs.existsSync(path.join(__dirname, f)));
  assert.deepEqual(missing, [], `README links to: ${missing.join(', ')}`);
});

it('it still says the photographs are missing', () => {
  // The claim this project would be most tempted to soften. The reader is measured against drawings
  // and NOT against a real kitchen, and the day eval/photos has something in it, this test should
  // fail and the sentence should change — which is the point of writing it down this way.
  const photos = fs.existsSync(path.join(__dirname, 'eval', 'photos'))
    ? fs.readdirSync(path.join(__dirname, 'eval', 'photos')).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    : [];
  if (photos.length === 0) {
    assert.match(README, /UNPROVEN/, 'the README stopped admitting that no real photographs exist');
    assert.match(README, /drawings/i);
  } else {
    assert.doesNotMatch(README, /eval\/photos\/` is empty/,
      `there are ${photos.length} photographs now — the README still says there are none`);
  }
});

it('it still states what the gate refuses', () => {
  // The refusals are the product. A README that stopped listing them would be selling something
  // else entirely.
  ['mains', 'ruled out', 'separation|15%', 'NOT VERIFIED'].forEach((needle) =>
    assert.match(README, new RegExp(needle, 'i'), `the README no longer mentions: ${needle}`));
});

it('every file the judging map points at is really there', () => {
  /*
   * The sibling project's map rotted badly — it pointed at four files from an earlier restructure,
   * and nothing caught it because README.md was the checked document and `docs/JUDGING.md` was not.
   * It is the first thing a reviewer opens. A map to files that do not exist spends their goodwill
   * before they have seen anything.
   *
   * This one is clean today. The test is here so it stays that way.
   */
  const map = fs.readFileSync(path.join(__dirname, 'docs', 'JUDGING.md'), 'utf8');
  const named = [...map.matchAll(/`([a-zA-Z][a-zA-Z0-9_/.-]*\.(?:js|md|json|css|html))`/g)].map((m) => m[1]);
  const missing = [...new Set(named)].filter(
    (f) => !fs.existsSync(path.join(__dirname, f)) && !fs.existsSync(path.join(__dirname, 'docs', f))
  );
  assert.deepEqual(missing, [], `docs/JUDGING.md points at files that do not exist: ${missing.join(', ')}`);
});

console.log(`\n${passed} passed`);
