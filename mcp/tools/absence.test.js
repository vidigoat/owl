/**
 * One mistake, tested once, across every tool that can make it.
 *
 * Four of the five defects found on first contact with real AWS were the same error wearing
 * different clothes: treating **"I could not establish X"** as **"X is absent"**.
 *
 *   a display read at 0.1 confidence showing nothing  →  reported as "the fault cleared"
 *   the string "null" in the code field               →  reported as fault code NULL
 *   a photograph with no display in it                →  reported the label's FD number as a fault
 *   a broken CLI call returning nothing               →  reported as a read
 *
 * This project already had a rule about that. It shipped it four more times anyway, which is the
 * argument for this file: a rule lives in someone's head, and a test lives in the repository.
 *
 * The distinction these all turn on:
 *
 *   UNKNOWN   we did not establish it. Nobody may act on this.
 *   ABSENT    we established that there is nothing. This is a finding, and a good one.
 *
 * Run: node mcp/tools/absence.test.js
 */

const assert = require('node:assert');
const { parseReading } = require('./see');
const { confirm_fix, CONFIRM_FLOOR } = require('./confirm_fix');
const { read_error } = require('./read_error');
const { identify_appliance } = require('./identify_appliance');
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

/** Any answer that is not established must say so in a way a caller cannot miss. */
const isUnknown = (r) =>
  r.abstain === true || r.unknown === true || r.simulated === true || r.confirmed === false;

(async () => {
  console.log('absence is not the same as unknown');

  await it('a read that did not happen is never a reading', async () => {
    // No credentials, no image, no path: three ways to not look at something.
    for (const arg of [{}, { imagePath: '/nowhere/at/all.jpg' }, { imageBase64: 'not base64 at all !!' }]) {
      const r = await read_error(arg);
      assert.ok(isUnknown(r), `${JSON.stringify(arg)} produced a usable answer: ${JSON.stringify(r)}`);
      assert.ok(r.reason, 'and it has to say why');
    }
  });

  await it('a word meaning nothing is not a fault code', () => {
    for (const v of ['null', 'NULL', 'none', 'N/A', '', ' ', '-', 'unknown']) {
      assert.equal(parseReading(JSON.stringify({ model: null, code: v, confidence: 0.9 })).code, null,
        `"${v}" survived as a fault code`);
    }
  });

  await it('a failed read is never reported as a healthy machine', async () => {
    // The two states look identical from outside — neither has a fault code — and mean opposite
    // things. "I looked and there is no fault" ends the conversation happily; "I could not look"
    // must not.
    //
    const looked = await read_error({ noCodeShown: true, model: 'SHE3AR75UC' });
    assert.equal(looked.healthy, true, 'a person who looked and saw nothing is a real answer');
    assert.equal(looked.observedBy, 'the person');
    assert.match(looked.note || '', /correct answer/i);

    const unreadable = await read_error({ imagePath: '/nowhere.jpg' });
    assert.notEqual(unreadable.healthy, true, 'a failed read must never be reported as a healthy machine');
    assert.ok(isUnknown(unreadable));
    assert.match(unreadable.reason || '', /\S/);
    assert.notEqual(unreadable.observedBy, 'the person', 'nobody looked; do not say they did');
  });

  await it('a repair is confirmed only on a read good enough to rely on', () => {
    assert.ok(CONFIRM_FLOOR >= 0.4, 'the floor under confirming a fix is too low to mean anything');
  });

  await it('an unreachable camera never confirms a repair', async () => {
    const r = await confirm_fix({ imagePath: '/nowhere/at/all.jpg', code: 'E24' });
    assert.notEqual(r.confirmed, true, 'confirmed a repair it could not look at');
    assert.ok(r.unknown === true || r.simulated === true, JSON.stringify(r));
  });

  await it('an unknown machine is refused, not guessed at', async () => {
    const r = await identify_appliance({ model: 'NOT-A-REAL-MODEL-9000' });
    assert.equal(r.abstain, true);
    assert.equal(r.haveServiceData, false);
    assert.ok(r.nextStep, 'a refusal with no next step is a dead end');
  });

  await it('the gate treats no evidence as no permission', () => {
    const r = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: [] });
    assert.equal(r.abstain, true, 'nothing was ruled out, so nothing is established');
    assert.notEqual(r.maySpend, true);
  });

  await it('every refusal in this file explains itself', async () => {
    // A refusal a person cannot act on is only a slightly better failure.
    const refusals = [
      await read_error({ imagePath: '/nowhere.jpg' }),
      await identify_appliance({ model: 'NOPE-1' }),
      await confirm_fix({ imagePath: '/nowhere.jpg', code: 'E24' }),
      verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: [] }),
    ];
    refusals.forEach((r, i) =>
      assert.ok(String(r.reason || '').length > 10, `refusal ${i} came back without a reason: ${JSON.stringify(r)}`));
  });

  console.log(`\n${passed} passed`);
})();
