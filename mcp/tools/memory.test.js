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
const { remember, receipt, history, due, ordinal, recurring, STORE } = require('./home');

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
  /* ── a fault that keeps coming back ──────────────────────────────────────── */

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

/** Write a household history straight to the store, so a test does not depend on receipt()'s shape. */
function pastRepairs(receipts) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify({ appliances: {}, receipts }));
}

await it('one fault is not a pattern', () => {
  pastRepairs([{ model: 'M', code: 'E24', at: daysAgo(3) }]);
  assert.deepEqual(recurring(), []);
});

await it('the same fault twice on the same machine is reported with its dates', () => {
  /*
   * The household's own history answers a question no manual can. A dishwasher throwing E24 once is
   * a blocked filter; the same machine throwing it three times in four months is a different fact.
   */
  pastRepairs([
    { model: 'M', code: 'E24', at: daysAgo(4) },
    { model: 'M', code: 'E24', at: daysAgo(40) },
    { model: 'M', code: 'E24', at: daysAgo(120) },
  ]);
  const [r] = recurring();
  assert.equal(r.times, 3);
  assert.equal(r.daysSinceLast, 4, 'the most recent occurrence was not first');
  assert.equal(r.daysSinceFirst, 120);
  assert.equal(r.occurrences.length, 3);
});

await it('one diagnosis is one occasion, however many receipts it writes', () => {
  /*
   * Measured against the real household store, this counted 32 occurrences of E24 across five days
   * and reported a machine failing thirty-two times. Every one was seconds from the next: a single
   * diagnosis writes several receipts — a guided step, a part, a confirmation — and walking the
   * demo twice writes a dozen. It was one fault, looked at twice.
   */
  const day = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  pastRepairs([
    { model: 'M', code: 'E24', at: `${day}T09:00:00.000Z` },
    { model: 'M', code: 'E24', at: `${day}T09:00:02.000Z` },
    { model: 'M', code: 'E24', at: `${day}T21:40:11.000Z` },
  ]);
  assert.deepEqual(recurring(), [], 'one day of receipts was reported as a pattern');
});

await it('a confirmed repair anywhere in a day makes that day a confirmed fix', () => {
  // The flag has to survive the collapse, or folding receipts together quietly loses the fact that
  // somebody said the repair worked.
  const a = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  const b = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  pastRepairs([
    { model: 'M', code: 'E24', at: `${a}T09:00:00.000Z`, confirmed: false },
    { model: 'M', code: 'E24', at: `${a}T09:30:00.000Z`, confirmed: true },
    { model: 'M', code: 'E24', at: `${b}T09:00:00.000Z`, confirmed: false },
  ]);
  const [r] = recurring();
  assert.equal(r.times, 2);
  assert.equal(r.confirmedFixes, 1);
});

await it('different codes on one machine are different faults', () => {
  pastRepairs([
    { model: 'M', code: 'E24', at: daysAgo(4) },
    { model: 'M', code: 'E15', at: daysAgo(9) },
  ]);
  assert.deepEqual(recurring(), []);
});

await it('the same code on two machines is two machines, not a pattern', () => {
  pastRepairs([
    { model: 'A', code: 'E24', at: daysAgo(4) },
    { model: 'B', code: 'E24', at: daysAgo(9) },
  ]);
  assert.deepEqual(recurring(), []);
});

await it('two identical faults years apart are two faults', () => {
  // A window, not a threshold on the machine's whole life.
  pastRepairs([
    { model: 'M', code: 'E24', at: daysAgo(4) },
    { model: 'M', code: 'E24', at: daysAgo(1500) },
  ]);
  assert.deepEqual(recurring(), []);
});

await it('confirmed fixes are counted apart from attempts', () => {
  /*
   * A fault that returned after three confirmed repairs is a stronger fact than one that returned
   * after three attempts nobody ever said worked. Conflating them turns "we never finished the job"
   * into "the machine is failing".
   */
  pastRepairs([
    { model: 'M', code: 'E24', at: daysAgo(4), confirmed: true },
    { model: 'M', code: 'E24', at: daysAgo(40), confirmed: false },
    { model: 'M', code: 'E24', at: daysAgo(80), confirmed: true },
  ]);
  const [r] = recurring();
  assert.equal(r.times, 3);
  assert.equal(r.confirmedFixes, 2);
});

await it('it reports the dates and draws no conclusion from them', () => {
  /*
   * What a recurrence MEANS — a failing part, a machine near its end, worth a technician — is not
   * derivable from three timestamps. The dates are the finding; nothing here is allowed to be a
   * recommendation.
   */
  pastRepairs([
    { model: 'M', code: 'E24', at: daysAgo(4) },
    { model: 'M', code: 'E24', at: daysAgo(40) },
  ]);
  const [r] = recurring();
  const keys = Object.keys(r).sort();
  assert.deepEqual(keys, ['code', 'confirmedFixes', 'daysSinceFirst', 'daysSinceLast', 'model', 'occurrences', 'times']);
  for (const banned of ['verdict', 'advice', 'recommendation', 'replace', 'severity']) {
    assert.ok(!(banned in r), `recurring() is offering a ${banned}`);
  }
});

await it('due() keeps `count` meaning consumables, and adds attention alongside', () => {
  // A schedule and a pattern are different claims. Anything already reading `count` must not
  // silently start counting something else.
  pastRepairs([
    { model: 'M', code: 'E24', at: daysAgo(4) },
    { model: 'M', code: 'E24', at: daysAgo(40) },
  ]);
  const d = due();
  assert.equal(d.count, 0, 'a recurrence was counted as a consumable due');
  assert.equal(d.recurring.length, 1);
  assert.equal(d.attention, 1);
});

/*
 * Every test in this file has to be awaited, and this checks that they were.
 *
 * `it` is async. An unawaited call runs its body in a microtask AFTER this line, so the test
 * executes, passes, prints its tick below the summary, and is counted by nothing. Eight real tests
 * did exactly that here. A test that silently does not run is worse than one that fails, because
 * the suite still says green and the number it reports is quietly wrong.
 */
const declared = (fs.readFileSync(__filename, 'utf8').match(/^\s*await it\(/gm) || []).length;
if (passed !== declared && !process.exitCode) {
  console.error(`  FAIL ${declared} tests are declared and ${passed} ran — one is missing its await`);
  process.exitCode = 1;
}

console.log(`\n${passed} passed`);
})();
