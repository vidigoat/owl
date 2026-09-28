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
const { read_manual } = require('./read_manual');

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

  await it('an implausibly long "code" is refused, not read out loud in full', async () => {
    // The code is interpolated into a spoken line, and this runs on a device. A caller that sends a
    // 50,000-character code must not turn into the skill trying to say all of it — a real code is a
    // handful of characters, so anything wildly longer is refused as not-a-code.
    const r = await read_error({ model: 'SHE3AR75UC', code: 'E'.repeat(50000) });
    assert.equal(r.abstain, true, 'a 50k-character code was accepted as a real one');
    assert.ok((r.reason || '').length < 200, `the spoken reason carried the giant code (${(r.reason || '').length} chars)`);
    assert.doesNotMatch(JSON.stringify(r), /E{100}/, 'the giant code was echoed back somewhere in the response');
    // A real short code is unaffected: still interpreted, not refused as too long.
    const ok = await read_error({ model: 'SHE3AR75UC', code: 'E24' });
    assert.notEqual(ok.reason, r.reason, 'a normal code was wrongly refused as not-a-code');
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

  it('read_manual tells a wrong page from a page it cannot read', async () => {
  /*
   * The last mile of the two-column fix. The parser distinguishes them, and the distinction was
   * being thrown away here: both came back as "I read the page, but could not get a fault table out
   * of it", which the device speaks aloud to somebody holding a booklet.
   *
   * A person told to go and find the fault-code page, while holding the fault-code page, gives up.
   *
   * `transcribe` is the injection point. The model's only job in this tool is turning pixels into
   * characters, so a test supplying the characters exercises the same code with the same input the
   * model would have produced — no camera, no AWS account, no cost.
   */
  const layout = await read_manual({
    model: 'TEST-LAYOUT',
    transcribe: async () => 'E24  Water cannot leave    Check the drain filter\nE15  Water in base tray    Check the door seal',
  });
  assert.equal(layout.learned, false);
  assert.ok(layout.orphanCodes > 0, 'the codes it did see were not reported');
  assert.match(layout.reason, /no remedies underneath them/);
  assert.match(layout.nextStep, /column to the right/, 'it refused and handed back no move');

  const wrongPage = await read_manual({
    model: 'TEST-WRONG',
    transcribe: async () => 'Before first use, remove all packaging and install by a competent person.',
  });
  assert.equal(wrongPage.learned, false);
  assert.equal(wrongPage.orphanCodes, 0);
  assert.match(wrongPage.nextStep, /troubleshooting|fault codes/i);
  assert.notEqual(layout.reason, wrongPage.reason, 'the two failures still share a sentence');
  assert.notEqual(layout.nextStep, wrongPage.nextStep, 'and still send the person the same way');
});

it('a readable page still learns, through the same seam', () => {
  // The seam must not be a path that only ever fails. If injecting a transcription cannot also
  // succeed, the two tests above are exercising an error handler rather than the tool.
  return read_manual({
    model: 'TEST-GOOD',
    transcribe: async () => 'E24  Water cannot leave the machine\nCheck the drain filter for debris.',
  }).then((r) => {
    assert.equal(r.learned, true, 'the injected path cannot succeed — it is not the real code path');
    assert.deepEqual(r.codes, ['E24']);
    assert.equal(r.orphanCodes, undefined, 'a successful read is reporting orphans');
  });
});

it('no bytes and no transcriber is an answer, not a crash', () => {
  // This tool is called by a model. A stack trace is not something it can act on.
  return read_manual({ model: 'TEST-NOTHING' }).then((r) => {
    assert.equal(r.learned, false);
    assert.ok(r.reason, 'it failed without saying why');
  });
});

console.log(`\n${passed} passed`);
})();
