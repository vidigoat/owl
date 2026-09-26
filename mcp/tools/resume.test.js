/**
 * A repair paused mid-way and picked up in a later conversation.
 *
 * The thing being guarded here is a promise this project makes everywhere else: it does not assert
 * what it cannot see. A part is on order; a delivery estimate is not a delivery; so an open repair
 * is offered back as a question ("has it arrived?"), never a claim, and a step read back to a person
 * is a real step or none.
 *
 * Run: node mcp/tools/resume.test.js
 */
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

process.env.HOME_STORE = path.join(os.tmpdir(), `ssoh-resume-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
const { pauseRepair, resumeRepair, receipt } = require('./home');

let passed = 0;
const it = (name, fn) => {
  try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; }
};
const day = (n) => new Date(Date.now() + n * 86400000);

console.log('resuming a repair');

it('a paused repair comes back with its step and what it is waiting for', () => {
  const r = pauseRepair({ model: 'SHE3AR75UC', code: 'E24', cause: 'Failed drain pump', atStep: 2, ofSteps: 4, waitingFor: 'drain pump', expectedBy: day(3).toISOString() });
  assert.equal(r.paused, true);
  const back = resumeRepair({ model: 'SHE3AR75UC' });
  assert.equal(back.count, 1);
  assert.equal(back.open[0].atStep, 2);
  assert.equal(back.open[0].waitingFor, 'drain pump');
});

it('the line asks whether the part arrived — it never says it did', () => {
  const soon = pauseRepair({ model: 'WM-1', code: 'E1', atStep: 1, ofSteps: 3, waitingFor: 'inlet valve', expectedBy: day(2).toISOString() });
  assert.match(soon.say, /on order/i);
  assert.doesNotMatch(soon.say, /arrived|delivered|is here|has come/i);
  const passedEta = pauseRepair({ model: 'WM-2', code: 'E2', atStep: 1, ofSteps: 3, waitingFor: 'inlet valve', expectedBy: day(-1).toISOString() });
  assert.match(passedEta.say, /due by now/i);
  assert.match(passedEta.say, /\?$/, 'a due part is a question, not an assertion');
  // The question "Has it arrived?" is right; a statement that it HAS is what must never appear.
  assert.doesNotMatch(passedEta.say, /\b(it|which|that) (has )?arrived\.|has arrived\.|is here\.|was delivered/i);
});

it('pausing the same fault twice updates it, and does not fork into two', () => {
  pauseRepair({ model: 'DUP-1', code: 'E5', atStep: 1, ofSteps: 5, waitingFor: 'seal' });
  pauseRepair({ model: 'DUP-1', code: 'E5', atStep: 3 });
  const back = resumeRepair({ model: 'DUP-1' });
  assert.equal(back.count, 1, 'the same repair forked');
  assert.equal(back.open[0].atStep, 3, 'the later step did not win');
  assert.equal(back.open[0].waitingFor, 'seal', 'the earlier part was forgotten on update');
});

it('an impossible step is dropped, not read back to someone at a step that is not there', () => {
  const over = pauseRepair({ model: 'STEP-1', code: 'E6', atStep: 3, ofSteps: 2, waitingFor: 'pump' });
  assert.equal(over.open.atStep, null, 'step 3 of 2 was kept');
  const frac = pauseRepair({ model: 'STEP-2', code: 'E7', atStep: 1.5, ofSteps: 4, waitingFor: 'pump' });
  assert.equal(frac.open.atStep, null, 'a fractional step was kept');
  const neg = pauseRepair({ model: 'STEP-3', code: 'E8', atStep: -1, ofSteps: 4, waitingFor: 'pump' });
  assert.equal(neg.open.atStep, null, 'a negative step was kept');
});

it('a delivery phrase is not stored as a date', () => {
  const r = pauseRepair({ model: 'PHRASE-1', code: 'E9', atStep: 1, ofSteps: 3, waitingFor: 'pump', expectedBy: 'tomorrow by 9pm' });
  assert.equal(r.open.expectedBy, null, '"tomorrow by 9pm" was stored as a date');
  assert.match(r.say, /on order/i, 'a repair with no real date is on order, not due');
});

it('a paused repair with neither a step nor a part is refused', () => {
  const r = pauseRepair({ model: 'EMPTY-1', code: 'E10' });
  assert.equal(r.paused, false);
  assert.match(r.reason, /at least a step reached or what it is waiting for/);
});

it('a bad model number is refused at the door', () => {
  assert.equal(pauseRepair({ model: "'; DROP TABLE x --", atStep: 1, ofSteps: 2 }).paused, false);
  assert.equal(pauseRepair({ model: 'constructor', atStep: 1, ofSteps: 2 }).paused, false);
});

it('finishing the repair closes the open one — it is not offered again after it is done', () => {
  pauseRepair({ model: 'CLOSE-1', code: 'E24', atStep: 2, ofSteps: 4, waitingFor: 'drain pump', expectedBy: day(-1).toISOString() });
  assert.equal(resumeRepair({ model: 'CLOSE-1' }).count, 1);
  const rec = receipt({ model: 'CLOSE-1', code: 'E24', action: 'Fitted the new drain pump', confirmed: true });
  assert.equal(rec.closedOpenRepair, true);
  assert.equal(resumeRepair({ model: 'CLOSE-1' }).count, 0, 'a finished repair was still offered as open');
});

it('resume with no model returns the whole house, part-due ones first', () => {
  pauseRepair({ model: 'HOUSE-A', code: 'E1', atStep: 1, ofSteps: 2, waitingFor: 'x', expectedBy: day(5).toISOString() });
  pauseRepair({ model: 'HOUSE-B', code: 'E2', atStep: 1, ofSteps: 2, waitingFor: 'y', expectedBy: day(-2).toISOString() });
  const all = resumeRepair({});
  assert.ok(all.count >= 2);
  assert.equal(all.open[0].ready, true, 'a part due by now was not put first');
});

console.log(`\n${passed} passed`);
