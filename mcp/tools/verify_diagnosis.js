/**
 * tool: verify_diagnosis  —  THE TRUST GATE
 *
 * The only function permitted to authorise spending. It answers one question: may the copilot state
 * this cause as fact and attach money to it?
 *
 * It refuses when:
 *   - there is no service data for the model or the code
 *   - the top two causes are too close to separate on the evidence available
 *   - the cause involves mains voltage, regardless of how confident the ranking is
 *   - the cause carries no evidence to cite
 *
 * A refusal is not a failure. It is the product working.
 */

const { lookup } = require('../../data/service-data');

const SEPARATION = 0.15; // the top cause must lead the runner-up by this much

function verify_diagnosis({ model, code, causeId, ruledOut = [] }) {
  const found = lookup(model, code);

  if (!found.known) {
    return { abstain: true, confidence: 0, reason: found.reason, escalate: 'technician' };
  }

  // Causes the owner has already tried and cleared are out of the running. This is how the free
  // check being eliminated is what earns the paid one the right to be spoken as fact.
  //
  // `ruledOut` takes CAUSE ids. Passing test ids by mistake used to silently match nothing and
  // produce a refusal saying a cause "hasn't been ruled out" when the caller believed it had —
  // a confusing answer to a caller error. Unrecognised ids are reported rather than ignored.
  const knownIds = new Set(found.causes.map((c) => c.id));
  const unknownRuledOut = ruledOut.filter((id) => !knownIds.has(id));

  const causes = found.causes
    .filter((c) => !ruledOut.includes(c.id))
    .sort((a, b) => b.likelihood - a.likelihood);

  if (causes.length === 0) {
    return {
      abstain: true,
      confidence: 0,
      reason: `Service data for ${model} lists ${code} but no verified causes yet.`,
      escalate: 'technician',
    };
  }

  const top = causes[0];
  const target = causeId ? causes.find((c) => c.id === causeId) : top;

  if (!target) {
    return { abstain: true, confidence: 0, reason: `No cause "${causeId}" recorded for ${code}.`, escalate: 'technician' };
  }

  if (!target.evidence) {
    return { abstain: true, confidence: 0, reason: 'No evidence recorded for this cause.', escalate: 'technician' };
  }

  if (target.mains) {
    return {
      abstain: true,
      confidence: target.likelihood,
      reason: 'This cause sits behind mains wiring. It is not an owner repair regardless of confidence.',
      escalate: 'technician',
    };
  }

  // Judge the target against the best cause that is still standing — never against itself.
  const contender = causes.find((c) => c.id !== target.id);

  if (contender && target.likelihood - contender.likelihood < SEPARATION) {
    const gap = Math.round(Math.abs(target.likelihood - contender.likelihood) * 100);
    const behind = target.likelihood < contender.likelihood;
    return {
      abstain: true,
      confidence: target.likelihood,
      reason: behind
        ? `"${contender.label}" is still ${gap}% more likely and hasn't been ruled out. Try that first.`
        : `"${target.label}" and "${contender.label}" are within ${gap}% of each other. Not enough to separate them without opening the machine.`,
      escalate: behind ? 'try-cheaper-cause-first' : 'technician',
      ...(unknownRuledOut.length ? { unknownRuledOut, hint: 'ruledOut takes cause ids, not test ids — none of those matched a cause for this code.' } : {}),
    };
  }

  return {
    abstain: false,
    upheld: true,
    confidence: target.likelihood,
    cause: target,
    citation: target.evidence,
    maySpend: target.cost > 0,
  };
}

module.exports = { name: 'verify_diagnosis', verify_diagnosis, SEPARATION };
