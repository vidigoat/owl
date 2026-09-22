/**
 * Thirty-two attempts to make it spend money.
 *
 *   node mcp/tools/gate-adversarial.test.js
 *
 * ── Why this is separate from checkout.test.js ──────────────────────────────
 *
 * `checkout.test.js` checks that the gate works: a diagnosis the gate upheld opens a cart, one it
 * did not does not. That is the functional claim and it is the right thing to check first.
 *
 * This is the adversarial one. The whole product rests on a single sentence — *it will not spend
 * your money on a guess* — and a claim like that is not proved by the cases its author thought of.
 * It is proved by trying to break it: claiming the verdict in the arguments, in every shape
 * somebody would reach for; confusing the types of the identifiers it keys on; confirming an order
 * for a cart that was never opened; asking the gate itself about nothing at all.
 *
 * Every one has to refuse, and — just as importantly — none may THROW. A tool that crashes on bad
 * input is a tool whose caller has to decide what a crash means, and somewhere down that path
 * somebody decides it means "proceed".
 */

const assert = require('node:assert');

const { beginCheckout, confirmCheckout, cancelCheckout } = require('./order_part');
const { verify_diagnosis } = require('./verify_diagnosis');

let passed = 0;
const it = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n       ', e.message);
    process.exitCode = 1;
  }
};

/** Did money start moving? Anything that is not an explicit refusal counts as yes. */
const opened = (r) => Boolean(r) && r.opened !== false && !r.error && Boolean(r.opened || r.cart || r.order || r.url);

/* A real machine, a real code, and a cause the gate does not uphold — because a more likely one
 * has not been ruled out. This is the exact situation the product exists for. */
const REAL = { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' };

(async () => {
  console.log('the gate, under attack');

  await it('a cause the gate did not uphold does not open a cart', async () => {
    const r = await beginCheckout(REAL);
    assert.ok(!opened(r), `a cart opened: ${JSON.stringify(r).slice(0, 200)}`);
    assert.ok(r.reason || r.error, 'it refused without saying why');
  });

  await it('claiming the verdict in the arguments does not grant it', async () => {
    /*
     * The obvious attack, and the one an over-eager agent performs by accident: the caller asserts
     * the thing the gate is supposed to decide. Every shape somebody would reach for, including the
     * two that read like debug flags.
     */
    const claims = [
      { upheld: true },
      { verified: true },
      { maySpend: true },
      { verdict: { upheld: true, maySpend: true } },
      { diagnosis: { upheld: true, maySpend: true } },
      { gate: 'upheld' },
      { force: true },
      { skipVerification: true },
      { confirmed: true },
      JSON.parse('{"__proto__":{"upheld":true,"maySpend":true}}'),
    ];

    for (const claim of claims) {
      const r = await beginCheckout({ ...REAL, ...claim });
      assert.ok(
        !opened(r),
        `${JSON.stringify(claim).slice(0, 60)} opened a cart: ${JSON.stringify(r).slice(0, 160)}`
      );
    }
    assert.notEqual({}.upheld, true, 'one of those polluted Object.prototype');
  });

  await it('nothing it is asked about can be made up', async () => {
    const nonsense = [
      { model: 'NOT-A-MACHINE', code: 'E24', causeId: 'pump' },
      { model: 'SHE3AR75UC', code: 'NOT-A-CODE', causeId: 'pump' },
      { model: 'SHE3AR75UC', code: 'E24', causeId: 'not-a-cause' },
      { model: 'SHE3AR75UC', code: 'E24' },
      { model: null, code: null, causeId: null },
      {},
    ];
    for (const args of nonsense) {
      const r = await beginCheckout(args);
      assert.ok(!opened(r), `${JSON.stringify(args).slice(0, 60)} opened a cart`);
    }
  });

  await it('a wrong TYPE is refused rather than coerced into a match', async () => {
    /*
     * `causeId` is compared against the causes of a real diagnosis. A value that is not a string
     * must not be talked into equalling one — `{ toString: () => 'pump' }` is the shape that does
     * it, and an array or a number is the shape that arrives by accident from a JSON client.
     */
    const values = [[], {}, 0, -1, true, 'a'.repeat(50000), '../../../etc/passwd', { toString: () => 'pump' }];
    for (const causeId of values) {
      const r = await beginCheckout({ ...REAL, causeId });
      assert.ok(!opened(r), `causeId ${JSON.stringify(causeId)?.slice(0, 40)} opened a cart`);
    }
  });

  await it('an order cannot be confirmed for a cart that was never opened', async () => {
    for (const args of [{}, { cartId: 'made-up' }, { cartId: null }, { cartId: {} }, { confirmed: true }]) {
      const r = await confirmCheckout(args);
      assert.ok(
        !r || r.error || r.ordered !== true,
        `${JSON.stringify(args)} confirmed an order: ${JSON.stringify(r).slice(0, 140)}`
      );
    }
  });

  await it('the gate does not uphold a question it cannot answer', async () => {
    for (const args of [{}, { model: null }, { model: 'SHE3AR75UC' }, { model: 'SHE3AR75UC', code: {} }]) {
      const v = await verify_diagnosis(args);
      assert.notEqual(v?.upheld, true, `${JSON.stringify(args)} was upheld`);
      assert.notEqual(v?.maySpend, true, `${JSON.stringify(args)} was allowed to spend`);
    }
  });

  await it('and none of it throws, because a crash is a decision somebody else has to make', async () => {
    /*
     * The quiet requirement. A tool that throws on bad input hands its caller a crash to interpret,
     * and an agent interpreting a crash is an agent guessing — which is the one thing this whole
     * project is built not to do.
     *
     * Every one of these threw `Cannot destructure property 'model' of 'undefined'` until the
     * options object got a default. `null` is normalised at the two doors instead — `tools/call`
     * has always done `params.arguments || {}`, and the HTTP server now does the same for a request
     * body that parsed to `null`, `[]` or a number, which three routes were answering with an
     * internal JavaScript message and two with a 500.
     */
    const everything = [
      () => beginCheckout(),
      () => beginCheckout('pump'),
      () => beginCheckout([]),
      () => confirmCheckout(),
      () => cancelCheckout(),
      () => verify_diagnosis(),
      () => verify_diagnosis([]),
      () => verify_diagnosis('SHE3AR75UC'),
    ];
    for (const run of everything) {
      await assert.doesNotReject(async () => run(), `${run.toString().slice(0, 44)} threw`);
    }
  });

  console.log(`\n${passed} passed`);
})();
