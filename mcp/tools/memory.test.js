/**
 * Confirming a repair, and remembering it.
 * Run: node mcp/tools/memory.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the store at a scratch file before the module loads.
process.env.HOME_STORE = path.join(os.tmpdir(), `ssoh-home-${Date.now()}.json`);

const { confirm_fix } = require('./confirm_fix');
const { remember, receipt, history, due, ordinal } = require('./home');

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

(async () => {
  console.log('confirming a repair');

  await it('will not confirm a repair it could not actually look at', async () => {
    const r = await confirm_fix({ imagePath: '/nowhere/panel.jpg', code: 'E24' });
    assert.equal(r.confirmed, false);
    assert.equal(r.simulated, true);
    assert.equal(r.unknown, true, 'an unseen panel is unknown, not fixed');
  });

  await it('treats "could not look" as different from "still broken"', async () => {
    const r = await confirm_fix({ imagePath: '/nowhere/panel.jpg', code: 'E24' });
    assert.notEqual(r.stillFaulty, true, 'must not claim the repair failed when it simply could not see');
  });

  console.log('\nwhat the house remembers');

  await it('remembers an appliance and its history', () => {
    remember({ model: 'TEST-M1', brand: 'Test', kind: 'Dishwasher' });
    receipt({ model: 'TEST-M1', code: 'E24', cause: 'Blocked filter', action: 'Cleaned filter', confirmed: true });
    const h = history({ model: 'TEST-M1' });
    assert.equal(h.appliance.brand, 'Test');
    assert.equal(h.receipts.length, 1);
    assert.equal(h.receipts[0].confirmed, true);
  });

  await it('notices when the same fault comes back', () => {
    const second = receipt({ model: 'TEST-M1', code: 'E24', cause: 'Blocked filter', action: 'Cleaned filter', confirmed: true });
    assert.equal(second.repeat, true);
    assert.match(second.note, /2(nd)? time/i);
  });

  await it('counts in English, because this line is read aloud', () => {
    assert.equal(ordinal(1), '1st');
    assert.equal(ordinal(2), '2nd');
    assert.equal(ordinal(3), '3rd');
    assert.equal(ordinal(4), '4th');
    assert.equal(ordinal(11), '11th');
    assert.equal(ordinal(12), '12th');
    assert.equal(ordinal(21), '21st');
  });

  await it('keeps repairs for different machines apart', () => {
    receipt({ model: 'TEST-M2', code: 'OE', cause: 'Drain pump', action: 'Replaced', confirmed: true });
    assert.equal(history({ model: 'TEST-M1' }).receipts.length, 2);
    assert.equal(history({ model: 'TEST-M2' }).receipts.length, 1);
  });

  await it('says nothing is due when nothing is', () => {
    assert.equal(due().count, 0);
  });

  await it('raises a consumable once it is past its window', () => {
    receipt({ model: 'TEST-M3', code: '—', cause: 'Maintenance', action: 'Fitted', part: 'water filter' });
    const old = new Date(Date.now() + 200 * 86400000); // 200 days later
    const d = due({ today: old });
    assert.equal(d.count, 1);
    assert.equal(d.due[0].part, 'water filter');
  });

  try { fs.unlinkSync(process.env.HOME_STORE); } catch {}
  console.log(`\n${passed} passed`);
})();
