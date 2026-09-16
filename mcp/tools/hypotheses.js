/**
 * tool: hypotheses
 *
 * A diagnosis is not a lookup. It is a space of possibilities that shrinks as evidence arrives.
 * This module owns that space: building it from a model's fault data, measuring how uncertain it
 * is, and pruning it when a test comes back.
 *
 * Nothing here decides anything or talks to a person. `next_test` chooses what to ask;
 * `verify_diagnosis` decides when one survivor has earned the right to be spoken as fact.
 */

const { lookup } = require('../../data/service-data');

/**
 * Shannon entropy of the space, in bits — how much we still don't know.
 * One certain cause is 0 bits. Four equally likely causes is 2 bits.
 */
function entropy(space) {
  const total = space.reduce((n, c) => n + c.prior, 0);
  if (total <= 0) return 0;
  return -space.reduce((h, c) => {
    const p = c.prior / total;
    return p > 0 ? h + p * Math.log2(p) : h;
  }, 0);
}

/** Priors always sum to 1, whatever the source data did. */
function normalise(space) {
  const total = space.reduce((n, c) => n + c.prior, 0);
  if (total <= 0) return space.map((c) => ({ ...c, prior: 1 / space.length }));
  return space.map((c) => ({ ...c, prior: c.prior / total }));
}

/**
 * Build the space for one fault code on one model.
 * The manual's own fault table supplies the ordering; that ordering becomes the prior.
 */
function buildSpace({ model, code }) {
  const found = lookup(model, code);
  if (!found.known) return { known: false, reason: found.reason, space: [] };
  if (found.causes.length === 0) {
    return { known: false, reason: `${code} is listed for ${model} but has no verified causes yet.`, space: [] };
  }

  const space = normalise(
    found.causes.map((c) => ({
      id: c.id,
      label: c.label,
      prior: c.likelihood,
      cost: c.cost,
      mains: c.mains,
      ownerFixable: c.ownerFixable,
      evidence: c.evidence,
    }))
  );

  return { known: true, meaning: found.meaning, space, bits: entropy(space) };
}

/**
 * Fold a test result back in.
 *
 * A cause survives only if it is consistent with what was observed. Eliminated causes are kept in
 * the return value rather than discarded silently — the interface shows them greying out, and that
 * moment is how a person understands what just happened.
 */
function prune({ space, outcome }) {
  const keepIds = new Set(outcome.consistentWith);
  const survivors = space.filter((c) => keepIds.has(c.id));
  const eliminated = space.filter((c) => !keepIds.has(c.id));

  // An outcome that rules out everything means the evidence contradicts the fault table. Say so
  // rather than quietly returning an empty space and pretending to be certain of nothing.
  if (survivors.length === 0) {
    return {
      space,
      eliminated: [],
      contradiction: true,
      reason: 'That result rules out every cause in the manual for this code. Something else is going on.',
    };
  }

  const next = normalise(survivors);
  return { space: next, eliminated, contradiction: false, bits: entropy(next) };
}

module.exports = { buildSpace, prune, entropy, normalise };
