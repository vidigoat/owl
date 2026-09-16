#!/usr/bin/env node
/**
 * How many questions does it actually ask?
 *
 *   npm run questions
 *
 * The central algorithmic claim of this project is that choosing each check by uncertainty removed
 * per unit of owner effort gets to one cause in two or three questions, where asking about every
 * possibility in turn takes as many questions as there are causes.
 *
 * That is a claim, and claims should be numbers. This exhausts it: for every fault code on every
 * machine the project knows, it walks **every possible sequence of answers** a person could give,
 * and reports how long each path was. Not a sample — all of them.
 *
 * Two numbers matter, and the second more than the first:
 *
 *   MEAN    how long a typical repair conversation is
 *   WORST   how long the unluckiest one is, because that is the person who gives up
 *
 * It also reports how much EFFORT each path cost, which is the part a pure information-gain
 * measure would miss. Three easy questions beat one that involves pulling the machine out from
 * under the counter, even when the hard one rules out more.
 */

const { MODELS, LEARNED, learn } = require('../data/service-data');
const { parse } = require('../manual/faultgraph');
const { buildSpace, prune } = require('../mcp/tools/hypotheses');
const { nextTest } = require('../mcp/tools/next_test');

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', green: '\x1b[32m', amber: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', green: '', amber: '', bold: '', off: '' };

/** What each tier of check actually costs the person holding the torch. */
const EFFORT_COST = { free: 0, easy: 1, awkward: 4, heavy: 12 };

/**
 * Walk every answer a person could give, depth first.
 *
 * Exhaustive rather than sampled: with a handful of causes the tree is small, and a mean taken over
 * a sample would hide precisely the unlucky path that matters most.
 */
function walk({ space, tests, performed, effort, depth }, paths, guard = 0) {
  if (guard > 40) return; // a cycle would be a bug in test selection; do not hang proving it
  if (space.length <= 1) {
    paths.push({ questions: depth, effort, resolved: space.length === 1 });
    return;
  }

  const choice = nextTest({ space, tests, performed });
  if (!choice.test) {
    // Nothing left that would tell us anything. A real outcome, and it must be counted — a mean
    // that quietly drops the dead ends flatters itself.
    paths.push({ questions: depth, effort, resolved: false, stuck: true });
    return;
  }

  const cost = EFFORT_COST[choice.test.effort] ?? EFFORT_COST.easy;
  for (const outcome of choice.test.outcomes) {
    const result = prune({ space, outcome });
    if (result.contradiction) {
      paths.push({ questions: depth + 1, effort: effort + cost, resolved: false, contradiction: true });
      continue;
    }
    walk({
      space: result.space,
      tests,
      performed: [...performed, choice.test.id],
      effort: effort + cost,
      depth: depth + 1,
    }, paths, guard + 1);
  }
}

function measure(model, code) {
  const built = buildSpace({ model, code });
  if (!built.known || built.space.length === 0) return null;
  const record = MODELS[model] || LEARNED[model];
  const tests = record.codes[code].tests || [];
  if (!tests.length) return null;

  const paths = [];
  walk({ space: built.space, tests, performed: [], effort: 0, depth: 0 }, paths);
  if (!paths.length) return null;

  const qs = paths.map((p) => p.questions);
  return {
    model,
    code,
    causes: built.space.length,
    bits: built.bits,
    paths: paths.length,
    mean: qs.reduce((a, b) => a + b, 0) / qs.length,
    worst: Math.max(...qs),
    best: Math.min(...qs),
    meanEffort: paths.reduce((a, p) => a + p.effort, 0) / paths.length,
    resolved: paths.filter((p) => p.resolved).length,
    // The naive alternative: ask about each cause in turn until one is confirmed. On average that
    // is half the list, and in the worst case all of it.
    naiveWorst: built.space.length,
  };
}

/**
 * Manuals for machines this project has never heard of, learned at runtime — so the measurement
 * covers the generality claim too, not only the appliance the fixtures were written around. These
 * are real fault tables from real service manuals.
 */
const MANUALS = [
  { model: 'LG-WM3900HWA', brand: 'LG', text: `Error codes
OE   The machine cannot drain
     Check the drain filter for blockages
     Straighten the drain hose behind the machine
     Replace the drain pump if it does not turn

UE   The load is unbalanced
     Redistribute the load by hand
     Check the machine is level on all four feet
` },
  { model: 'HOTPOINT-FDW60', brand: 'Hotpoint', text: `Fault codes
H20  The machine is not filling with water
     Check the water supply tap is fully open
     Clean the inlet filter at the hose connection
     Replace the inlet valve if it does not open

F05  The machine is not draining
     Check the drain filter for debris
     Straighten the drain hose
     Replace the drain pump if it does not turn

F13  The water is not heating
     Check the mains supply to the heater
     Replace the heating element
` },
];

