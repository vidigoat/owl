/**
 * The zero-bad-buy detector. The metric is only trustworthy if it would actually catch a bad buy,
 * so this feeds it one on purpose.
 *
 *   node scripts/no-bad-buy.test.js
 */
const assert = require('node:assert');
const { shouldHaveRefused } = require('./no-bad-buy');

let passed = 0;
const it = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; } };

console.log('zero bad buy');

it('a mains cause is always a bad buy to open a cart for', () => {
  assert.match(shouldHaveRefused({ id: 'element', cost: 90, mains: true, likelihood: 0.9 }, [{ id: 'element', cost: 90, mains: true, likelihood: 0.9 }]), /mains/);
});

it('opening a cart while a cheaper cause is un-ruled-out is a bad buy', () => {
  const sibs = [{ id: 'pump', cost: 38, likelihood: 0.6 }, { id: 'filter', cost: 0, likelihood: 0.3 }];
  assert.match(shouldHaveRefused(sibs[0], sibs), /cheaper cause still live: filter/);
});

it('opening a cart while a comparably-likely cause is un-ruled-out is a bad buy', () => {
  const sibs = [{ id: 'a', cost: 40, likelihood: 0.5 }, { id: 'b', cost: 50, likelihood: 0.42 }];
  // b is within SEPARATION (0.15) of a and not cheaper — a is not clearly ahead.
  assert.match(shouldHaveRefused(sibs[0], sibs), /comparably-likely/);
});

it('a cause clearly ahead, owner-fixable, with the cheaper ones gone, is a legitimate buy', () => {
  const sibs = [{ id: 'pump', cost: 38, mains: false, likelihood: 0.9 }];
  assert.equal(shouldHaveRefused(sibs[0], sibs), null);
});

console.log(`\n${passed} passed`);
