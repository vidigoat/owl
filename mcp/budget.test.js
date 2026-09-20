/**
 * The spend ceiling.
 *
 *   node mcp/budget.test.js
 *
 * Every vision call in this project is a real Bedrock invocation against a real account — the
 * owner's PRODUCTION account, because a separate IAM user isolates permissions and not billing. For
 * most of this project's life there was nothing stopping a loop, a stuck retry, or a browser tab
 * left refreshing from billing until somebody noticed it on a statement.
 *
 * Which is a particular kind of wrong here. The headline feature of this product is a gate that
 * refuses to spend YOUR money without being sure. Spending its owner's, unbounded, is the sort of
 * irony that belongs in the friction log rather than in the code.
 *
 * Every test below uses its own ledger in a temp directory. A suite that writes to the real one can
 * exhaust a real budget with imaginary money — which is exactly how the sibling project learned to
 * do this, by spending $0.50 of stub money into a live ledger and then, quite correctly, refusing
 * to go on.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Budget, worstCase, NOVA_LITE } = require('./budget');

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

const ledger = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hands-budget-')), 'spend.json');
const budget = (ceiling) => new Budget({ ceiling, file: ledger() });

console.log('spend ceiling');

it('a fresh ledger is zero, not an error', () => {
  const b = budget(0.5);
  assert.equal(b.read().spent, 0);
  assert.equal(b.read().calls, 0);
  assert.match(b.summary(), /\$0\.0000 of \$0\.50/);
});

it('PRE-FLIGHT: it refuses a call that COULD exceed, not one that already did', () => {
  // The distinction is the whole point. Checking afterwards means the money is already gone.
  const b = budget(0.0001);
  assert.throws(() => b.check({ label: 'a vision call' }), /Budget stop/);
  assert.equal(b.read().calls, 0, 'a refused call must not appear in the ledger');
});

it('PERSISTENT: spend recorded by one process stops the next one', () => {
  const file = ledger();
  new Budget({ ceiling: 0.0005, file }).record(0.0004, { tool: 'see' });

  // A completely separate instance, as a second terminal or a restarted loop would be.
  const later = new Budget({ ceiling: 0.0005, file });
  assert.equal(later.read().spent, 0.0004);
  assert.throws(() => later.check({ label: 'second call' }), /Budget stop/);
});

it('FAILS CLOSED: an unreadable ledger stops everything', () => {
  /*
   * The opposite of the instinct everywhere else in this codebase, where a broken cache or a
   * missing file degrades to a slower path. Here it degrades to NO path, because the thing being
   * guarded against is money nobody meant to spend — and "assume nothing has been spent" is how an
   * account quietly empties.
   */
  const file = ledger();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json at all');
  const b = new Budget({ ceiling: 0.5, file });
  assert.throws(() => b.read(), /Refusing to call Bedrock/);
  assert.throws(() => b.check({ label: 'x' }), /Refusing to call Bedrock/);
});

it('a negative or nonsense ledger is refused too', () => {
  for (const bad of ['{"spent":-5}', '{"spent":"lots"}', '{}']) {
    const file = ledger();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bad);
    assert.throws(() => new Budget({ ceiling: 0.5, file }).read(), /Refusing to call Bedrock/, bad);
  }
});

it('the estimate over-counts, on purpose', () => {
  // The question a ceiling answers is "could this take me past the line", and a guess that runs
  // low answers it wrong in the expensive direction. An image is counted at 3,000 tokens, which is
  // far more than a photograph actually costs.
  const one = worstCase({ images: 1 });
  const none = worstCase({ images: 0 });
  assert.ok(one > none, 'an image is being counted as free');
  assert.ok(one > 0.0002, 'the image allowance has been quietly reduced');
});

it('the recorded cost comes from real usage, not the estimate', () => {
  // The estimate runs high so the ceiling errs toward refusing. Recording it would make the ledger
  // drift steadily above what was actually billed, and the ceiling would bite early and wrongly.
  const b = budget(0.5);
  const actual = b.costOf({ inputTokens: 1500, outputTokens: 120 });
  assert.ok(actual > 0);
  assert.ok(actual < worstCase({ images: 1 }), 'the real cost is not below the worst case');
  assert.equal(actual, Number(((1500 * NOVA_LITE.in + 120 * NOVA_LITE.out) / 1e6).toFixed(8)));
});

it('a missing or malformed usage block costs zero, never NaN', () => {
  // A NaN in the ledger poisons every later comparison against the ceiling, and the guard silently
  // stops guarding.
  const b = budget(0.5);
  for (const usage of [undefined, null, {}, { inputTokens: null }, { inputTokens: 'x' }]) {
    const c = b.costOf(usage);
    assert.ok(Number.isFinite(c), `usage ${JSON.stringify(usage)} produced ${c}`);
    assert.equal(c, 0);
  }
});

it('recording accumulates and counts calls', () => {
  const file = ledger();
  const b = new Budget({ ceiling: 0.5, file });
  b.record(0.0001, { tool: 'see' });
  b.record(0.0002, { tool: 'read_manual' });
  assert.equal(b.read().calls, 2);
  assert.equal(b.read().spent, 0.0003);
  assert.match(b.summary(), /across 2 calls/);
});

it('every Bedrock call site is behind the ceiling', () => {
  // A guard on one of two doors is not a guard. Checked structurally, because the alternative is
  // making real billed calls to find out.
  for (const f of ['tools/see.js', 'tools/read_manual.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.match(src, /budget\(\)\.check\(/, `${f} invokes Bedrock without checking the ceiling`);
    assert.match(src, /require\('\.\.\/budget'\)/, `${f} does not import the budget`);
  }
});

it('no tool reaches Bedrock by a route that skips the ceiling', () => {
  /*
   * The check above names two files. This one proves there are only two.
   *
   * `read_error`, `identify_appliance` and `confirm_fix` all reach the model through `see()`, so
   * they inherit the ceiling — today. A fourth tool calling the AWS CLI directly would be guarded
   * by nothing and would look exactly like the other three from the outside. So the rule is stated
   * as a rule: if you invoke Bedrock, you check the budget in the same file.
   */
  const dir = path.join(__dirname, 'tools');
  const unguarded = [];

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.includes('.test.'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const invokes = /invoke-model|bedrock-runtime/.test(src);
    if (invokes && !/budget\(\)\.check\(/.test(src)) unguarded.push(file);
  }

  assert.deepEqual(unguarded, [],
    `these invoke Bedrock and never check the ceiling: ${unguarded.join(', ')}`);
});

console.log(`\n${passed} passed`);
