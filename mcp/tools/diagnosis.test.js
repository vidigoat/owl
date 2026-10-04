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

it('does not read out a fallback remedy for a cause the owner already ruled out', () => {
  // The learned guide lists the manual's other remedies as "if that did not do it" fallbacks. A
  // ruled-out cause is disproven, not untested, so offering "replace the drain pump if it does not
  // turn" to someone who just confirmed it turns is the guessing this whole product refuses.
  const built = buildSpace({ model: 'TEST-LEARN', code: 'OE' });
  const [chosen, ...rest] = built.space;
  const ruledOut = rest.map((c) => c.id);
  const proc = guide({ model: 'TEST-LEARN', code: 'OE', causeId: chosen.id, ruledOut });
  assert.equal(proc.known, true);
  // Only the chosen cause's remedy survives; nothing from a ruled-out cause is spoken.
  const spoken = proc.steps.map((s) => s.say).join(' | ');
  for (const c of rest) {
    if (c.remedy) assert.ok(!spoken.includes(c.remedy), `a ruled-out cause's remedy was still read out: "${c.remedy}"`);
  }
  // And without ruledOut, the fallbacks are still offered, so the exclusion is what changed.
  const full = guide({ model: 'TEST-LEARN', code: 'OE', causeId: chosen.id });
  assert.ok(full.steps.length > proc.steps.length, 'ruling causes out should remove fallback steps');
});

