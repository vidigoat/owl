/**
 * Answering by description, for the machines that have no codes to answer by.
 *
 *   node data/library.test.js
 *
 * Current manuals key their troubleshooting on a sentence rather than a code — "all the lights are
 * flashing", "there is water in the bottom" — which is also, conveniently, what somebody says out
 * loud. So the library has to be able to answer that question.
 *
 * A sentence is ambiguous where a fault code is not, and that changes what a correct answer looks
 * like. Every test below is about refusing to collapse that ambiguity: hand back the shortlist,
 * name the machines this cannot be asked of, and never let "I have no record of this" read as
 * "nothing is wrong".
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
 * The library loads `data/admitted/` at require time, so a test that wants a known machine has to
 * put one there. It is written to a throwaway directory and the module is loaded from a copy
 * pointed at it, which is uglier than injection would be and considerably more honest than testing
 * a different code path than the one that ships.
 */
function library(admitted = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
  fs.mkdirSync(path.join(root, 'admitted'), { recursive: true });
  for (const rec of admitted) {
    fs.writeFileSync(path.join(root, 'admitted', `${rec.model}.json`), JSON.stringify(rec));
  }

  const src = fs.readFileSync(path.join(__dirname, 'service-data.js'), 'utf8')
    .replace("path.join(__dirname, 'admitted')", JSON.stringify(path.join(root, 'admitted')));
  const file = path.join(root, 'service-data.js');
  fs.writeFileSync(file, src);
  return require(file);
}

const machine = (over = {}) => ({
  model: 'TESTDW1',
  brand: 'Bosch',
  kind: 'Dishwasher',
  reviewed: true,
  reviewedBy: 'a reviewer',
  source: 'TESTDW1.pdf',
  codes: {},
  symptoms: [
    {
      id: 'all-leds-light-up-or-flash',
      symptom: 'All LEDs light up or flash.',
      causes: [{ id: 'a-0', label: 'Electronics have detected a fault.', remedies: ['Press the main switch for 4 seconds.'], cost: null }],
    },
    {
      id: 'refill-indicator-for-rinse-aid-lights-up',
      symptom: 'Refill indicator for rinse aid lights up.',
      causes: [{ id: 'b-0', label: 'No rinse aid.', remedies: ['Add rinse aid.'], cost: null }],
    },
    {
      id: 'refill-indicator-for-rinse-aid-does-not-light-up',
      symptom: 'Refill indicator for rinse aid does not light up.',
      causes: [{ id: 'c-0', label: 'Rinse aid system is switched off.', remedies: ['Set the amount of rinse aid.'], cost: null }],
    },
  ],
  ...over,
});

console.log('answering by description');

/* ── matching ─────────────────────────────────────────────────────────────── */

it('a description finds the symptom it describes', () => {
  const lib = library([machine()]);
  const r = lib.lookupSymptom('TESTDW1', 'all the LEDs are flashing');
  assert.equal(r.known, true);
  assert.equal(r.matches[0].symptom, 'All LEDs light up or flash.');
});

it('an ambiguous description returns every candidate, ranked', () => {
  /*
   * "The rinse aid light is on" matches both the indicator lighting up AND it not lighting up,
   * because they share nearly every word. Picking one is a guess dressed as an answer; the device
   * already knows how to ask a question, so hand it the shortlist.
   */
  const lib = library([machine()]);
  const r = lib.lookupSymptom('TESTDW1', 'the rinse aid indicator does not light up');
  assert.equal(r.known, true);
  assert.ok(r.matches.length > 1, 'an ambiguous description was resolved to one answer');
  assert.ok(r.matches[0].match >= r.matches[1].match, 'the shortlist is not ranked');
});

it('noise words do not carry a match', () => {
  // Otherwise "is the it a" matches everything, because every sentence contains those.
  const lib = library([machine()]);
  assert.equal(lib.lookupSymptom('TESTDW1', 'is it the a of').known, false);
});

/* ── refusing ─────────────────────────────────────────────────────────────── */

it('no record of a description is not "nothing is wrong"', () => {
  /*
   * The single most dangerous sentence this product could say. The manual lists what it lists; a
   * problem it does not list is a problem the manual is silent about, not a problem that is absent.
   */
  const lib = library([machine()]);
  const r = lib.lookupSymptom('TESTDW1', 'it is making a loud grinding noise');
  assert.equal(r.known, false);
  assert.match(r.reason, /not the same as nothing being wrong/);
  assert.equal(r.available.length, 3, 'it did not say what the manual DOES cover');
});

it('a machine recorded by code says so, rather than answering emptily', () => {
  // A different question, not an empty answer. "I have no symptoms for this" would read as "this
  // machine has no known problems", which is the opposite of true.
  const lib = library([machine({ model: 'CODEDW1', symptoms: [], codes: { E24: { meaning: 'x', causes: [] } } })]);
  const r = lib.lookupSymptom('CODEDW1', 'all the lights are flashing');
  assert.equal(r.known, false);
  assert.match(r.reason, /recorded by fault code/);
  assert.match(r.reason, /Read the code off the panel/);
});

