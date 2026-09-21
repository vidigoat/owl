/**
 * Is this worth fixing?
 *
 *   node mcp/tools/replace_or_repair.test.js
 *
 * The most consequential question in the whole product and the one this project is least equipped
 * to answer, because the answer turns on a number nobody here has: what the machine is worth. A
 * service manual lists remedies and never prices, and no amount of reading one produces a resale
 * value.
 *
 * So every test below is about the same thing from a different angle — that the tool refuses
 * cleanly, names the figure it is missing, and becomes able to answer the moment somebody supplies
 * it. A tool that guessed a machine's value would be inventing the single largest term in the
 * decision, and doing it invisibly.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { STORE } = require('./home');
const { replace_or_repair, DEFAULT_RULE } = require('./replace_or_repair');

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

const saved = (() => {
  try {
    return fs.readFileSync(STORE, 'utf8');
  } catch {
    return null;
  }
})();
const restore = () => {
  if (saved === null) fs.rmSync(STORE, { force: true });
  else fs.writeFileSync(STORE, saved);
};
process.on('exit', restore);

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const household = (receipts) => {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify({ appliances: {}, receipts }));
};

console.log('is this worth fixing?');

/* ── refusing well ────────────────────────────────────────────────────────── */

it('with no model it asks which machine, rather than answering about none', () => {
  const r = replace_or_repair({});
  assert.equal(r.answered, false);
  assert.match(r.reason, /model number/);
});

it('with nothing known it names both missing figures', () => {
  household([]);
  const r = replace_or_repair({ model: 'SHE3AR75UC' });
  assert.equal(r.answered, false);
  assert.equal(r.comparison, null);
  assert.equal(r.missing.length, 2, 'it did not name both things it needs');
  assert.ok(r.missing.some((m) => /worth/.test(m)), 'it did not say it needs the machine value');
});

it('it never returns a verdict, in any state', () => {
  /*
   * The whole discipline. This tool reports which side of a stated line some arithmetic falls on;
   * it does not tell somebody what to do with their money, because the rest of that decision
   * involves things it has no access to — whether they can afford it this month, whether the
   * kitchen is being redone anyway, whether the machine was a gift.
   */
  household([
    { model: 'M', code: 'E24', at: day(4) },
    { model: 'M', code: 'E24', at: day(40) },
  ]);
  for (const q of [
    { model: 'M' },
    { model: 'M', code: 'E24' },
    { model: 'SHE3AR75UC', causeId: 'pump', machineValue: 60 },
    { model: 'SHE3AR75UC', causeId: 'pump', machineValue: 2000 },
  ]) {
    const r = replace_or_repair(q);
    assert.equal(r.verdict, null, `a verdict appeared for ${JSON.stringify(q)}`);
    assert.ok(!('replace' in r), 'the tool is offering a replace flag');
    assert.match(r.note, /decision is yours/);
  }
});

it('a machine value of zero or nonsense is not a machine value', () => {
  // Otherwise `machineValue: 0` divides by zero and reports an infinite share as a finding.
  household([]);
  for (const bad of [0, -5, NaN, null, undefined, 'four hundred']) {
    const r = replace_or_repair({ model: 'SHE3AR75UC', causeId: 'pump', machineValue: bad });
    assert.equal(r.comparison, null, `${bad} was accepted as a value`);
    assert.ok(r.missing.some((m) => /worth/.test(m)));
  }
});

/* ── answering, once it can ───────────────────────────────────────────────── */

it('given both numbers it compares them and shows its working', () => {
  household([]);
  const r = replace_or_repair({ model: 'SHE3AR75UC', causeId: 'pump', machineValue: 320 });
  assert.ok(r.comparison, 'it would not compare two numbers it had');
  assert.equal(r.comparison.repairCost, 38.42);
  assert.equal(r.comparison.machineValue, 320);
  assert.equal(r.comparison.pastThreshold, false);
  assert.deepEqual(r.missing, [], 'it still claimed to be missing something');
});

it('the threshold is a policy of this tool, and it says so', () => {
  /*
   * "Repair over half of replacement" is a rule of thumb, not a fact about appliances and not
   * something any manufacturer wrote down. It travels in the output with its number so a reader can
   * see exactly what they are disagreeing with, and it is an argument so they can disagree.
   */
  household([]);
  const r = replace_or_repair({ model: 'SHE3AR75UC', causeId: 'pump', machineValue: 320 });
  assert.equal(r.comparison.rule.threshold, DEFAULT_RULE.threshold);
  assert.match(r.comparison.says, /this tool draws/, 'it stated the line as if it were a fact');

  const strict = replace_or_repair({ model: 'SHE3AR75UC', causeId: 'pump', machineValue: 320, threshold: 0.1 });
  assert.equal(strict.comparison.pastThreshold, true, 'the threshold is not actually an argument');
});

it('an uncatalogued cause is a missing price, not a guessed one', () => {
  // Ordering the wrong part is the commonest way a DIY repair becomes a week of waiting plus a
  // return, so "probably fits" is not a price any more than it is a part.
  household([]);
  const r = replace_or_repair({ model: 'SHE3AR75UC', causeId: 'nothing-like-this', machineValue: 320 });
  assert.equal(r.comparison, null);
  assert.ok(r.missing.some((m) => /repair costs/.test(m)));
});

/* ── the one thing it knows for free ──────────────────────────────────────── */

it('a recurrence is reported even when every price is unknown', () => {
  // The only finding here that does not depend on a number nobody has.
  household([
    { model: 'M', code: 'E24', at: day(4), confirmed: true },
    { model: 'M', code: 'E24', at: day(40), confirmed: true },
    { model: 'M', code: 'E24', at: day(120) },
  ]);
  const r = replace_or_repair({ model: 'M', code: 'E24' });
  assert.equal(r.answered, true, 'a pattern with no prices was treated as nothing to say');
  assert.equal(r.pattern.times, 3);
  assert.match(r.known[0], /come back 3 times/);
  assert.match(r.known[0], /2 repairs confirmed/, 'it lost that two repairs were confirmed');
});

it('it distinguishes a fault that returned after a confirmed fix from one nobody finished', () => {
  /*
   * A fault returning after three confirmed repairs is a much stronger fact than one returning
   * after three attempts nobody ever said worked. Conflating them turns "we never finished the job"
   * into "the machine is failing", which is the difference between a wasted afternoon and a wasted
   * six hundred pounds.
   */
  household([
    { model: 'M', code: 'E24', at: day(4) },
    { model: 'M', code: 'E24', at: day(40) },
  ]);
  const r = replace_or_repair({ model: 'M', code: 'E24' });
  assert.match(r.known[0], /no repair was ever confirmed/);
});

it('another machine\'s history is not this machine\'s', () => {
  household([
    { model: 'OTHER', code: 'E24', at: day(4) },
    { model: 'OTHER', code: 'E24', at: day(40) },
  ]);
  const r = replace_or_repair({ model: 'M', code: 'E24' });
  assert.equal(r.pattern, null);
  assert.equal(r.answered, false);
});

it('a different code on the same machine is a different question', () => {
  household([
    { model: 'M', code: 'E24', at: day(4) },
    { model: 'M', code: 'E24', at: day(40) },
  ]);
  assert.equal(replace_or_repair({ model: 'M', code: 'E15' }).pattern, null);
});

console.log(`\n${passed} passed`);
