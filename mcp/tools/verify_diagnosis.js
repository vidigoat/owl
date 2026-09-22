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

function verify_diagnosis({ model, code, causeId, ruledOut = [] } = {}) {
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

  /*
   * Nothing left to consider — and two opposite facts arrive here wearing the same shape.
   *
   *   found.causes is empty          we have never written up this code for this machine
   *   found.causes existed, all gone the owner checked every one of them and cleared them
   *
   * They were one branch, with one sentence, sending both to a paid technician. That is the
   * "could not establish X" / "X is absent" confusion this project has a whole test file about
   * (mcp/tools/absence.test.js), and it had reappeared in the one function allowed to authorise
   * spending.
   *
   * It matters most in the first case. Three of the four machines in service-data.js carry a code
   * with no causes filled in — deliberately, because nothing goes in there until it is checked per
   * model — and this told their owners to book a callout. They were being billed for a gap in our
   * data. This product can read the fault table off a photograph of the manual page, which is the
   * entire differentiator, and the gate was routing past it.
   */
  if (causes.length === 0) {
    const neverHadAny = found.causes.length === 0;
    return {
      abstain: true,
      confidence: 0,
      reason: neverHadAny
        ? `I know ${model} and I know what ${code} means, but I have no verified causes for it yet. ` +
          `Show me the fault-code page of the manual and I'll read it — that costs nothing.`
        : `Every cause I have for ${code} has been ruled out. Something is going on that this ` +
          `machine's service data does not describe.`,
      // 'read-manual' is a cheaper next step than a callout and this product can actually do it.
      // The second case genuinely has nowhere else to go: the manual is where those causes came
      // from, so reading it again returns the same list the owner has already cleared.
      escalate: neverHadAny ? 'read-manual' : 'technician',
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
      // The source likelihood, NOT a posterior. The gate re-derives everything from service data on
    // purpose: a caller that could raise this number by asserting eliminations could talk the gate
    // into authorising a spend. Callers must not present it to a person as "confidence".
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
      // The source likelihood, NOT a posterior. The gate re-derives everything from service data on
    // purpose: a caller that could raise this number by asserting eliminations could talk the gate
    // into authorising a spend. Callers must not present it to a person as "confidence".
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
    // The source likelihood, NOT a posterior. The gate re-derives everything from service data on
    // purpose: a caller that could raise this number by asserting eliminations could talk the gate
    // into authorising a spend. Callers must not present it to a person as "confidence".
    confidence: target.likelihood,
    cause: target,
    citation: target.evidence,
    // A cost of 0 means the fix is free. A cost of null or undefined means we do not know what it
    // costs — which happens on a machine learned from its manual, where there is no parts data at
    // all. Those are opposite facts, and collapsing them told an owner that replacing a drain pump
    // "costs nothing to fix".
    costKnown: typeof target.cost === 'number',
    maySpend: typeof target.cost === 'number' && target.cost > 0,
  };
}

module.exports = { name: 'verify_diagnosis', verify_diagnosis, SEPARATION };