it('an unknown machine is an unknown machine', () => {
  assert.match(library([]).lookupSymptom('GHOST', 'anything').reason, /No service data/);
});

/* ── provenance ───────────────────────────────────────────────────────────── */

it('the answer says how the library knows', () => {
  // The three tiers are the product. A symptom read by a model and checked by a person is a
  // different kind of fact from one somebody wrote out by hand, and the caller can say which.
  const lib = library([machine()]);
  const r = lib.lookupSymptom('TESTDW1', 'all the LEDs are flashing');
  assert.match(r.provenance, /checked by a reviewer/);
});

it('an unreviewed record never answers', () => {
  // The directory is on disk. The one thing that must not happen is an unchecked machine answering
  // as a checked one.
  const lib = library([machine({ reviewed: false })]);
  assert.equal(lib.lookupSymptom('TESTDW1', 'all the LEDs are flashing').known, false);
});

/* ── the measure itself ───────────────────────────────────────────────────── */

it('a plural is not a different word', () => {
  /*
   * This chose the opposite answer. "The rinse aid light keeps coming on" scored 0.6 against
   * "Refill indicator for rinse aid DOES NOT light up" and 0.4 — under the floor — against
   * "...lights up", so the single symptom returned was the opposite of the one meant. The entire
   * difference was "light" against "lights".
   *
   * Stemmed, both score the same and both come back, which is the honest answer: a sentence this
   * measure cannot separate is one to ask about, not to resolve.
   */
  const lib = library([machine()]);
  const r = lib.lookupSymptom('TESTDW1', 'the rinse aid light keeps coming on');
  assert.equal(r.known, true);
  assert.equal(r.matches.length, 2, 'a plural decided which of two opposite symptoms was returned');
  assert.equal(r.matches[0].match, r.matches[1].match, 'one was ranked above the other on a plural');
});

it('a rare word outweighs a common one', () => {
  /*
   * Plain overlap counts every word the same and is wrong in both directions at once. Measured on
   * a real machine: "the salt light is on" came back with FIVE candidates, because "light" and
   * "indicator" appear in half the symptoms a dishwasher documents. And "the dishes are covered in
   * foam" came back with NONE, because "Excessive formation of foam occurs." is four words long
   * and sharing one of them is under any sensible fraction — even though "foam" appears in exactly
   * one symptom on that machine and is the most informative word either sentence contains.
   */
  const lib = library([machine({
    symptoms: [
      { id: 'foam', symptom: 'Excessive formation of foam occurs.', causes: [{ id: 'f', label: 'Rinse aid spilled.', remedies: ['Wipe it.'] }] },
      { id: 'rinse-on', symptom: 'Refill indicator for rinse aid lights up.', causes: [{ id: 'a', label: 'No rinse aid.', remedies: ['Add some.'] }] },
      { id: 'rinse-off', symptom: 'Refill indicator for rinse aid does not light up.', causes: [{ id: 'b', label: 'System is off.', remedies: ['Set it.'] }] },
      { id: 'salt-on', symptom: 'Special salt refill indicator lights up.', causes: [{ id: 'c', label: 'No salt.', remedies: ['Add salt.'] }] },
    ],
  })]);

  const foam = lib.lookupSymptom('TESTDW1', 'the dishes are covered in foam');
  assert.equal(foam.known, true, 'the one informative word in the sentence was ignored');
  assert.equal(foam.matches[0].symptom, 'Excessive formation of foam occurs.');

  // "salt" narrows to one symptom; "indicator" and "light" narrow to nothing much.
  const salt = lib.lookupSymptom('TESTDW1', 'the salt light is on');
  assert.equal(salt.matches[0].symptom, 'Special salt refill indicator lights up.');
  assert.ok(salt.matches.length <= 2, `a two-word query returned ${salt.matches.length} candidates`);
});

it('a description made only of words the manual never uses is refused', () => {
  /*
   * "Loud grinding noise" shares nothing with anything, and the answer is that the manual is
   * silent — not that the machine is healthy. Words the manual never prints are dropped rather
   * than counted against a match, so a sentence made entirely of them scores nothing at all.
   */
  const lib = library([machine()]);
  const r = lib.lookupSymptom('TESTDW1', 'it is making a loud grinding noise');
  assert.equal(r.known, false);
  assert.match(r.reason, /not the same as nothing being wrong/);
});

it('overlap is a fraction of the shorter description, and is symmetric', () => {
  const { overlap } = library([]);
  assert.equal(overlap('rinse aid light', 'rinse aid light'), 1);
  assert.equal(overlap('rinse aid light', 'light rinse aid'), 1, 'word order changed the score');
  assert.equal(overlap('grinding noise', 'rinse aid light'), 0);
  assert.equal(overlap('', 'anything'), 0);
});

console.log(`\n${passed} passed`);
