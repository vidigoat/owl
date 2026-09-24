/**
 * A household the host cannot write is kept for the conversation, and says so.
 *
 *   node mcp/tools/home-durability.test.js
 *
 * On the hosted server the store sits in a read-only bundle. remember_repair answered `saved: true`
 * for a write that had failed, the agent told the person it was recorded, and the history came back
 * empty. The store here is a path nothing can create, which is the hosted situation on any machine.
 */
process.env.HOME_STORE = '/dev/null/cannot-exist/home.json';

const assert = require('node:assert');
const { receipt, history, remember } = require('./home');

let passed = 0;
const it = (name, fn) => {
  try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; }
};

console.log('household durability');

it('a repair that cannot be written durably is not "saved" — it says it is not kept', () => {
  const r = receipt({ model: 'SHE3AR75UC', code: 'E24', cause: 'Blocked filter', action: 'Cleaned the filter' });
  assert.equal(r.saved, false);
  assert.equal(r.kept, 'session');
  assert.match(r.keptFor, /^Not kept/);
  assert.equal(r.entry.action, 'Cleaned the filter');
});

it('in this process it can still be read back', () => {
  const h = history({ model: 'SHE3AR75UC' });
  assert.equal(h.receipts.length, 1);
  assert.equal(h.receipts[0].cause, 'Blocked filter');
  const again = receipt({ model: 'SHE3AR75UC', code: 'E24', cause: 'Blocked filter', action: 'Cleaned it again' });
  assert.equal(again.repeat, true, 'the second time was not recognised as a repeat');
});

it('an appliance remembered on a read-only host says it is not kept', () => {
  const r = remember({ model: 'SHE3AR75UC', brand: 'Bosch' });
  assert.equal(r.remembered, true);
  assert.equal(r.kept, 'session');
});

it('the agent says "not kept", never "recorded", for a repair that will not last', () => {
  const { summariseForTest } = require('../../agent/alexa');
  const line = summariseForTest('remember_repair', { saved: false, kept: 'session', entry: { action: 'Cleaned the filter', confirmed: false } });
  assert.match(line, /not kept/);
  assert.doesNotMatch(line, /^recorded/);
});

console.log(`\n${passed} passed`);
