/**
 * Can the trust gate actually refuse for every reason it claims to?
 *
 *   node mcp/tools/gate-reachability.test.js
 *
 * `verify_diagnosis` is the only function in this repository allowed to authorise spending, and the
 * submission says it refuses on four grounds, any one of which is enough. That is a claim about
 * behaviour, and a claim about behaviour should be a command that runs.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The gate is a ladder of early returns, and that shape fails in a way that reads as the opposite
 * of a bug: a refusal sitting below a return that always precedes it looks like coverage, reviews
 * like coverage, and never runs. Two of those were found in this codebase on the same afternoon —
 * one in `next_test`, one in the `faultgraph` spin-out's severity rules — and neither was caught by
 * reading the code, because dead branches read exactly like live ones.
 *
 * So the grounds are not read off the source. Every model, every code, every cause id and **every
 * subset of ruled-out causes** in the real service data goes through the real gate, and what comes
 * back is the set of verdicts it can actually produce.
 *
 * ── What the walk found ─────────────────────────────────────────────────────
 *
 * That "no verified causes" and "you have ruled everything out" were the same branch, with the same
 * sentence, both sending the owner to a paid technician. They are opposite facts — a gap in our
 * data versus a machine doing something its manual does not describe — and the first one was
 * billing people for our own missing rows. Three of the four machines here reach it.
 */

const assert = require('node:assert');
const { verify_diagnosis, SEPARATION } = require('./verify_diagnosis');
const { MODELS, LEARNED, learn } = require('../../data/service-data');
const { parse } = require('../../manual/faultgraph');

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

/** Every subset, because ruling things out is what moves the gate between its branches. */
const subsets = (a) => a.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

/** Counts, labels and model names vary; the branch they came from does not. */
const shape = (r) =>
  r.abstain
    ? `abstain/${r.escalate} :: ${r.reason.replace(/"[^"]*"/g, '"…"').replace(/\b[A-Z0-9]{4,}\b/g, 'MODEL').replace(/\d+/g, 'N')}`
    : `uphold :: costKnown=${r.costKnown} maySpend=${r.maySpend}`;

function walk() {
  const verdicts = new Map();
  let combinations = 0;

  const record = (result, where) => {
    const key = shape(result);
    if (!verdicts.has(key)) verdicts.set(key, where);
  };

  for (const [model, m] of Object.entries(MODELS)) {
    for (const [code, entry] of Object.entries(m.codes || {})) {
      const ids = (entry.causes || []).map((c) => c.id);
      for (const ruledOut of subsets(ids)) {
        for (const causeId of [undefined, ...ids]) {
          combinations++;
          record(verify_diagnosis({ model, code, causeId, ruledOut }), `${model} ${code} cause=${causeId} ruledOut=[${ruledOut}]`);
        }
      }
    }
  }

  const anyModel = Object.keys(MODELS)[0];
  record(verify_diagnosis({ model: 'Nonexistent', code: 'E24' }), 'unknown model');
  record(verify_diagnosis({ model: anyModel, code: 'ZZ99' }), 'unknown code');

  return { verdicts, combinations };
}

console.log('trust gate — reachability');

const { verdicts, combinations } = walk();

it('the walk covers the whole of the real service data', () => {
  assert.ok(combinations > 50, `${combinations} combinations is a sample, not the space`);
  const models = Object.keys(MODELS).length;
  assert.ok(models >= 4, `only ${models} models — the walk has stopped being broad`);
});

it('every one of the four stated grounds can actually refuse', () => {
  // The four the submission names. Each must be produced by some real input, not merely written.
  const grounds = {
    'behind mains voltage': /mains wiring/,
    'a cheaper cause has not been ruled out': /still N% more likely/,
    'the top two are too close to separate': /within N% of each other/,
    'there is no data to stand on': /no verified causes for it yet|No service data for|No record of/,
  };
  const said = [...verdicts.keys()];
  for (const [ground, pattern] of Object.entries(grounds)) {
    assert.ok(said.some((v) => pattern.test(v)),
      `the gate claims to refuse because ${ground}, and no input in the real data makes it do so`);
  }
});

it('a gap in our data and a machine we cannot explain are different refusals', () => {
  // These were one branch with one sentence. A gap in the data is cheap to close — photograph the
  // manual page — and telling that owner to book a callout bills them for our missing rows.
  const gap = verify_diagnosis({ model: 'WFW5620HW', code: 'F21' });
  assert.equal(gap.abstain, true);
  assert.equal(gap.escalate, 'read-manual', 'an owner was sent to a paid technician over a row we never wrote');
  assert.match(gap.reason, /Show me the fault-code page/);

  const exhausted = verify_diagnosis({ model: 'SHE3AR75UC', code: 'E24', ruledOut: ['filter', 'pump', 'hose'] });
  assert.equal(exhausted.escalate, 'technician', 'a machine defying its own manual is genuinely a callout');
  assert.match(exhausted.reason, /does not describe/);
  assert.notEqual(gap.reason, exhausted.reason, 'two opposite facts are being reported with one sentence');
});

