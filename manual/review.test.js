/**
 * The review bench.
 *
 *   node manual/review.test.js
 *
 * This project's whole argument is that it does not guess, and a vision model reading a
 * seven-segment fault table is right *most of the time* — which is precisely the standard that
 * produces a library nobody can trust. A confidently wrong fault code sends somebody to buy a drain
 * pump for a blocked filter.
 *
 * So there is a human step, and these tests are about the ways a human step can quietly stop being
 * one:
 *
 *   admission is per code      One misread code must not cost the other five, and accepting five
 *                              must not drag the sixth along with them.
 *   a rejection is recorded    A reading the parser keeps getting wrong is a bug report about
 *                              faultgraph. Deleting it means finding it again on the next manual
 *                              from the same manufacturer.
 *   unreviewed is not admitted The directory the library loads from is on disk. The one thing that
 *                              must never happen is an unchecked machine answering as a checked one.
 *
 * The bench found a real error the first time it was used, on the first machine: Bosch's manual
 * prints E:16 and the model read it as E18. That is in here as a fixture.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
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

/*
 * review.js reads and writes `data/pending` and `data/admitted` relative to itself, so a test that
 * exercises it for real has to work in a copy of the module rooted somewhere disposable. Rewriting
 * the two paths is uglier than injecting them would be, and considerably more honest than testing a
 * different code path than the one that ships.
 */
function bench() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  fs.mkdirSync(path.join(root, 'data', 'pending'), { recursive: true });

  const src = fs.readFileSync(path.join(__dirname, 'review.js'), 'utf8')
    .replace("path.join(__dirname, '..', 'data')", JSON.stringify(path.join(root, 'data')));

  const file = path.join(root, 'review.js');
  fs.writeFileSync(file, src);
  return { root, mod: require(file) };
}

const candidate = (over = {}) => ({
  model: 'SMS46KI01E',
  brand: 'Bosch',
  source: 'SMS46KI01E.pdf',
  pages: '39–40',
  readWith: 'bedrock',
  reviewed: false,
  learnedAt: '2026-09-21T12:00:00.000Z',
  codes: {
    E07: { meaning: '', causes: [{ id: 'e07-0', remedy: 'Arrange utensils so that the intake opening is not obstructed.' }] },
    E12: { meaning: '', causes: [{ id: 'e12-0', remedy: 'Clean appliance with dishwasher cleaning agent or descaler.' }] },
    E14: { meaning: '', causes: [{ id: 'e14-0', remedy: 'Turn off water supply.' }] },
    // The real misread: the manual prints E:16 and the model read the seven-segment glyph as 8.
    E18: { meaning: '', causes: [{ id: 'e18-0', label: 'Constant water supply', remedy: null }] },
  },
  ...over,
});

const write = (root, entry) =>
  fs.writeFileSync(path.join(root, 'data', 'pending', `${entry.model}.json`), JSON.stringify(entry));

console.log('the review bench');

/* ── the queue ────────────────────────────────────────────────────────────── */

it('an empty queue is empty, not an error', () => {
  assert.deepEqual(bench().mod.queue(), []);
});

it('the queue summarises without sending every cause', () => {
  const { root, mod } = bench();
  write(root, candidate());
  const [q] = mod.queue();
  assert.equal(q.model, 'SMS46KI01E');
  assert.deepEqual(q.codes.sort(), ['E07', 'E12', 'E14', 'E18']);
  assert.equal(q.causes, 4);
  assert.ok(!('transcribed' in q), 'the queue is carrying full transcripts');
});

it('an unreadable candidate is listed as unreadable, not skipped', () => {
  // A queue that silently drops what it cannot parse is a queue that hides exactly the entries
  // most likely to need somebody.
  const { root, mod } = bench();
  fs.writeFileSync(path.join(root, 'data', 'pending', 'BROKEN.json'), '{ not json');
  const [q] = mod.queue();
  assert.equal(q.error, 'unreadable');
});

it('a model name that is not a filename is refused', () => {
  // Model numbers are filenames here, so they have to be ones.
  const { mod } = bench();
  for (const bad of ['../../etc/passwd', 'a/b', '', '.']) {
    assert.equal(mod.candidate(bad), null, `${bad} was accepted`);
    assert.equal(mod.pageImagePath(bad), null, `${bad} reached the image path`);
  }
});

