/**
 * The money path.
 *
 * This is the only place in the project that can take something from someone, so it gets the
 * hardest tests: nothing is orderable off a refused diagnosis, a confirmation only applies to a
 * cart that was actually read out, and the total always includes what it is.
 *
 * Run: node mcp/tools/checkout.test.js
 */

const assert = require('node:assert');
const { beginCheckout, confirmCheckout, cancelCheckout } = require('./order_part');
const { CATALOGUE } = require('./find_part');

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

const UPHELD = { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: ['filter', 'hose'] };

console.log('checkout');

it('will not sell anything for a cause the gate refused', () => {
  // the pump, with the free filter check still standing — the gate refuses this
  const r = beginCheckout({ model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.match(r.reason, /Not ordering anything/);
});

it('will not sell anything for a cause that costs nothing to fix', () => {
  const r = beginCheckout({ model: 'SHE3AR75UC', code: 'E24', causeId: 'filter' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no part to buy/i);
});

it('will not sell a part it cannot verify against the model', () => {
  const r = beginCheckout({ model: 'WFW5620HW', code: 'F21', causeId: 'anything' });
  assert.equal(r.ok, false);
});

it('opens a checkout once the diagnosis is upheld', () => {
  const r = beginCheckout(UPHELD);
  assert.equal(r.ok, true);
  assert.ok(r.sessionId);
  assert.equal(r.lineItems.length, 1);
});

it('states the total, itemised, before anyone says yes', () => {
  const r = beginCheckout(UPHELD);
  const { subtotal, tax, shipping, total } = r.totals;
  assert.ok(subtotal > 0 && tax > 0);
  assert.equal(total, Number((subtotal + tax + shipping).toFixed(2)));
  assert.match(r.say, new RegExp(String(total)), 'the spoken line must contain the actual total');
});

it('says what it is instead of, so yes means something', () => {
  const r = beginCheckout(UPHELD);
  assert.ok(r.insteadOf.price > r.totals.total);
  assert.ok(r.saving > 0);
});

it('cannot be confirmed without the session it was read from', () => {
  const r = confirmCheckout({ sessionId: 'chk_made_up' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Nothing was charged/);
});

it('completes exactly once', () => {
  const opened = beginCheckout(UPHELD);
  const first = confirmCheckout({ sessionId: opened.sessionId });
  assert.equal(first.ok, true);
  assert.ok(first.order.orderId);
  assert.equal(first.order.handler_id, 'amazon_pay_network_token');

  const second = confirmCheckout({ sessionId: opened.sessionId });
  assert.equal(second.ok, false, 'a second confirmation must not place a second order');
});

it('can be cancelled before it is placed, and not after', () => {
  const opened = beginCheckout(UPHELD);
  assert.equal(cancelCheckout({ sessionId: opened.sessionId }).ok, true);

  const other = beginCheckout(UPHELD);
  confirmCheckout({ sessionId: other.sessionId });
  assert.equal(cancelCheckout({ sessionId: other.sessionId }).ok, false);
});


it('an unknown cost is never reported as a free repair', () => {
  // Found by reading `npm run demo` output: for an LG washer learned from its manual, the device
  // said replacing a failed drain pump "costs nothing to fix. There is no part to buy." A service
  // manual lists remedies, never prices — so the cost was UNKNOWN and was being written as 0.
  // Zero means free. They are opposite facts, and this one had money attached to it.
  const { parse } = require('../../manual/faultgraph');
  const parsed = parse({
    text: 'Fault codes\nOE   The machine cannot drain\n     Replace the drain pump if it does not turn\n',
    source: 'LG service manual',
  });
  const entry = parsed.codes?.OE ?? parsed.OE ?? Object.values(parsed.codes || parsed)[0];
  const causes = entry?.causes || [];
  assert.ok(causes.length, 'the manual should have produced a cause to test');
  causes.forEach((c) =>
    assert.notEqual(c.cost, 0, `"${c.label}" was given a cost of 0, which claims the repair is free`)
  );
});

it('refuses to quote a total it cannot compute — never speaks a "$NaN"', () => {
  // The gate upholds this cause and there is a part for it, but if the part ever carries no
  // trustworthy price, money(price) becomes NaN and the cart would say "$NaN in total". A fabricated
  // figure in the money path is the same lie as calling an unknown cost free — so it must refuse.
  const key = `${UPHELD.model}:${UPHELD.causeId}`;
  const real = CATALOGUE[key];
  try {
    for (const badPrice of [undefined, NaN, '38.42', 0, -5]) {
      CATALOGUE[key] = { ...real, price: badPrice };
      const r = beginCheckout(UPHELD);
      assert.equal(r.ok, false, `a ${JSON.stringify(badPrice)} price opened a cart`);
      assert.equal(r.refused, true);
      assert.doesNotMatch(JSON.stringify(r), /NaN|\$undefined/, 'a garbage figure reached the response');
    }
  } finally {
    CATALOGUE[key] = real;
  }
  // And with the real price restored, the cart still opens and its total is finite.
  const ok = beginCheckout(UPHELD);
  assert.equal(ok.ok, true);
  assert.ok(Number.isFinite(ok.totals.total));
});

console.log(`\n${passed} passed`);
