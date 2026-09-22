/**
 * The fault graph is what lets this work on a machine nobody wrote code for.
 * Run: node manual/faultgraph.test.js
 */

const assert = require('node:assert');
const { parse, effortOf, isMains, remedyToCause } = require('./faultgraph');

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

/* A fault table shaped the way real service manuals shape them. */
const MANUAL = `
Dishwasher service manual — fault codes

E15   Water detected in the base tray
      Check the door seal for damage
      Clean the filter and the drain hose

E24   Water is not draining from the machine
      Check the filter for food debris
      Straighten the drain hose behind the machine
      Replace the drain pump if it does not run

E09   The water is not heating
      Check the mains wiring harness for damage
      Replace the control board

Specifications
Rated voltage 220-240V
`;

console.log('fault graph');

it('recovers the fault codes from a manual it has never seen', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL, sourceName: 'test manual' });
  assert.ok(g.found >= 3, `found only ${g.found}`);
  ['E15', 'E24', 'E09'].forEach((c) => assert.ok(g.codes[c], `missing ${c}`));
});

it('reads the symptom, not the remedy, as the meaning', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL });
  assert.match(g.codes.E24.meaning, /not draining/i);
});

it('turns each remedy into a cause that cites where it came from', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL, sourceName: 'test manual' });
  const causes = g.codes.E24.causes;
  assert.ok(causes.length >= 3, `only ${causes.length} causes`);
  causes.forEach((c) => {
    assert.ok(c.evidence.includes('test manual'), 'every cause must cite its source');
    assert.ok(c.source.line > 0);
  });
});

it('treats the order the manual lists remedies in as the prior', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL });
  const [first, second] = g.codes.E24.causes;
  assert.ok(first.likelihood > second.likelihood, 'first remedy listed should be most likely');
});

it('marks anything behind mains voltage as not an owner repair', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL });
  const mainsCauses = g.codes.E09.causes.filter((c) => c.mains);
  assert.ok(mainsCauses.length >= 1, 'wiring harness and control board are mains work');
  mainsCauses.forEach((c) => assert.equal(c.ownerFixable, false));
});

it('generates at least one check per cause, plus any observation the manual gave us', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL });
  const { tests, causes } = g.codes.E24;

  // Every cause is reachable by at least its own remedy check.
  const remedies = tests.filter((t) => t.kind === 'remedy');
  assert.equal(remedies.length, causes.length);

  // And any remedy phrased as a condition also yields an observation, which is a cheaper way of
  // asking the same question. More tests than causes is the intended shape, not a bug.
  assert.ok(tests.length >= causes.length);

  tests.forEach((t) => {
    assert.ok(['free', 'easy', 'awkward', 'heavy'].includes(t.effort));
    assert.equal(t.outcomes.length, 2);
    assert.ok(t.outcomes.every((o) => Array.isArray(o.consistentWith) && o.consistentWith.length),
      'an outcome consistent with nothing would empty the space and read as a contradiction');
  });
});

it('a condition in a remedy becomes a question you can answer by looking', () => {
  // "Replace the drain pump if it does not turn" carries the manufacturer's own implication: a pump
  // that does not turn IS the fault. The information is the same as the remedy check; the price of
  // asking is not. One is answered by looking, the other by buying a pump.
  const g = parse({ model: 'TEST-2', sourceName: 'manual', text: `Fault codes
OE   The machine cannot drain
     Check the drain filter for blockages
     Replace the drain pump if it does not turn
` });
  const obs = g.codes.OE.tests.filter((t) => t.kind === 'observation');
  assert.equal(obs.length, 1, `expected one observation, got ${JSON.stringify(g.codes.OE.tests.map((t) => t.question))}`);
  assert.match(obs[0].question, /^Does it turn\?$/);
  assert.equal(obs[0].effort, 'easy', 'looking at something is not heavy work');
  assert.match(obs[0].derivedFrom, /Replace the drain pump/);

  // The condition holding points at that cause; it failing rules that cause out and leaves the rest.
  const pump = g.codes.OE.causes.find((c) => /pump/i.test(c.label));
  const holds = obs[0].outcomes.find((o) => /does not turn/.test(o.say));
  assert.deepEqual(holds.consistentWith, [pump.id]);
  const fails = obs[0].outcomes.find((o) => o !== holds);
  assert.ok(!fails.consistentWith.includes(pump.id));
});

