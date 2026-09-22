/**
 * The gate that decides whether a troubleshooting table gets read at all.
 *
 *   node scripts/learn-manual.test.js
 *
 * ── What this is here to stop happening again ───────────────────────────────
 *
 * A Siemens oven manual prints its entire troubleshooting table on pages 13 and 14. Both scored as
 * symptom tables. Page 12 also scored — it is a Home Connect page whose prose contains the word
 * "troubleshooting" — and it carries `symptomsOnly: false`, because it has no table of any kind.
 *
 * The gate asked whether EVERY scored page in the run was a symptom table. One page that was not
 * about anything vetoed two pages with the whole table on them. The manual then went down the
 * fault-code path: a rendered page, a vision call, money spent, and correctly nothing found. Nine
 * symptoms, their causes and their remedies were thrown away, and the run reported "nothing usable
 * found" — which is the worst possible way to lose data, because it looks like an answer.
 *
 * The distinction the old gate missed: `symptomsOnly: false` does not mean "this table is keyed on
 * codes". It means "this page is not a symptom table", which a page with no table also satisfies.
 */

const assert = require('node:assert');
const { symptomKeyed } = require('./learn-manual');

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

const page = (n, symptomsOnly) => ({ page: n, score: 40, symptomsOnly });

console.log('the symptom-table gate');

it('a page with no table cannot veto two pages that have one', () => {
  // The exact shape that lost a manual: 12 is a Home Connect page, 13 and 14 are the table.
  const candidates = [page(14, true), page(12, false), page(16, false), page(13, true)];
  assert.equal(symptomKeyed(candidates, { from: 12, to: 14 }), true);
});

it('a run with no symptom table in it is not read as one', () => {
  // Then the fault-code path is the right one and should be allowed to run.
  const candidates = [page(20, false), page(21, false)];
  assert.equal(symptomKeyed(candidates, { from: 20, to: 21 }), false);
});

it('a page outside the chosen run has no vote', () => {
  /*
   * This was the previous bug in this same line, fixed once already: candidates include pages that
   * merely scored and were never used. A symptom table on page 40 must not make the run at 12–14
   * read as symptom-keyed when nothing in 12–14 is one.
   */
  const candidates = [page(40, true), page(12, false), page(13, false)];
  assert.equal(symptomKeyed(candidates, { from: 12, to: 13 }), false);
});

it('one symptom page in a long run is enough', () => {
  const candidates = [page(30, false), page(31, false), page(32, true), page(33, false)];
  assert.equal(symptomKeyed(candidates, { from: 30, to: 33 }), true);
});

it('an empty candidate list is not a symptom table', () => {
  assert.equal(symptomKeyed([], { from: 1, to: 2 }), false);
});

console.log(`\n${passed} passed`);
