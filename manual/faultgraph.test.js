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

it('generates a check for every cause, with an effort the person would recognise', () => {
  const g = parse({ model: 'TEST-1', text: MANUAL });
  assert.equal(g.codes.E24.tests.length, g.codes.E24.causes.length);
  g.codes.E24.tests.forEach((t) => {
    assert.ok(['free', 'easy', 'awkward', 'heavy'].includes(t.effort));
    assert.equal(t.outcomes.length, 2);
  });
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

console.log(`\n${passed} passed`);