it('an answer that is read aloud is grammatical', () => {
  // "yes, it turn" is not a detail when a voice assistant says it to somebody.
  const { conjugate } = require('./faultgraph');
  assert.equal(conjugate('turn'), 'turns');
  assert.equal(conjugate('open'), 'opens');
  assert.equal(conjugate('turn on the tap'), 'turns on the tap');
  assert.equal(conjugate('wash'), 'washes');
  assert.equal(conjugate('go'), 'goes');
  assert.equal(conjugate('dry'), 'dries');
  // Already inflected, or not a bare verb: better clumsy than wrong.
  assert.equal(conjugate('turns'), 'turns');
  assert.equal(conjugate('locked'), 'locked');
  assert.equal(conjugate('running'), 'running');
});

it('a manual with no conditions in it yields no observations, and still works', () => {
  const g = parse({ model: 'TEST-3', sourceName: 'manual', text: `Fault codes
F01  The machine has stopped
     Check the door is closed
     Clean the filter
` });
  assert.equal(g.codes.F01.tests.filter((t) => t.kind === 'observation').length, 0,
    'nothing was invented out of a manual that said nothing');
  assert.equal(g.codes.F01.tests.length, g.codes.F01.causes.length);
});

it('phrases causes as what is wrong, not as an instruction', () => {
  assert.equal(remedyToCause('Replace the drain pump if it does not run'), 'Drain pump has failed');
  assert.equal(remedyToCause('Clean the pump impeller of obstructions'), 'Pump impeller is blocked');
  assert.equal(remedyToCause('Straighten the drain hose'), 'Drain hose is kinked');
  assert.equal(remedyToCause('Check the drain filter for debris'), 'Drain filter — debris');
});

it('never leaves a cause label starting with a dangling article', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL });
  Object.values(g.codes).forEach((entry) =>
    entry.causes.forEach((c) => {
      assert.doesNotMatch(c.label, /^(the|a|an)\s/i, `dangling article: "${c.label}"`);
      assert.match(c.label, /^[A-Z]/, `not capitalised: "${c.label}"`);
    })
  );
});

it('knows that reaching behind the machine costs more than looking', () => {
  assert.equal(effortOf('Straighten the drain hose behind the machine'), 'heavy');
  assert.equal(effortOf('Listen for the pump'), 'free');
  assert.equal(effortOf('Check the filter for food debris'), 'easy');
});

it('treats "replace the part" as the most expensive thing it can ask for', () => {
  // As a diagnostic step this means buy a part and fit it to find out. It must never be cheap.
  assert.equal(effortOf('Replace the drain pump if it does not turn'), 'heavy');
  assert.equal(effortOf('Renew the door seal'), 'heavy');
  assert.equal(effortOf('Fit a new inlet valve'), 'heavy');
});

it('exhausts every cheap check before asking anyone to buy a part', () => {
  const { nextTest } = require('../mcp/tools/next_test');
  const { buildSpace } = require('../mcp/tools/hypotheses');
  const { learn, LEARNED } = require('../data/service-data');

  const g = parse({
    model: 'ORDER-TEST',
    text: `Fault codes
OE   The machine cannot drain
     Check the drain filter for blockages
     Replace the drain pump if it does not turn
`,
    sourceName: 'test manual',
  });
  learn({ model: 'ORDER-TEST', brand: 'Test', codes: g.codes, source: 'test manual' });

  const { space } = buildSpace({ model: 'ORDER-TEST', code: 'OE' });
  const tests = LEARNED['ORDER-TEST'].codes.OE.tests;
  const first = nextTest({ space, tests });

  assert.doesNotMatch(first.test.question, /^Replace/i, 'opened by asking someone to buy a part');
  assert.notEqual(first.test.effort, 'heavy');
});

