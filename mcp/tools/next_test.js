/**
 * tool: next_test  —  the heart of the thing
 *
 * Every repair app hands you a fixed checklist. A technician doesn't work that way: they pick the
 * one check that tells them the most, do it, and re-plan. This picks that check.
 *
 * Two quantities decide it:
 *   1. expected information gain — how many bits of uncertainty this test removes, on average
 *   2. what it costs the person — opening a door is free; pulling the machine out is not
 *
 * The second is why this feels like a person rather than a decision tree. It will knowingly choose
 * a less informative test because it is far easier to perform, and it says so out loud.
 */

const { entropy, normalise } = require('./hypotheses');

/** Effort, roughly in minutes, mapped to a divisor. A free check is never penalised. */
const EFFORT = { free: 0, easy: 1, awkward: 4, heavy: 12 };

/**
 * Expected entropy after running a test, averaged over its possible outcomes,
 * weighted by how likely each outcome is given what we currently believe.
 */
function expectedEntropyAfter(space, test) {
  const total = space.reduce((n, c) => n + c.prior, 0) || 1;

  return test.outcomes.reduce((acc, outcome) => {
    const keep = new Set(outcome.consistentWith);
    const survivors = space.filter((c) => keep.has(c.id));
    if (survivors.length === 0) return acc; // impossible outcome contributes nothing

    const pOutcome = survivors.reduce((n, c) => n + c.prior, 0) / total;
    return acc + pOutcome * entropy(normalise(survivors));
  }, 0);
}

/**
 * Score a single test: bits gained, discounted by the effort of performing it.
 * A test that eliminates nothing scores zero however cheap it is.
 */
function score(space, test) {
  const before = entropy(space);
  const after = expectedEntropyAfter(space, test);
  const bits = Math.max(0, before - after);
  const effort = EFFORT[test.effort] ?? EFFORT.easy;
  return { bits, effort, value: bits / (1 + effort) };
}

/**
 * Whether this fault's own record has no checks — a symptom off a troubleshooting table, or a code
 * learned from a manual. Not the same as a caller passing an empty list for a fault that has them:
 * that is running out, and running out is stuck.
 */
function documentsNoChecks(model, code) {
  if (!model || !code) return false;
  const data = require('../../data/service-data');
  if (!data.lookup(model, code).known) return false;
  return !(data.machine(model)?.codes?.[code]?.tests?.length);
}

/**
 * Choose what to ask next.
 *
 * Returns null when there is nothing worth asking — either one cause is left, or no remaining test
 * would tell us anything. Both are real answers, and the caller must handle them: one means we are
 * done, the other means we are stuck and should refuse rather than guess.
 */
