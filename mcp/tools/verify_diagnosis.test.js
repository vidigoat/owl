/**
 * The trust gate is the product, so it is the thing with tests.
 * Run: node mcp/tools/verify_diagnosis.test.js
 */

const assert = require('node:assert');
const { verify_diagnosis } = require('./verify_diagnosis');

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

console.log('verify_diagnosis');

it('upholds a well-separated cause and cites its evidence', () => {
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24' });
  assert.equal(r.abstain, false);
  assert.equal(r.upheld, true);
  assert.ok(r.citation.length > 0, 'an upheld cause must cite something');
});

it('does not authorise spending on the free first check', () => {
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24' });
  assert.equal(r.maySpend, false);
});

it('will not authorise the paid part while a free check is still standing', () => {
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' });
  assert.equal(r.abstain, true);
  assert.equal(r.escalate, 'try-cheaper-cause-first');
});

it('upholds the paid part once the free check has been ruled out', () => {
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: ['filter', 'hose'] });
  assert.equal(r.abstain, false);
  assert.equal(r.maySpend, true);
  assert.equal(r.cause.id, 'pump');
});

it('never compares a cause against itself', () => {
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' });
  if (r.abstain) assert.doesNotMatch(r.reason, /"Failed drain pump".*"Failed drain pump"/);
});

it('refuses every cause behind mains wiring, however confident', () => {
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E09', causeId: 'element' });
  assert.equal(r.abstain, true);
  assert.equal(r.escalate, 'technician');
});

it('refuses when two causes are too close to separate', () => {
  // pump 0.21 vs hose 0.07 once the filter is cleared: a 14% gap, inside the threshold.
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: ['filter'] });
  assert.equal(r.abstain, true);
  assert.match(r.reason, /within|separate/i);
  assert.equal(r.escalate, 'technician');
});

it('puts mains voltage ahead of every other consideration', () => {
  // E09's causes are close AND behind mains. The mains rule must be the one that answers.
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E09' });
  assert.equal(r.abstain, true);
  assert.equal(r.escalate, 'technician');
  assert.match(r.reason, /mains/i);
});

it('refuses a model it has no service data for', () => {
  const r = verify_diagnosis({ model: 'NOT-A-MODEL', code: 'E24' });
  assert.equal(r.abstain, true);
});

it('refuses a known code that has no verified causes yet', () => {
  const r = verify_diagnosis({ model: 'WFW5620HW', code: 'F21' });
  assert.equal(r.abstain, true);
});

it('refuses a cause that does not exist for the code', () => {
  const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24', causeId: 'invented' });
  assert.equal(r.abstain, true);
});

console.log(`\n${passed} passed`);
