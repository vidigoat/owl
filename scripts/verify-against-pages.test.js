/**
 * The verifier's own refusals — the ones it makes before it opens the page.
 *
 *   node scripts/verify-against-pages.test.js
 *
 * A row the reader doubted, or one whose remedy opens mid-sentence, is refused by name with its
 * reason, whatever the page says. Those are exactly the rows the page check would pass: every word
 * of them is printed there. The manual file is a placeholder, so this proves the refusal happens
 * without the page ever being read.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { verify } = require('./verify-against-pages');

let passed = 0;
const it = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; } };

const MANUALS = path.join(__dirname, '..', 'manuals');
const NAME = `__verify-test-${process.pid}.pdf`;
fs.mkdirSync(MANUALS, { recursive: true });
fs.writeFileSync(path.join(MANUALS, NAME), '');

const record = (cause) => ({ model: 'TEST1', source: NAME, symptoms: [{ id: 's', symptom: 'Spots on dishes', causes: [{ id: 's-0', label: 'Hard water', source: { page: 3 }, ...cause }] }] });

console.log('verify-against-pages');

try {
  it('a remedy that opens mid-sentence is refused, with that reason, before the page is read', () => {
    const r = verify(record({ remedies: ['tap water (manganese).', 'Clean the appliance.'] }));
    assert.deepEqual(r.bad, ['s-0']);
    assert.deepEqual(r.ok, []);
    assert.match(r.missing[0].why, /mid-sentence/);
  });

  it('a row the reader doubted is refused with the reader\'s own reason', () => {
    const r = verify(record({ remedies: ['Use a rinse agent.'], unsure: 'its cause is one line read twice' }));
    assert.deepEqual(r.bad, ['s-0']);
    assert.match(r.missing[0].why, /read twice/);
  });
} finally {
  fs.rmSync(path.join(MANUALS, NAME), { force: true });
}

console.log(`\n${passed} passed`);