function nextTest({ space, tests, performed = [], model, code } = {}) {
  /*
   * An agent calling this may hand over the space and forget the checks, or hand over nothing
   * usable at all. Both used to be `Cannot read properties of undefined` — a crash, from the one
   * tool that decides what a person is asked to do next. Now: the checks are looked up from the
   * machine when they were not passed, and anything still unusable is refused in words.
   */
  if (!Array.isArray(space)) {
    return { test: null, error: 'needs `space` — the array `hypotheses` returns', stuck: true };
  }
  if (!Array.isArray(tests) && model && code) {
    const data = require('../../data/service-data');
    tests = data.machine(model)?.codes?.[code]?.tests;
    // A fault whose record documents no checks has an empty list, not a missing one.
    if (!Array.isArray(tests) && documentsNoChecks(model, code)) tests = [];
  }
  if (!Array.isArray(tests)) {
    return {
      test: null,
      error: 'needs `tests` — the array `hypotheses` returns alongside the space — or `model` and `code` to look them up',
      stuck: true,
    };
  }
  if (!Array.isArray(performed)) performed = [];

  if (space.length <= 1) {
    return { test: null, reason: 'one cause left', done: true };
  }

  /*
   * Every cause behind mains. There is nothing to ask.
   *
   * Not "stuck" — settled, and settled before a single question. A person can narrow this all
   * afternoon and the answer does not move: `verify_diagnosis` refuses a mains cause at any
   * confidence, so no answer they could give unlocks a repair they are allowed to do. Asking anyway
   * is asking somebody to work for an outcome that is already fixed.
   *
   * It used to fall through to "no tests left to run", which is true and reads as failure — as
   * though the tool tried and could not manage it. It did not try. It knew. On the Bosch E09 (three
   * causes, all mains) that was the entire experience of the fault: a person walked a diagnosis and
   * was told at the end that nothing could be established.
   *
   * The distinction matters beyond tone. "I ran out of ideas" invites a second opinion from
   * something that guesses; "this is behind mains wiring, whoever is asking" does not.
   */
  if (space.every((c) => c.mains)) {
    return {
      test: null,
      reason: 'every cause for this code is behind mains wiring',
      settled: true,
      stuck: false,
      done: false,
      escalate: 'technician',
      // Said before any question is asked. If it cannot explain why it is not asking, it should ask.
      why: 'Narrowing this down would not change what you are allowed to do about it.',
    };
  }

  /*
   * No check was ever written for this fault — which is every symptom read off a manual's
   * troubleshooting table: the manual lists causes in order and says nothing about how to tell
   * them apart. That is not "stuck". Stuck is running out of questions; this never had any, and
   * the honest move is the manual's own: try the first thing it lists, then the next.
   *
   * It came back as "no tests left to run", and an agent reasonably read that as failure and went
   * looking for a photo instead.
   */
  if (tests.length === 0 && performed.length === 0 && documentsNoChecks(model, code)) {
    const ordered = [...space].sort((a, b) => b.prior - a.prior);
    return {
      test: null,
      noChecks: true,
      stuck: false,
      done: false,
      reason: 'the manual documents no check that separates these causes',
      order: ordered.map((c) => ({ id: c.id, label: c.label })),
      why: 'The manual lists these in order, most common first. Try the first, then the next.',
    };
  }

  const done = new Set(performed);
  const available = tests.filter((t) => !done.has(t.id));
  if (available.length === 0) {
    return { test: null, reason: 'no tests left to run', stuck: true };
  }

  const ranked = available
    .map((test) => ({ test, ...score(space, test) }))
    .sort((a, b) => b.value - a.value || a.effort - b.effort);

  const best = ranked[0];

  if (best.bits <= 0.001) {
    return { test: null, reason: 'nothing left that would tell us anything', stuck: true };
  }

  /*
   * There was a second pass here: among tests within 85% of the best one's bits, take the cheapest,
   * "because being marginally more informative does not justify asking someone to pull an appliance
   * out from under a counter".
   *
   * It has never fired, and it cannot. Ranking already divides bits by (1 + effort), so a
   * higher-effort test only reaches the top by carrying proportionally more information — and the
   * smallest step on this scale, free to easy, is a factor of two. For the cheaper test to also be
   * within 15% of the best, it would have to be both under half as informative and over 85% as
   * informative. Solve it across every pair of effort levels EFFORT defines and the window is empty
   * every time.
   *
   * The preference for cheap checks therefore lives entirely in the ranking, which is where it
   * belongs. What the dead pass carried with it was a second `why` string — a sentence shown to a
   * person, which no person has ever been shown. That is worse than dead code: it is a claim about
   * the product's behaviour that reads as true and is not.
   *
   * Found by extracting this scorer into the `faultgraph` library and writing a test that asserted
   * the second message. The test could not be made to pass.
   */
  const chosen = best;

  return {
    test: chosen.test,
    bits: Number(chosen.bits.toFixed(3)),
    effort: chosen.test.effort,
    done: false,
    stuck: false,
    // Said on screen. If it cannot explain why it is asking, it should not ask.
    why: `Rules out the most for the least effort.`,
  };
}

module.exports = { nextTest, score, expectedEntropyAfter, EFFORT };
