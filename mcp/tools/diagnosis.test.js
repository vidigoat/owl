/**
 * The diagnosis loop: the hypothesis space, and the choice of what to ask next.
 * This is the part that makes it a diagnostician rather than a checklist, so it is the part
 * that gets tested hardest.
 *
 * Run: node mcp/tools/diagnosis.test.js
 */

const assert = require('node:assert');
const { buildSpace, prune, entropy, normalise } = require('./hypotheses');
const { nextTest, score } = require('./next_test');
const { lookup } = require('../../data/service-data');

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

const E24 = () => buildSpace({ model: 'SHE3AR75UC', code: 'E24' });
const TESTS = () => lookup('SHE3AR75UC', 'E24').causes && require('../../data/service-data').MODELS['SHE3AR75UC'].codes.E24.tests;

console.log('hypothesis space');

it('builds a space whose priors sum to one', () => {
  const { space } = E24();
  const total = space.reduce((n, c) => n + c.prior, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `priors summed to ${total}`);
});

it('certainty is zero bits, and a fair coin is one', () => {
  assert.equal(entropy([{ prior: 1 }]), 0);
  assert.ok(Math.abs(entropy(normalise([{ prior: 1 }, { prior: 1 }])) - 1) < 1e-9);
});

it('a test result shrinks the space and names what it eliminated', () => {
  const { space } = E24();
  const outcome = { consistentWith: ['pump'] };
  const after = prune({ space, outcome });
  assert.equal(after.space.length, 1);
  assert.equal(after.eliminated.length, 2);
  assert.ok(after.bits < entropy(space), 'uncertainty should fall');
});

it('says so when the evidence contradicts the manual instead of emptying the space', () => {
  const { space } = E24();
  const after = prune({ space, outcome: { consistentWith: ['not-a-cause'] } });
  assert.equal(after.contradiction, true);
  assert.equal(after.space.length, space.length, 'must not silently discard everything');
});

console.log('\nchoosing the next question');

it('asks something, and can explain why it asked', () => {
  const { space } = E24();
  const choice = nextTest({ space, tests: TESTS() });
  assert.ok(choice.test, 'should have chosen a test');
  assert.ok(choice.why && choice.why.length > 0);
  assert.ok(choice.bits > 0, 'a chosen test must actually tell us something');
});

it('prefers the free listening check over hauling the machine out', () => {
  const { space } = E24();
  const choice = nextTest({ space, tests: TESTS() });
  assert.notEqual(choice.test.id, 'hose-check', 'must not open with the heavy test');
  assert.ok(['free', 'easy'].includes(choice.test.effort));
});

it('a heavy test must earn its effort', () => {
  const { space } = E24();
  const tests = TESTS();
  const hose = score(space, tests.find((t) => t.id === 'hose-check'));
  const hum = score(space, tests.find((t) => t.id === 'pump-hum'));
  assert.ok(hum.value > hose.value, 'cost-weighting should favour the free check');
});

it('does not repeat a question it already asked', () => {
  const { space } = E24();
  const first = nextTest({ space, tests: TESTS() });
  const second = nextTest({ space, tests: TESTS(), performed: [first.test.id] });
  assert.notEqual(second.test?.id, first.test.id);
});

it('stops asking once one cause is left', () => {
  const { space } = E24();
  const after = prune({ space, outcome: { consistentWith: ['pump'] } });
  const choice = nextTest({ space: after.space, tests: TESTS() });
  assert.equal(choice.test, null);
  assert.equal(choice.done, true);
});

it('reports being stuck rather than inventing a question', () => {
  const { space } = E24();
  const choice = nextTest({ space, tests: [], performed: [] });
  assert.equal(choice.test, null);
  assert.equal(choice.stuck, true);
});

it('a test that rules nothing out is never chosen', () => {
  const { space } = E24();
  const useless = [{ id: 'useless', question: 'Is it plugged in?', effort: 'free', outcomes: [{ value: 'yes', consistentWith: space.map((c) => c.id) }] }];
  const choice = nextTest({ space, tests: useless });
  assert.equal(choice.test, null);
  assert.equal(choice.stuck, true);
});

console.log('\na machine taught at runtime');

const { parse } = require('../../manual/faultgraph');
const { learn } = require('../../data/service-data');
const { guide } = require('./guide');

const LEARNED_MANUAL = `Fault codes
OE   The machine cannot drain
     Check the drain filter for debris
     Clean the drain pump of obstructions
     Replace the drain pump if it does not turn
`;

it('can be taught a machine and then diagnose it', () => {
  const g = parse({ model: 'TEST-LEARN', text: LEARNED_MANUAL, sourceName: 'test manual' });
  const res = learn({ model: 'TEST-LEARN', brand: 'Test', codes: g.codes, source: 'test manual' });
  assert.equal(res.learned, true);

  const built = buildSpace({ model: 'TEST-LEARN', code: 'OE' });
  assert.equal(built.known, true);
  assert.ok(built.space.length >= 3);
});

it('reads a learned procedure out of the manual, verbatim', () => {
  const built = buildSpace({ model: 'TEST-LEARN', code: 'OE' });
  const proc = guide({ model: 'TEST-LEARN', code: 'OE', causeId: built.space[0].id });
  assert.equal(proc.known, true);
  assert.equal(proc.generated, true);
  // the manual's own wording, not a paraphrase
  assert.ok(proc.steps.some((s) => /drain filter for debris/i.test(s.say)));
  assert.ok(proc.citation.includes('test manual'));
});

it('still prefers a hand-written procedure over a generated one', () => {
  const proc = guide({ model: 'SHE3AR75UC', code: 'E24', causeId: 'filter' });
  assert.equal(proc.known, true);
  assert.ok(!proc.generated, 'verified steps must win over generated ones');
});

it('refuses for a machine it was never taught', () => {
  const proc = guide({ model: 'NEVER-SEEN', code: 'ZZ', causeId: 'x' });
  assert.equal(proc.known, false);
});

console.log(`\n${passed} passed`);