it('guide refuses a repair behind mains wiring by itself — called directly, with no gate before it', () => {
  // guide is a tool on a public MCP server: any agent can call it with a cause id, without ever
  // asking verify_diagnosis. On a machine learned from its manual it used to answer with the
  // manual's own words — "Replace the heating element" — and offer other mains remedies as
  // fallback steps. The gate refusing is not enough if the next tool along does not.
  const g = parse({ model: 'TEST-MAINS', sourceName: 'test manual', text: 'Fault codes\nE5   Water is not heating\n     Clean the filter\n     Replace the heating element\n     Replace the control board\n' });
  assert.equal(learn({ model: 'TEST-MAINS', brand: 'Test', codes: g.codes, source: 'test manual' }).learned, true);
  const causes = lookup('TEST-MAINS', 'E5').causes;
  const mains = causes.filter((c) => c.mains === true);
  const safe = causes.find((c) => c.mains === false);
  assert.ok(mains.length >= 2 && safe, 'the fixture should have two mains causes and one that is not');

  for (const c of mains) {
    const direct = guide({ model: 'TEST-MAINS', code: 'E5', causeId: c.id });
    assert.equal(direct.known, false, `a mains repair was talked through: ${c.remedy}`);
    assert.equal(direct.refused, true);
    assert.deepEqual(direct.steps, []);
    assert.match(direct.reason, /technician/);
  }
  // And the safe cause's guide does not smuggle them back in as "if that did not do it" steps.
  const ok = guide({ model: 'TEST-MAINS', code: 'E5', causeId: safe.id });
  assert.equal(ok.known, true);
  const spoken = ok.steps.map((s) => s.say).join(' | ');
  for (const c of mains) assert.ok(!spoken.includes(c.remedy), `a mains remedy was offered as a fallback step: "${c.remedy}"`);
  assert.equal(ok.mainsWithheld, mains.length);
  assert.match(ok.beyond, /technician/);
  // The hand-written machine too: E09's causes are all behind mains wiring.
  assert.equal(guide({ model: 'SHE3AR75UC', code: 'E09', causeId: 'element' }).refused, true);
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

/* The safety property that matters most: the mains rule is inferred by the parser when a machine is
 * learned, and the gate has to honour it on data it did not write itself. */
it('still refuses mains work on a machine it taught itself', () => {
  const { verify_diagnosis } = require('./verify_diagnosis');
  const mainsManual = `Fault codes
HE   The water is not heating
     Check the mains wiring harness for damage
     Replace the control board
`;
  const g = parse({ model: 'TEST-MAINS', text: mainsManual, sourceName: 'test manual' });
  learn({ model: 'TEST-MAINS', brand: 'Test', codes: g.codes, source: 'test manual' });

  const causes = g.codes.HE.causes;
  assert.ok(causes.length >= 2, 'expected two mains causes');

  causes.forEach((c) => {
    assert.equal(c.mains, true, `"${c.label}" should be flagged as mains work`);
    const verdict = verify_diagnosis({ model: 'TEST-MAINS', code: 'HE', causeId: c.id });
    assert.equal(verdict.abstain, true, `gate must refuse "${c.label}"`);
    assert.equal(verdict.escalate, 'technician');
  });
});

it('never offers a learned procedure for a cause it refused', () => {
  const built = buildSpace({ model: 'TEST-MAINS', code: 'HE' });
  const { verify_diagnosis } = require('./verify_diagnosis');
  const verdict = verify_diagnosis({ model: 'TEST-MAINS', code: 'HE', causeId: built.space[0].id });
  // the gate refuses, so the caller must never reach the guide for this cause
  assert.equal(verdict.abstain, true);
  assert.equal(verdict.maySpend, undefined, 'a refused verdict must not authorise spending');
});

it('a repair is never confirmed on a read too poor to trust', () => {
  // Found against real Bedrock: a blank display read at 0.1 confidence came back as
  // "confirmed: true". That is the one claim here that stops a person looking further, and a poor
  // read showing nothing is evidence we could not see — not evidence the fault cleared.
  const { CONFIRM_FLOOR } = require('./confirm_fix');
  assert.ok(CONFIRM_FLOOR > 0 && CONFIRM_FLOOR < 1, 'there has to be a floor at all');
  assert.ok(CONFIRM_FLOOR >= 0.4, 'a floor this low is not a floor');
});

it('a fault whose every cause is behind mains settles instead of getting stuck', () => {
  /*
   * Bosch E09: three causes, all behind mains wiring. A person can narrow this all afternoon and
   * the answer does not move — verify_diagnosis refuses a mains cause at any confidence, so no
   * answer they give unlocks a repair they are allowed to do.
   *
   * It used to fall through to "no tests left to run", which is true and reads as failure: as
   * though the tool tried and could not manage it. It did not try. It knew, before asking.
   */
  const { space } = buildSpace({ model: 'SHE3AR75UC', code: 'E09' });
  assert.ok(space.every((c) => c.mains), 'the fixture has changed — E09 is no longer all-mains');

  const choice = nextTest({ space, tests: [] });
  assert.equal(choice.test, null);
  assert.equal(choice.settled, true, 'an all-mains fault was reported as stuck rather than settled');
  assert.equal(choice.stuck, false, '"ran out of ideas" invites a second opinion from something that guesses');
  assert.equal(choice.escalate, 'technician');
  assert.match(choice.reason, /behind mains wiring/);
  assert.ok(choice.why, 'it declined to ask and did not say why');
});

it('an ordinary fault is not settled, however few tests remain', () => {
  // The guard must not swallow the honest "I have run out of checks" ending.
  const { space, tests } = buildSpace({ model: 'SHE3AR75UC', code: 'E24' });
  assert.ok(space.some((c) => !c.mains));

  const exhausted = nextTest({ space, tests: [], performed: [] });
  assert.notEqual(exhausted.settled, true, 'a fault with owner-fixable causes was declared settled');
  assert.equal(exhausted.stuck, true);
});

it('settling never happens once a non-mains cause survives', () => {
  // Property, not a fixture: whatever the space, settled implies every surviving cause is mains.
  const spaces = [
    [{ id: 'a', prior: 0.5, mains: true }, { id: 'b', prior: 0.5, mains: true }],
    [{ id: 'a', prior: 0.5, mains: true }, { id: 'b', prior: 0.5, mains: false }],
    [{ id: 'a', prior: 0.5, mains: false }, { id: 'b', prior: 0.5, mains: false }],
  ];
  for (const space of spaces) {
    const r = nextTest({ space, tests: [] });
    if (r.settled) assert.ok(space.every((c) => c.mains), 'settled with an owner-fixable cause still standing');
    else assert.ok(space.some((c) => !c.mains), 'an all-mains space was not settled');
  }
});

console.log(`\n${passed} passed`);
