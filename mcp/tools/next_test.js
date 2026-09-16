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
 * Choose what to ask next.
 *
 * Returns null when there is nothing worth asking — either one cause is left, or no remaining test
 * would tell us anything. Both are real answers, and the caller must handle them: one means we are
 * done, the other means we are stuck and should refuse rather than guess.
 */
function nextTest({ space, tests, performed = [] }) {
  if (space.length <= 1) {
    return { test: null, reason: 'one cause left', done: true };
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

  // The cheapest test within a whisker of the best one wins. Being marginally more informative
  // does not justify asking someone to pull an appliance out from under a counter.
  const nearlyAsGood = ranked.filter((r) => r.bits >= best.bits * 0.85);
  const chosen = nearlyAsGood.sort((a, b) => a.effort - b.effort || b.bits - a.bits)[0];

  return {
    test: chosen.test,
    bits: Number(chosen.bits.toFixed(3)),
    effort: chosen.test.effort,
    done: false,
    stuck: false,
    // Said on screen. If it cannot explain why it is asking, it should not ask.
    why:
      chosen.test.id === best.test.id
        ? `Rules out the most for the least effort.`
        : `Nearly as telling as the harder check, and you don't have to move anything.`,
  };
}

module.exports = { nextTest, score, expectedEntropyAfter, EFFORT };
