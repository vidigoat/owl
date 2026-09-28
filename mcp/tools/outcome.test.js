/**
 * The stranger-repair outcome log. It exists to prove the thing was used by someone who is not us —
 * so what it must never do is keep who they are, or keep anything without consent.
 *
 *   node mcp/tools/outcome.test.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { record, summary } = require('./outcome');

let passed = 0;
const it = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; } };
const store = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-')), 'outcomes.jsonl');

console.log('repair outcomes');

it('nothing is kept without consent', () => {
  const s = store();
  assert.equal(record({ model: 'SHE3AR75UC', code: 'E24', outcome: 'fixed' }, { store: s }).recorded, false);
  assert.equal(record({ model: 'SHE3AR75UC', outcome: 'fixed', consent: 'yes' }, { store: s }).recorded, false, 'a truthy non-true consent slipped through');
  assert.ok(!fs.existsSync(s), 'a file was written for an unconsented outcome');
});

it('a real consented outcome is kept, PII-free, with the fields it claims', () => {
  const s = store();
  const r = record({ model: 'SHE3AR75UC', code: 'E24', causeId: 'filter', outcome: 'fixed', stepsCompleted: 4, ofSteps: 4, consent: true }, { store: s });
  assert.equal(r.recorded, true); assert.equal(r.kept, true);
  const row = JSON.parse(fs.readFileSync(s, 'utf8').trim());
  assert.deepEqual(Object.keys(row).sort(), ['at', 'causeId', 'code', 'model', 'ofSteps', 'outcome', 'stepsCompleted'].sort());
  assert.equal(row.outcome, 'fixed');
});

it('anything that looks like identity is refused at the door', () => {
  const s = store();
  for (const model of ['me@example.com', 'https://evil.example', '+1 555 123 4567', 'call 555-1234']) {
    assert.equal(record({ model, outcome: 'fixed', consent: true }, { store: s }).recorded, false, `stored contact-ish model: ${model}`);
  }
  assert.equal(record({ model: 'OK-1', causeId: 'reach me at a@b.com', outcome: 'fixed', consent: true }, { store: s }).recorded, false, 'a contact detail smuggled into causeId was kept');
});

it('the outcome must be one of the known kinds', () => {
  const s = store();
  assert.equal(record({ model: 'X1', outcome: 'exploded', consent: true }, { store: s }).recorded, false);
  for (const o of ['fixed', 'not-fixed', 'gave-up', 'escalated']) assert.equal(record({ model: 'X1', outcome: o, consent: true }, { store: s }).recorded, true, `${o} was rejected`);
});

it('where there is nowhere durable it says so, and does not pretend it saved', () => {
  const logged = [];
  const r = record({ model: 'X1', outcome: 'fixed', consent: true }, { store: '/proc/nonexistent/cannot/write.jsonl', log: { log: (m) => logged.push(m) } });
  assert.equal(r.recorded, true);
  assert.equal(r.kept, false);
  assert.match(r.note, /nowhere durable/);
  assert.ok(logged.some((m) => /outcome:not-kept/.test(m)), 'the outcome was not even put in the log');
});

it('a bad model, or a bad code, is refused', () => {
  const s = store();
  assert.equal(record({ model: '', outcome: 'fixed', consent: true }, { store: s }).recorded, false);
  assert.equal(record({ model: 'OK-1', code: 'this is not a code!!', outcome: 'fixed', consent: true }, { store: s }).recorded, false);
  // a dash for "no code" is fine — maintenance has no fault code.
  assert.equal(record({ model: 'OK-1', code: '-', outcome: 'fixed', consent: true }, { store: s }).recorded, true);
});

it('the summary counts what was finished, per outcome, and how many machines', () => {
  const s = store();
  record({ model: 'A', code: 'E1', outcome: 'fixed', consent: true }, { store: s });
  record({ model: 'A', code: 'E1', outcome: 'fixed', consent: true }, { store: s });
  record({ model: 'B', code: 'E2', outcome: 'not-fixed', consent: true }, { store: s });
  const sum = summary({ store: s });
  assert.equal(sum.total, 3);
  assert.equal(sum.fixed, 2);
  assert.equal(sum.models, 2);
});

it('hostile input does not crash it: null, a non-object, a throwing toString', () => {
  const s = store();
  for (const bad of [null, undefined, 42, 'str', []]) assert.equal(record(bad, { store: s }).recorded, false, `accepted ${JSON.stringify(bad)}`);
  // a causeId whose toString throws must not take the call down — it is dropped, the outcome stands.
  const r = record({ model: 'OK-1', causeId: { toString() { throw new Error('boom'); } }, outcome: 'fixed', consent: true }, { store: s });
  assert.equal(r.recorded, true);
  assert.equal(r.entry.causeId, null, 'a hostile causeId was stored anyway');
});

console.log(`\n${passed} passed`);