it('recognises mains work by what it touches', () => {
  assert.equal(isMains('Check the mains wiring harness'), true);
  assert.equal(isMains('Clean the filter'), false);
});

it('reads LG-style letter codes, which have no digits at all', () => {
  const lg = `Fault codes
OE   The machine cannot drain
     Check the drain filter for debris
     Replace the drain pump if it does not turn

UE   The load is unbalanced
     Check the load is evenly distributed
`;
  const g = parse({ model: 'LG-TEST', text: lg });
  assert.ok(g.codes.OE, 'OE not recovered — LG uses letter-only codes');
  assert.ok(g.codes.UE, 'UE not recovered');
  assert.match(g.codes.OE.meaning, /cannot drain/i);
});

it('reads Samsung-style digit-first codes', () => {
  const samsung = `Fault codes
4C   Water is not being supplied
     Check the water supply taps are open
     Clean the inlet filter of debris
`;
  const g = parse({ model: 'SAMSUNG-TEST', text: samsung });
  assert.ok(g.codes['4C'], '4C not recovered — Samsung uses digit-first codes');
});

it('does not mistake ordinary sentences for fault codes', () => {
  const prose = `Safety
THE  appliance must be earthed at all times
AND  never operated with a damaged cable
NOTE  check the manual before servicing
`;
  const g = parse({ model: 'PROSE-TEST', text: prose });
  assert.equal(g.found, 0, `matched prose as codes: ${Object.keys(g.codes)}`);
});

it('finds nothing in a manual with no fault table, and says so', () => {
  const g = parse({ model: 'TEST-2', text: 'Congratulations on your new appliance.\nPlease read carefully.' });
  assert.equal(g.found, 0);
  assert.match(g.coverage, /nothing usable/i);
});

it('reports its coverage honestly rather than implying it read everything', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL });
  assert.match(g.coverage, /fault codes? recovered/);
});

/* ── cells a manufacturer merged across several codes ────────────────────── */

/*
 * Real, from the Bosch dishwasher manual this project was built against. Page 39 draws ONE reason
 * cell across E:14 and E:15, and one remedy cell across all three codes below it — no horizontal
 * rule through either. A faithful transcription of that gives the codes underneath a bare
 * `REASON:` or `REMEDY:` with nothing after it.
 *
 * Both of the bugs below were found by a person holding the rendered page against the parse, which
 * is the entire argument for the review bench existing.
 */
const MERGED = `Fault code E:14 is lit.
REASON: Water protection system activated.
REMEDY: Turn off water supply.

Fault code E:15 is lit.
REASON:
REMEDY: Call customer service and quote the fault code.

Fault code E:16 is lit.
REASON: Constant water supply.
REMEDY:`;

it('a label with nothing after it is a merged cell, not a cause called "REASON:"', () => {
  /*
   * The regex wanted at least one character after the colon, so a bare `REASON:` failed to match,
   * fell through to the remedy-verb test, and was stored as a cause. The literal string "REASON:"
   * then appeared on screen as the meaning of a real fault code on a real machine.
   */
  const g = parse({ model: 'X', text: MERGED, sourceName: 'Bosch manual' });
  const labels = Object.values(g.codes).flatMap((f) => f.causes.map((c) => c.label));
  for (const l of labels) {
    assert.ok(!/^REASON:?$/i.test(l), `a cause was labelled "${l}"`);
    assert.ok(!/^REMEDY:?$/i.test(l), `a cause was labelled "${l}"`);
  }
});