it('every machine carrying a code with no causes offers to read the manual', () => {
  // Rather than naming the three that do today, which would go stale the moment one is written up.
  let offered = 0;
  for (const [model, m] of Object.entries(MODELS)) {
    for (const [code, entry] of Object.entries(m.codes || {})) {
      if ((entry.causes || []).length) continue;
      const v = verify_diagnosis({ model, code });
      assert.equal(v.escalate, 'read-manual', `${model} ${code} has no causes and does not offer the cheap path`);
      offered++;
    }
  }
  assert.ok(offered > 0, 'no thin entries left — delete this test rather than let it pass vacuously');
});

it('a refusal never carries a part to buy', () => {
  // The property the whole gate exists for. No abstaining verdict may look spendable.
  for (const key of verdicts.keys()) {
    if (!key.startsWith('abstain')) continue;
    assert.ok(!/maySpend=true/.test(key), `a refusal was produced that authorises spending: ${key}`);
  }
});

it('upholding happens, and distinguishes a free fix from a priced one', () => {
  const upholds = [...verdicts.keys()].filter((k) => k.startsWith('uphold'));
  assert.ok(upholds.length >= 2,
    'the gate either never upholds anything, or has stopped telling a free fix from a paid part');
  assert.ok(upholds.some((u) => u.includes('maySpend=true')), 'nothing in the data can ever be bought');
  assert.ok(upholds.some((u) => u.includes('maySpend=false')), 'every upheld cause wants money');
});

it('the evidence ground is defence-in-depth, and is honest about that', () => {
  /*
   * "No evidence recorded for this cause" cannot fire against the real data: every cause in
   * service-data.js cites something, and causes learned from a manual are constructed with the
   * manual line as their evidence, so there is no path that produces one without.
   *
   * That is a defensible check — it guards the invariant at the point it would be violated — but it
   * is NOT a fifth ground that fires in practice, and describing it as one would overstate what the
   * gate does. So it is proven to work against a cause built to violate the invariant, and the
   * walk above deliberately does not list it among the grounds it demands.
   */
  const said = [...verdicts.keys()];
  assert.ok(!said.some((v) => /No evidence recorded/.test(v)),
    'the evidence ground now fires on real data — add it to the four grounds above, it has earned a place');

  learn({
    model: 'TEST-NO-EVIDENCE',
    codes: { E01: { meaning: 'test', causes: [{ id: 'x', label: 'x', likelihood: 0.9, cost: 0, mains: false, ownerFixable: true }] } },
    source: 'gate-reachability.test.js',
  });
  const v = verify_diagnosis({ model: 'TEST-NO-EVIDENCE', code: 'E01' });
  assert.equal(v.abstain, true, 'a cause citing nothing was upheld');
  assert.match(v.reason, /No evidence recorded/);
  delete LEARNED['TEST-NO-EVIDENCE'];
});

it('a machine learned from its manual can be upheld, but never authorises a spend', () => {
  /*
   * The whole differentiator, and the walk above cannot reach it — that walk covers MODELS, the
   * reviewed data, where every cost is a real number. A machine read off a photographed manual page
   * goes into LEARNED instead, and its causes are built with cost: null, on purpose: a service
   * manual lists remedies, never prices. So the gate may uphold the manual's top cause and read the
   * remedy aloud, but `maySpend` must stay false, because a price we never had cannot become one we
   * authorise. This pins that the "helped, but not billed" path is real and stays real.
   */
  const model = 'LEARNED-DRAIN-1';
  const graph = parse({
    model,
    sourceName: 'ACME service manual',
    text: [
      'E21  The machine will not drain.',
      'Clean the drain filter at the front lower panel.',
      'Check the drain hose for a kink behind the machine.',
    ].join('\n'),
  });
  learn({ model, brand: 'ACME', kind: 'Dishwasher', codes: graph.codes, source: 'ACME service manual' });
  try {
    const v = verify_diagnosis({ model, code: 'E21' });
    assert.equal(v.abstain, false, 'the manual gave two clear non-mains remedies; the gate should uphold the top one');
    assert.equal(v.upheld, true);
    assert.equal(v.costKnown, false, 'a price was invented for a machine learned from a manual');
    assert.equal(v.maySpend, false, 'the gate authorised spending on a cost it never had');
    assert.ok(Number.isFinite(v.confidence), 'a learned cause reached the gate without a numeric likelihood');
    assert.match(v.citation, /ACME service manual/, 'the upheld cause must cite the manual line it came from');
  } finally {
    delete LEARNED[model];
  }
});

it('the separation threshold is the one the gate advertises', () => {
  assert.equal(SEPARATION, 0.15);
  const close = [...verdicts.keys()].find((k) => /within N% of each other/.test(k));
  assert.ok(close, 'nothing in the data is close enough to test the threshold at all');
});

console.log(`\n${passed} passed  ·  ${combinations} gate calls walked, ${verdicts.size} distinct verdicts reachable`);
