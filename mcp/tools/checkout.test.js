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

console.log(`\n${passed} passed`);
