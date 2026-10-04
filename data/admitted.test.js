/**
 * The library, held against itself.
 *
 *   node data/admitted.test.js
 *
 * Every file in `data/admitted/` is there because somebody read the parse against the manual's own
 * pages and ticked it. That is the strongest check this project has and it is not a perfect one —
 * a reviewer reads rows, and these are the two failures that a row-by-row read does not catch,
 * because neither is visible in any single row.
 *
 * Both of them were live in the library when this file was written.
 *
 *   a collapsed parse   `B18IF905SP` carried seven distinct fault codes — E24, E07, F21, OE, 4C,
 *                       5E, H20 — every one of them with the identical meaning "REASON: The water
 *                       inlet valve is stuck open" and the identical cause. Read one row at a time
 *                       each looks plausible. Read together they are one answer stamped seven
 *                       times, and four of those codes are not even Bosch conventions: OE and
 *                       4C/5E are LG and Samsung, H20 is Whirlpool. It was a refrigerator manual.
 *                       The record was removed rather than corrected — there is nothing in it that
 *                       came from that manual.
 *
 *   the wrong appliance `--kind Dishwasher` was passed to a batch that contained a refrigerator
 *                       and a dryer, and the flag was believed over the manuals. The library then
 *                       said a fridge was a dishwasher, which is the sort of thing an assistant
 *                       repeats out loud to somebody standing in front of their fridge.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'admitted');

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

const machines = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))]);

/** Everything the machine says, in one string, for asking what kind of thing it is. */
const wordsOf = (d) =>
  [
    ...(d.symptoms || []).flatMap((s) => [
      s.symptom,
      ...(s.causes || []).flatMap((c) => [c.label, ...(c.remedies || [])]),
    ]),
    ...Object.values(d.codes || {}).flatMap((c) => [
      c.meaning,
      ...(c.causes || []).flatMap((x) => [x.label, ...(x.remedies || [])]),
    ]),
  ]
    .filter(Boolean)
    .join(' ');

console.log('the admitted library');

it('there is a library at all', () => {
  assert.ok(machines.length >= 10, `only ${machines.length} machines are admitted`);
});

it('two fault codes never share one meaning and one cause', () => {
  /*
   * Distinct codes mean distinct things — that is what a code is for. A record where several of
   * them carry the same sentence is not a manual that repeats itself; it is one answer that was
   * copied across every row, and it is invisible unless you look at the rows together.
   */
  for (const [model, d] of machines) {
    const seen = new Map();
    for (const [code, entry] of Object.entries(d.codes || {})) {
      const fingerprint = JSON.stringify([
        entry.meaning || '',
        (entry.causes || []).map((c) => [c.label, ...(c.remedies || [])]),
      ]);
      // An empty meaning with empty causes says nothing and cannot collide meaningfully.
      if (fingerprint === '["",[]]') continue;
      if (seen.has(fingerprint)) {
        assert.fail(
          `${model}: ${seen.get(fingerprint)} and ${code} carry the identical meaning and cause — ` +
            'that is one answer stamped twice, not two facts'
        );
      }
      seen.set(fingerprint, code);
    }
  }
});

it('no machine is filed as something its own manual says it is not', () => {
  /*
   * Keyed on words only one kind of appliance uses. A dishwasher manual does not discuss the
   * freezer compartment, and a fridge does not discuss rinse aid. This is deliberately a check for
   * a CONTRADICTION rather than a classifier: a machine whose words suggest nothing is left alone,
   * because the point is to catch a flag that was believed over a manual.
   */
  const TELLS = {
    Refrigerator: /freezer compartment|defrosting|refrigerator compartment/i,
    Dishwasher: /rinse aid|dishes|detergent dispenser/i,
    Oven: /cookware|pyrolytic|warming drawer|oven/i,
    Dryer: /\bdryer\b|lint|drying cycle/i,
    // "washer" itself, and agitation: a GE top-loader's table never says "wash cycle", and does
    // tell you what to do if you have no clothes dryer — which read as a dryer's manual and nothing else.
    Washer: /\bwash cycle\b|spin cycle|detergent drawer|\bwasher\b|agitat/i,
  };

  // Kinds as the product pages name them, grouped into the families the tells above distinguish:
  // a wall oven, a range and a cooktop all talk about cookware, and that is not a contradiction.
  const FAMILY = {
    'Wall oven': 'Oven', Range: 'Oven', Cooktop: 'Oven', Microwave: 'Oven', 'Warming drawer': 'Oven', 'Range hood': 'Oven',
    'Fridge freezer': 'Refrigerator', 'Washing machine': 'Washer',
  };
  for (const [model, d] of machines) {
    if (!d.kind) continue; // a machine whose kind nobody recorded claims nothing
    const family = FAMILY[d.kind] || d.kind;
    const words = wordsOf(d);
    const suggests = Object.entries(TELLS)
      .filter(([, re]) => re.test(words))
      .map(([kind]) => kind);

    if (!suggests.length) continue;
    assert.ok(
      suggests.includes(family),
      `${model} is filed as a ${d.kind}, and its own manual talks about a ${suggests.join(' or ')}`
    );
  }
});

it('every cause cites the page it was read from', () => {
  // The claim the whole product rests on. A cause with no page is a sentence somebody has to take
  // on trust, which is the thing this library exists not to produce.
  for (const [model, d] of machines) {
    for (const s of d.symptoms || []) {
      for (const c of s.causes || []) {
        assert.ok(c.evidence, `${model}: "${c.label}" has no evidence`);
        assert.ok(
          c.source?.page || /page \d+/i.test(c.evidence),
          `${model}: "${c.label}" cites no page`
        );
      }
    }
  }
});

it('a machine that was read says who checked it', () => {
  for (const [model, d] of machines) {
    if (!d.source) continue; // the hand-written ones were never read off a page
    assert.ok(d.reviewedBy, `${model} came out of a manual and nobody is recorded as having checked it`);
  }
});

console.log(`\n${passed} passed`);