it('a code whose remedy cell is shared is kept, not dropped', () => {
  /*
   * E:16 is printed in the manual, has its own stated reason, and its remedy sits in a cell shared
   * with the codes above it. Requiring a remedy silently deleted it — and a machine that answers
   * "I have no record of E16" about a code printed in its own manual is worse than one that says
   * what it means and admits it cannot say what to do.
   */
  const g = parse({ model: 'X', text: MERGED, sourceName: 'Bosch manual' });
  assert.deepEqual(Object.keys(g.codes).sort(), ['E14', 'E15', 'E16']);

  const [cause] = g.codes.E16.causes;
  assert.equal(cause.label, 'Constant water supply');
  assert.equal(cause.remedy, null, 'a remedy was invented for a cell the manual left shared');
  assert.match(cause.evidence, /prints no remedy/, 'the evidence did not say why there is none');
});

it('a cause with no remedy is unknown about mains, not declared safe', () => {
  // `false` here would read as a positive finding that this is safe to touch, which is the one
  // thing the gate must never be told by accident.
  const g = parse({ model: 'X', text: MERGED, sourceName: 'Bosch manual' });
  const [cause] = g.codes.E16.causes;
  assert.equal(cause.mains, null);
  assert.equal(cause.ownerFixable, null);
});

it('a cause with no remedy produces no test to try', () => {
  // There is nothing to ask somebody to do. Inventing a step to keep the list tidy is the failure
  // this whole file exists to prevent.
  const g = parse({ model: 'X', text: MERGED, sourceName: 'Bosch manual' });
  const tests = g.codes.E16.tests || [];
  assert.equal(tests.filter((t) => t.kind === 'remedy').length, 0);
});

/* ── the hallucination guard ──────────────────────────────────────────────── */

it('a reading where every code says the same thing is refused, not kept', () => {
  /*
   * This is the real one, and it was live in the library.
   *
   * `B18IF905SP` is a Bosch refrigerator. The page scorer picked its Home Connect pages — prose
   * about joining a Wi-Fi network, no fault table anywhere on them — and the vision model, asked to
   * read the fault-code table on that page, produced one. Seven codes, every one with the identical
   * meaning and the identical cause. Four of them are not Bosch conventions at all: OE and 4C/5E
   * are LG and Samsung, H20 is Whirlpool.
   *
   * Read one row at a time, which is how a reviewer reads, every row is plausible. The tell only
   * exists across rows.
   */
  const invented = [
    'E24  REASON: The water inlet valve is stuck open',
    '     Check the water inlet valve for blockages and replace if necessary',
    'E07  REASON: The water inlet valve is stuck open',
    '     Check the water inlet valve for blockages and replace if necessary',
    'F21  REASON: The water inlet valve is stuck open',
    '     Check the water inlet valve for blockages and replace if necessary',
    'OE   REASON: The water inlet valve is stuck open',
    '     Check the water inlet valve for blockages and replace if necessary',
  ].join('\n');

  const g = parse({ model: 'B18IF905SP', text: invented, sourceName: 'Bosch service manual' });

  assert.equal(g.found, 0, `kept ${Object.keys(g.codes).join(', ')}`);
  assert.deepEqual(g.codes, {});
  assert.match(g.coverage, /all of them said the same thing/);
  assert.ok(g.refused, 'nothing says why it was refused');
});

it('a real table of codes that differ is not refused', () => {
  // The guard has to be quiet on every manual that is fine, which is all of them.
  const g = parse({ model: 'SMS46KI01E', text: MANUAL, sourceName: 'Bosch service manual' });
  assert.ok(g.found >= 2, `the guard swallowed a real reading: ${g.coverage}`);
  assert.equal(g.refused, undefined);
});

it('two codes that agree are not enough to refuse a reading', () => {
  /*
   * Manuals really do list two codes with one remedy — a pair of sensor faults answered by the same
   * check. Three is where "they all say the same thing" stops being a coincidence, and the cost of
   * being wrong here is throwing away somebody's real table.
   */
  const pair = [
    'E01  REASON: The door is open',
    '     Close the door',
    'E02  REASON: The door is open',
    '     Close the door',
  ].join('\n');

  const g = parse({ model: 'X', text: pair, sourceName: 'manual' });
  assert.equal(g.refused, undefined, 'a two-code manual was refused');
});

console.log(`\n${passed} passed`);