if (require.main === module) {
  // Learn them first. Everything below then treats them exactly like the built-in machines, which
  // is the point: a machine learned thirty seconds ago should be no harder to diagnose.
  for (const m of MANUALS) {
    const g = parse({ model: m.model, text: m.text, sourceName: `${m.brand} service manual` });
    learn({ model: m.model, brand: m.brand, codes: g.codes, source: `${m.brand} service manual` });
  }

  console.log(`\n  ${C.bold}How many questions does it ask?${C.off}`);
  console.log(`  ${C.dim}Every fault code on every machine, and every possible sequence of answers — not a sample.${C.off}\n`);

  const rows = [];
  for (const [model, m] of Object.entries({ ...MODELS, ...LEARNED })) {
    for (const code of Object.keys(m.codes)) {
      const r = measure(model, code);
      if (r) rows.push({ ...r, brand: m.brand || '', learned: Boolean(m.generated) });
    }
  }

  console.log(`  ${'machine'.padEnd(22)} ${'code'.padEnd(6)} ${'causes'.padEnd(7)} ${'paths'.padEnd(6)} ${'mean'.padEnd(6)} ${'worst'.padEnd(6)} naive worst`);
  console.log(`  ${C.dim}${'─'.repeat(74)}${C.off}`);
  for (const r of rows) {
    const better = r.worst < r.naiveWorst;
    console.log(
      `  ${(r.brand + ' ' + r.model).slice(0, 21).padEnd(22)} ${r.code.padEnd(6)} ` +
      `${String(r.causes).padEnd(7)} ${String(r.paths).padEnd(6)} ` +
      `${r.mean.toFixed(1).padEnd(6)} ${String(r.worst).padEnd(6)} ` +
      `${better ? C.green : C.amber}${r.naiveWorst}${C.off}` +
      `${r.learned ? `  ${C.dim}learned from its manual${C.off}` : ''}`
    );
  }

  const mean = rows.reduce((a, r) => a + r.mean, 0) / rows.length;
  const worst = Math.max(...rows.map((r) => r.worst));
  const naive = rows.reduce((a, r) => a + r.naiveWorst, 0) / rows.length;
  const effort = rows.reduce((a, r) => a + r.meanEffort, 0) / rows.length;
  const totalPaths = rows.reduce((a, r) => a + r.paths, 0);

  console.log(`\n  ${C.bold}${mean.toFixed(1)} questions${C.off} on average, worst case ${C.bold}${worst}${C.off}` +
    `${C.dim} — against ${naive.toFixed(1)} causes to ask about one at a time.${C.off}`);
  console.log(`  ${C.dim}Mean effort ${effort.toFixed(1)} (free 0 · easy 1 · awkward 4 · heavy 12).` +
    ` ${totalPaths} answer paths walked, every one of them.${C.off}`);
  console.log(`  ${C.dim}The worst case is the number that matters: it is the person who gives up.${C.off}`);

  /* ── does it matter at scale? ────────────────────────────────────────────
   * The table above is honest and modest: three causes per code is a small space, and 1.3 against
   * 2.5 is a real improvement that nobody would write home about.
   *
   * The interesting question is what happens as fault tables get larger, and that is a property of
   * the algorithm rather than of any appliance — so it can be answered without inventing service
   * data for machines nobody has measured. These spaces are SYNTHETIC and labelled as such: uniform
   * priors, one clean binary check per cause. Real tables are messier and the real curve is worse.
   * What survives is the shape.
   */
  console.log(`\n  ${C.bold}When does choosing the question actually help?${C.off}`);
  console.log(`  ${C.dim}Synthetic spaces, uniform priors. Not appliance data — this is a property of the`);
  console.log(`  algorithm, and the answer turned out to be more interesting than expected.${C.off}\n`);
  console.log(`  ${'causes'.padEnd(8)} ${'one-cause checks'.padEnd(18)} ${'partitioning checks'.padEnd(20)} one at a time`);
  console.log(`  ${C.dim}${'─'.repeat(66)}${C.off}`);

  const worstOver = (space, tests) => {
    const paths = [];
    walk({ space, tests, performed: [], effort: 0, depth: 0 }, paths);
    return Math.max(...paths.map((p) => p.questions));
  };

  for (const n of [3, 4, 6, 8, 12, 16, 24, 32]) {
    const space = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `cause ${i}`, prior: 1 / n }));

    // A remedy check: "try this, did it fix it?" A yes identifies one cause; a no removes exactly
    // one. This is what a fault table's remedy list gives you, and it is irreducibly linear.
    const oneCause = space.map((c, i) => ({
      id: `t${i}`, question: `is it ${c.label}?`, effort: 'easy',
      outcomes: [
        { value: 'yes', say: 'yes', consistentWith: [c.id] },
        { value: 'no', say: 'no', consistentWith: space.filter((x) => x.id !== c.id).map((x) => x.id) },
      ],
    }));

    // An observation: "can you hear the pump?" Each answer is consistent with a GROUP of causes,
    // so one question can halve the space rather than trimming one off it.
    const partitioning = Array.from({ length: Math.ceil(Math.log2(n)) + 1 }, (_, bit) => {
      const on = space.filter((_, i) => (i >> bit) & 1).map((c) => c.id);
      const off = space.filter((_, i) => !((i >> bit) & 1)).map((c) => c.id);
      return {
        id: `p${bit}`, question: `observation ${bit}?`, effort: 'easy',
        outcomes: [
          { value: 'a', say: 'yes', consistentWith: on },
          { value: 'b', say: 'no', consistentWith: off },
        ],
      };
    }).filter((t) => t.outcomes.every((o) => o.consistentWith.length));

    console.log(
      `  ${String(n).padEnd(8)} ${String(worstOver(space, oneCause)).padEnd(18)} ` +
      `${C.green}${String(worstOver(space, partitioning)).padEnd(20)}${C.off} ${n - 1}`
    );
  }

  console.log(`\n  ${C.dim}The finding worth stating: information gain cannot beat working down a list when every`);
  console.log(`  check tests exactly one cause. A remedy — "try this, did it fix it?" — is that kind of`);
  console.log(`  check, and a fault table is a list of remedies. Against OBSERVATIONS, which are`);
  console.log(`  consistent with several causes at once, it is logarithmic instead of linear.`);
  console.log(`  ${C.off}`);
  console.log(`  ${C.dim}Which is why data/service-data.js authors observations for the machines it knows, and`);
  console.log(`  why a machine learned from a manual gets remedy checks and a flatter curve. That gap is`);
  console.log(`  real, it is visible in the table above, and closing it is the next piece of work.${C.off}\n`);
}

module.exports = { measure, walk, EFFORT_COST };
