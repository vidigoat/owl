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
    .replace("path.join(__dirname, 'admitted')", JSON.stringify(path.join(root, 'admitted')))
    // The copy lives elsewhere, so its one relative require is pointed back at the real file.
    .replace("require('../manual/faultgraph')", `require(${JSON.stringify(path.join(__dirname, '..', 'manual', 'faultgraph'))})`);
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

it('a match resting only on a common word is refused', () => {
  /*
   * "The salt light came on", asked of a machine whose manual never says "salt", drops that word
   * and matches on "light" alone — which appears in three of that machine's thirteen symptoms —
   * and came back pointing confidently at the rinse aid. At the wrong indicator.
   *
   * A match has to rest on at least one word that NARROWS: present in a fifth or fewer of the
   * symptoms this machine documents. "Rare" is relative to the list, because a fixed cutoff let
   * "light" through on a list of thirteen.
   */
  const cause = (i) => [{ id: `c${i}`, label: 'Something.', remedies: ['Do something.'] }];
  const symptoms = Array.from({ length: 11 }, (_, i) => ({
    id: `s${i}`,
    symptom: `Indicator light for thing ${'x'.repeat(i + 2)} comes on.`,
    causes: cause(i),
  }));
  // One symptom with a word of its own, so the list is not uniformly uninformative.
  symptoms.push({ id: 'foam', symptom: 'Excessive formation of foam occurs.', causes: cause('f') });
  const lib = library([machine({ symptoms })]);

  // "light" is in eleven of twelve; nothing in this question narrows anything.
  assert.equal(lib.lookupSymptom('TESTDW1', 'the salt light came on').known, false);
  // "foam" is in exactly one, so it decides.
  const foam = lib.lookupSymptom('TESTDW1', 'there is foam everywhere');
  assert.equal(foam.known, true);
  assert.equal(foam.matches[0].symptom, 'Excessive formation of foam occurs.');
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

it('a verb and a state are the same word to an owner', () => {
  /*
   * The commonest way somebody differs from a manual, and the one the stemmer existed to miss.
   *
   * A manual writes a STATE — "Dishware is not dry." — and a person describes an ACTION: "the
   * dishes are not drying." Stripping only a trailing "s" leaves those with no word in common, so
   * the library refused, and the refusal was correct about its own arithmetic and useless to the
   * person holding the door open.
   */
  const lib = library([
    machine({
      model: 'TESTDW2',
      symptoms: [
        {
          id: 'not-dry',
          symptom: 'Dishware is not dry.',
          causes: [{ id: 'not-dry-0', label: 'No rinse aid.', likelihood: 0.6, remedies: ['Add rinse aid.'], evidence: 'manual, page 1' }],
        },
      ],
    }),
  ]);

  const r = lib.lookupSymptom('TESTDW2', 'the dishes are not drying');
  assert.equal(r.known, true, 'a tense change was enough to lose the match');
  assert.equal(r.matches[0].symptom, 'Dishware is not dry.');
});

it('stemming is consistent, not correct English', () => {
  /*
   * Both sides go through the same rule, so it only has to agree with itself. These are the pairs
   * the rule was built to collapse, and the doubled consonant is why "running" does not become
   * "runn" and match nothing.
   */
  const { overlap } = library([]);
  for (const [a, b] of [
    ['drying', 'dry'],
    ['draining', 'drains'],
    ['running', 'run'],
    ['making', 'makes'],
    ['blocked', 'blocks'],
  ]) {
    assert.equal(overlap(a, b), 1, `"${a}" and "${b}" do not meet`);
  }

  // And it must not collapse things that are genuinely different.
  assert.equal(overlap('draining', 'drying'), 0, 'two different words were merged');
});

it('a refusal lists what the manual covers, minus the rows it could not read', () => {
  /*
   * The refusal exists so somebody can scan the list and recognise their own problem in the
   * manufacturer's words. A row cut off at a column collision — "E:32-00 lights up alter-",
   * "E:01-00 to" — cannot be recognised; it can only make a careful answer look careless. Those
   * rows stay in the library, flagged, because a reviewer needs to see them. They do not belong
   * in this list.
   */
  const lib = library([
    machine({
      model: 'TESTDW3',
      symptoms: [
        { id: 'a', symptom: 'Water is left in the appliance.', causes: [{ id: 'a-0', label: 'Blocked filter.', likelihood: 0.6, remedies: [], evidence: 'manual, page 1' }] },
        { id: 'b', symptom: 'E:32-00 lights up alter-', causes: [{ id: 'b-0', label: 'Unknown.', likelihood: 0.5, remedies: [], evidence: 'manual, page 1' }] },
        { id: 'c', symptom: 'E:01-00 to', causes: [{ id: 'c-0', label: 'Unknown.', likelihood: 0.5, remedies: [], evidence: 'manual, page 1' }] },
        { id: 'd', symptom: 'Display flashes.', causes: [{ id: 'd-0', label: 'Software update.', likelihood: 0.5, remedies: [], evidence: 'manual, page 1' }] },
      ],
    }),
  ]);

  const r = lib.lookupSymptom('TESTDW3', 'there is a burning smell');
  assert.equal(r.known, false);

  assert.ok(r.available.includes('Water is left in the appliance.'));
  // Two words, and a finished sentence. Short is not the same as unreadable.
  assert.ok(r.available.includes('Display flashes.'), 'a real short symptom was thrown out');
  assert.ok(!r.available.includes('E:32-00 lights up alter-'), 'a row cut off mid-word was offered');
  assert.ok(!r.available.includes('E:01-00 to'), 'a row cut off mid-phrase was offered');

  // And the count in the sentence is still the honest one: everything the manual lists.
  assert.match(r.reason, /lists 4 problems/);
});

it('a symptom found by description is diagnosed the way a code is — not dropped after the lookup', () => {
  /*
   * A live agent run found "Water is left in the appliance at the end of the program." on the
   * SGE53C55UC, scored 1.0, and could go no further: every tool after the lookup was keyed by a
   * code, and this machine prints none. The same loop has to run on the match's id.
   */
  const lib = require('./service-data');
  const { buildSpace } = require('../mcp/tools/hypotheses');
  const { nextTest } = require('../mcp/tools/next_test');
  const { verify_diagnosis } = require('../mcp/tools/verify_diagnosis');
  const { guide } = require('../mcp/tools/guide');

  const found = lib.lookupSymptom('SGE53C55UC', 'it leaves water in the bottom at the end of the program');
  assert.equal(found.known, true);
  const id = found.matches[0].id;
  assert.ok(id, 'a match came back with no key to carry on with');

  const h = buildSpace({ model: 'SGE53C55UC', code: id });
  assert.equal(h.known, true, h.reason);
  assert.ok(h.space.length >= 2);

  // The manual gives causes in order and no way to tell them apart. That is not "stuck".
  const n = nextTest({ space: h.space, model: 'SGE53C55UC', code: id });
  assert.equal(n.noChecks, true, JSON.stringify(n));
  assert.equal(n.stuck, false);
  assert.equal(n.order[0].id, h.space.sort((a, b) => b.prior - a.prior)[0].id);

  const v = verify_diagnosis({ model: 'SGE53C55UC', code: id, causeId: n.order[0].id });
  assert.equal(v.upheld, true, v.reason);
  // No price was ever read for a symptom, so no money moves on one.
  assert.equal(v.maySpend, false);
  assert.equal(v.costKnown, false);

  const g = guide({ model: 'SGE53C55UC', code: id, causeId: n.order[0].id });
  assert.equal(g.known, true, g.reason);
  assert.match(g.steps[0].say, /Clean the Filters/);
  assert.ok(!g.steps.some((s) => s.detail.includes(id)), 'a slug was put in a sentence meant to be read aloud');
});

it('a symptom behind mains wiring is judged as mains, like any learned remedy', () => {
  const lib = library([
    machine({
      model: 'TESTDW4',
      symptoms: [
        { id: 'no-power', symptom: 'The appliance does not switch on.', causes: [
          { id: 'no-power-0', label: 'Control board failed.', likelihood: 0.8, remedies: ['Have the control board replaced by a technician.'], evidence: 'manual, page 9' },
          { id: 'no-power-1', label: 'Fuse tripped.', likelihood: 0.2, remedies: ['Check the fuse box.'], evidence: 'manual, page 9' },
        ] },
      ],
    }),
  ]);
  const r = lib.lookup('TESTDW4', 'no-power');
  assert.equal(r.known, true);
  assert.equal(r.keyedBy, 'symptom');
  assert.equal(r.causes[0].mains, true, 'a control board was not treated as mains work');
  assert.equal(r.causes[1].mains, false);
  assert.equal(lib.lookup('TESTDW4', 'no-such-symptom').known, false);
});

it('a model said the way people say it is the model — and a near miss is not', () => {
  // A live run passed "Bosch SGE53C55UC" and was told there was no service data for a reviewed machine.
  const lib = require('./service-data');
  for (const said of ['Bosch SGE53C55UC', 'sge53c55uc', ' SGE53C55UC ', 'SGE 53C55UC', 'bosch-sge53c55uc']) {
    assert.equal(lib.resolveModel(said), 'SGE53C55UC', said);
    assert.equal(lib.lookupSymptom(said, 'water is left at the end of the program').known, true, said);
  }
  // Not the same machine: another brand's name in front, a different digit, a variant suffix.
  assert.equal(lib.resolveModel('Whirlpool SGE53C55UC'), 'Whirlpool SGE53C55UC');
  assert.equal(lib.resolveModel('SGE53C56UC'), 'SGE53C56UC');
  assert.equal(lib.resolveModel('SGE53C55UC/01'), 'SGE53C55UC/01');
  assert.equal(lib.lookup('SGE53C56UC', 'E24').known, false);
  assert.equal(lib.resolveModel(undefined), undefined);
});

console.log(`\n${passed} passed`);
