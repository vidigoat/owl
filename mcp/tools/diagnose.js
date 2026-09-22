/**
 * tool: diagnose
 *
 * Ranked causes for one fault code on one model, cheapest-and-most-likely first, so the copilot
 * always tries the free thing before it reaches for the paid one.
 *
 * This tool never decides anything. It offers candidates; `verify_diagnosis` decides whether any of
 * them may be spoken as fact.
 */

const { lookup } = require('../../data/service-data');

function diagnose({ model, code } = {}) {
  const found = lookup(model, code);

  if (!found.known) {
    return { known: false, reason: found.reason, causes: [] };
  }

  // Most likely first; where two are close, the one that costs the owner nothing goes first.
  const causes = [...found.causes].sort((a, b) => {
    const byLikelihood = b.likelihood - a.likelihood;
    if (Math.abs(byLikelihood) > 0.1) return byLikelihood;
    return a.cost - b.cost;
  });

  return {
    known: true,
    brand: found.brand,
    kind: found.kind,
    meaning: found.meaning,
    causes,
    tryFirst: causes.find((c) => c.cost === 0 && c.ownerFixable) || null,
  };
}

module.exports = { name: 'diagnose', diagnose };
