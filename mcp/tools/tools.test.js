/**
 * The tools that can waste someone's money or their afternoon.
 * Run: node mcp/tools/tools.test.js
 */

const assert = require('node:assert');
const { guide } = require('./guide');
const { find_part } = require('./find_part');
const { diagnose } = require('./diagnose');

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

console.log('guide');

it('returns steps that can be done with both hands busy', () => {
  const g = guide({ model: 'SHE3AR75UC', code: 'E24', causeId: 'filter' });
  assert.equal(g.known, true);
  assert.equal(g.handsFree, true);
});

it('gives every step a pace, so the copilot can wait instead of racing', () => {
  const g = guide({ model: 'SHE3AR75UC', code: 'E24', causeId: 'filter' });
  g.steps.forEach((s) => assert.ok(s.pace > 0, `step ${s.n} has no pace`));
  assert.ok(g.totalSeconds > 0);
});

it('never refers to anything the listener would have to look at', () => {
  const g = guide({ model: 'SHE3AR75UC', code: 'E24', causeId: 'filter' });
  g.steps.forEach((s) => assert.doesNotMatch(s.say, /shown below|see the (image|picture|diagram)|as pictured/i));
});

it('refuses to improvise a procedure it does not have', () => {
  const g = guide({ model: 'SHE3AR75UC', code: 'E24', causeId: 'invented' });
  assert.equal(g.known, false);
  assert.equal(g.steps.length, 0);
});

it('starts the paid repair by cutting the power', () => {
  const g = guide({ model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' });
  assert.match(g.steps[0].say, /off at the wall/i);
});

console.log('\nfind_part');

it('finds the part for a model it has verified', () => {
  const p = find_part({ model: 'SHE3AR75UC', causeId: 'pump' });
  assert.equal(p.found, true);
  assert.equal(p.part.fitsModel, 'SHE3AR75UC');
});

it('always shows what the alternative costs', () => {
  const p = find_part({ model: 'SHE3AR75UC', causeId: 'pump' });
  assert.ok(p.alternative.price > p.part.price);
  assert.equal(p.saving, Number((p.alternative.price - p.part.price).toFixed(2)));
});

it('offers nothing for a model it has not checked', () => {
  const p = find_part({ model: 'NOT-A-MODEL', causeId: 'pump' });
  assert.equal(p.found, false);
  assert.ok(p.alternative, 'must still tell them the alternative');
});

console.log('\ndiagnose');

it('puts a free check ahead of a paid one when they are close', () => {
  const d = diagnose({ model: 'SHE3AR75UC', code: 'E24' });
  assert.equal(d.tryFirst.cost, 0);
});

console.log(`\n${passed} passed`);
