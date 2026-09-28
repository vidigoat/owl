/**
 * tool: replace_or_repair
 *
 * "Is this worth fixing?" — the question an owner actually has, standing in front of a machine that
 * has broken again.
 *
 * ── Why this tool mostly refuses ────────────────────────────────────────────
 *
 * The honest answer needs three numbers and this project has one and a half of them:
 *
 *   what the repair costs      known when a part is catalogued for that exact model. Usually not.
 *   what the machine is worth  nobody here knows. A service manual lists remedies, never prices,
 *                              and no amount of reading one will produce a resale value.
 *   how it has behaved         known, and it is the one this project has for free — the household
 *                              remembers every diagnosis it has run.
 *
 * So the default answer is a refusal that names the missing number, and the tool becomes able to
 * answer the moment somebody supplies it. That is not a limitation dressed up as a feature: an
 * appliance's value depends on its age, its condition and what a used one goes for locally, and a
 * tool that guessed it would be producing the single most consequential figure in the decision out
 * of nothing.
 *
 * ── The rule is ours, and it says so ────────────────────────────────────────
 *
 * Where both numbers are known, the comparison used is the common rule of thumb: repair costing
 * more than half of replacement is worth thinking hard about. That is a POLICY OF THIS TOOL, not a
 * fact about appliances and not something any manufacturer wrote down, so it travels in the output
 * as `rule` with its threshold, and the threshold is an argument. A reader who disagrees can see
 * exactly what they are disagreeing with.
 *
 * ── What it never does ──────────────────────────────────────────────────────
 *
 * It does not say "replace it". It reports what is known, what it cannot know, and which comparison
 * that supports. The decision is the owner's and it involves things this tool has no access to —
 * whether they can afford it this month, whether the kitchen is being redone anyway, whether the
 * machine was a gift.
 */

const { recurring } = require('./home');
const { find_part } = require('./find_part');

/** Our threshold, not a fact about appliances. Stated in the output, and overridable. */
const DEFAULT_RULE = { name: 'half of replacement', threshold: 0.5 };

/**
 * @param {object} q
 * @param {string} q.model
 * @param {string} [q.code]          the fault being considered
 * @param {string} [q.causeId]       the cause whose part would be bought
 * @param {number} [q.machineValue]  what a replacement costs, or what this one is worth. The number
 *                                   this tool cannot know and will not guess.
 * @param {number} [q.threshold]     override the rule of thumb
 */
function replace_or_repair({ model, code, causeId, machineValue, threshold } = {}) {
  if (!model) {
    return { answered: false, reason: 'Which machine? This needs a model number.' };
  }

  const rule = { ...DEFAULT_RULE, threshold: Number.isFinite(threshold) ? threshold : DEFAULT_RULE.threshold };

  /* ── what is known ──────────────────────────────────────────────────────── */

  const known = [];
  const missing = [];

  // 1. The history. Free, and the only one of the three this project always has.
  const repeats = recurring().filter((r) => r.model === model && (!code || r.code === code));
  const pattern = repeats[0] || null;

  if (pattern) {
    known.push(
      `${pattern.code} has come back ${pattern.times} times on this machine, the first ` +
      `${pattern.daysSinceFirst} days ago and the last ${pattern.daysSinceLast}` +
      (pattern.confirmedFixes
        ? `, with ${pattern.confirmedFixes} repair${pattern.confirmedFixes === 1 ? '' : 's'} confirmed as having worked at the time`
        : ', and no repair was ever confirmed as having worked')
    );
  }

  // 2. The repair cost, if a part is verified for this exact model.
  let repairCost = null;
  let repairIs = null;
  if (causeId) {
    const part = find_part({ model, causeId });
    // A part with no trustworthy price is a missing number, not a known one — treating it as known
    // would put a NaN through the share ratio below (NaN != null is true) and print "at NaN". The
    // same rule the checkout path holds: never a figure we cannot stand behind.
    if (part.found && typeof part.part.price === 'number' && Number.isFinite(part.part.price) && part.part.price > 0) {
      repairCost = part.part.price;
      repairIs = `${part.part.name}, ${part.part.price}`;
      known.push(`The part for that cause is ${part.part.name} at ${part.part.price}.`);
      known.push(`A service call instead would be ${part.alternative.price}.`);
    } else if (part.found) {
      missing.push(
        `What the repair costs. The part for that cause (${part.part.name}) is catalogued without a ` +
        'usable price, so this will not put a number on it.'
      );
    } else {
      missing.push(
        'What the repair costs. No part is verified against this exact model for that cause, and a ' +
        'part that only probably fits is not a price.'
      );
    }
  } else {
    missing.push('What the repair costs. Name the cause you would be fixing and this can be looked up.');
  }

  // 3. The one nobody here knows.
  const value = Number.isFinite(machineValue) && machineValue > 0 ? machineValue : null;
  if (!value) {
    missing.push(
      'What the machine is worth, or what replacing it costs. A service manual lists remedies and ' +
      'never prices, so this has to come from you — an age, a condition, what a used one goes for.'
    );
  }

  /* ── the comparison, only where both numbers exist ──────────────────────── */

  let comparison = null;
  if (repairCost != null && value) {
    const share = repairCost / value;
    comparison = {
      repairCost,
      machineValue: value,
      share: Number(share.toFixed(3)),
      rule,
      /*
       * `over` and `under` rather than `replace` and `repair`. The tool reports which side of a
       * stated line the arithmetic falls on; it does not tell somebody what to do with their money.
       */
      pastThreshold: share > rule.threshold,
      says: share > rule.threshold
        ? `The repair is ${Math.round(share * 100)}% of what the machine is worth, which is over the ${Math.round(rule.threshold * 100)}% line this tool draws.`
        : `The repair is ${Math.round(share * 100)}% of what the machine is worth, which is under the ${Math.round(rule.threshold * 100)}% line this tool draws.`,
    };
  }

  /*
   * A recurrence is worth saying out loud even when the money is unknown, because it is the one
   * finding here that does not depend on a price. It is still not a verdict: a fault that keeps
   * returning can mean a failing part, a wrong diagnosis, or an owner who keeps triggering the same
   * condition, and three timestamps cannot tell those apart.
   */
  const answered = Boolean(comparison) || Boolean(pattern);

  return {
    answered,
    model,
    code: code || null,
    known,
    missing,
    pattern,
    repair: repairIs,
    comparison,
    /*
     * Never "replace it". What is known, what is not, and whose decision it is — because the rest
     * of it involves things this tool has no access to: whether they can afford it this month,
     * whether the kitchen is being redone anyway, whether the machine was a gift.
     */
    verdict: null,
    note: missing.length
      ? 'This is what is known and what is not. The decision is yours, and it needs the missing figures above.'
      : 'This is what is known. The decision is yours.',
  };
}

module.exports = { replace_or_repair, DEFAULT_RULE };