/* ── admission ────────────────────────────────────────────────────────────── */

it('accepting some codes admits exactly those', () => {
  /*
   * The case this whole screen exists for. Bosch's manual prints E:16; the model read it as E18.
   * A reviewer holding the page against the parse takes the three that match and leaves that one.
   */
  const { root, mod } = bench();
  write(root, candidate());

  const result = mod.admit('SMS46KI01E', ['E07', 'E12', 'E14'], 'a reviewer');
  assert.equal(result.admitted, true);
  assert.deepEqual(result.codes.sort(), ['E07', 'E12', 'E14']);
  assert.deepEqual(result.rejected, ['E18']);

  const record = JSON.parse(fs.readFileSync(path.join(root, 'data', 'admitted', 'SMS46KI01E.json'), 'utf8'));
  assert.deepEqual(Object.keys(record.codes).sort(), ['E07', 'E12', 'E14']);
  assert.ok(!('E18' in record.codes), 'a rejected code was admitted anyway');
});

it('a rejection is written down, not deleted', () => {
  // A reading the parser keeps getting wrong is a bug report about faultgraph. Throwing it away
  // means finding it again on the next manual from the same manufacturer.
  const { root, mod } = bench();
  write(root, candidate());
  mod.admit('SMS46KI01E', ['E07'], 'a reviewer');

  const record = JSON.parse(fs.readFileSync(path.join(root, 'data', 'admitted', 'SMS46KI01E.json'), 'utf8'));
  assert.deepEqual(record.rejected.sort(), ['E12', 'E14', 'E18']);

  const still = mod.candidate('SMS46KI01E');
  assert.equal(still.reviewed, true, 'the candidate did not record that it had been decided');
  assert.deepEqual(still.rejected.sort(), ['E12', 'E14', 'E18']);
});

it('who looked is recorded, because a claim that a person checked it has an author', () => {
  const { root, mod } = bench();
  write(root, candidate());
  mod.admit('SMS46KI01E', ['E07'], 'a reviewer');
  const record = JSON.parse(fs.readFileSync(path.join(root, 'data', 'admitted', 'SMS46KI01E.json'), 'utf8'));
  assert.equal(record.reviewedBy, 'a reviewer');
  assert.equal(record.reviewed, true);
  assert.ok(record.reviewedAt);
});

it('accepting nothing admits nothing', () => {
  // Not an empty machine in the library — no machine. A record with no codes would answer "I know
  // this model" and then have nothing to say about any fault on it.
  const { root, mod } = bench();
  write(root, candidate());
  const result = mod.admit('SMS46KI01E', [], 'a reviewer');
  assert.equal(result.admitted, false);
  assert.equal(fs.existsSync(path.join(root, 'data', 'admitted', 'SMS46KI01E.json')), false);
});

it('admitting something that was never pending is refused', () => {
  const { mod } = bench();
  assert.equal(mod.admit('GHOST', ['E01'], 'a reviewer').admitted, false);
});

it('a code that is not in the candidate cannot be smuggled in', () => {
  // `accept` arrives from a browser. Anything in it that the candidate does not have is not a
  // fault code, it is somebody's typing.
  const { root, mod } = bench();
  write(root, candidate());
  const result = mod.admit('SMS46KI01E', ['E07', 'E99'], 'a reviewer');
  assert.deepEqual(result.codes, ['E07']);
  const record = JSON.parse(fs.readFileSync(path.join(root, 'data', 'admitted', 'SMS46KI01E.json'), 'utf8'));
  assert.ok(!('E99' in record.codes));
});

/* ── what the library loads ───────────────────────────────────────────────── */

it('admitted() returns only records marked reviewed', () => {
  /*
   * `admit` only ever writes reviewed records, but this directory sits on disk and the one thing
   * that must never happen is an unchecked machine answering as a checked one.
   */
  const { root, mod } = bench();
  fs.mkdirSync(path.join(root, 'data', 'admitted'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'data', 'admitted', 'SNEAK.json'),
    JSON.stringify({ model: 'SNEAK', reviewed: false, codes: { E01: {} } })
  );
  assert.deepEqual(Object.keys(mod.admitted()), []);
});

it('no admitted directory is an empty library, not a crash', () => {
  assert.deepEqual(bench().mod.admitted(), {});
});

console.log(`\n${passed} passed`);
