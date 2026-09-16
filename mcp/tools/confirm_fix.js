/**
 * tool: confirm_fix
 *
 * After the repair, look at the panel again and decide whether the fault actually cleared.
 *
 * This is the shortest tool in the project and the one that changes how it feels to use. Everything
 * else in a repair app ends at "try this" — the machine is left to tell you whether it worked. Here
 * the assistant goes and checks, and is willing to come back and say it did not work.
 *
 * The bar is deliberately high: the fault is only "cleared" if the read was real and no code is
 * showing. A simulated read can never confirm anything, because confirming a repair you did not
 * actually observe is the same class of lie as inventing a diagnosis.
 */

const { see } = require('./see');

/**
 * How sure the reader has to be before this says a repair worked.
 *
 * Deliberately only applied to CONFIRMING. A poor read that still shows the original fault code is
 * perfectly good evidence the repair did not work — the asymmetry is the point, because one of
 * those answers sends someone away satisfied and the other sends them back to look.
 */
const CONFIRM_FLOOR = 0.4;

async function confirm_fix({ imagePath, code, expect = {} }) {
  const read = await see({ imagePath, expect });

  if (read.simulated) {
    return {
      confirmed: false,
      unknown: true,
      simulated: true,
      reason: 'I could not actually look at the panel, so I cannot tell you the fault cleared.',
      detail: read.reason,
    };
  }

  if (!read.ok) {
    return {
      confirmed: false,
      unknown: true,
      simulated: false,
      reason: 'I looked, but could not read the panel clearly enough to be sure.',
      detail: read.reason,
    };
  }

  // Still showing the same code: the repair did not work, and saying so is the point.
  if (read.code && code && read.code.toUpperCase() === String(code).toUpperCase()) {
    return {
      confirmed: false,
      unknown: false,
      stillFaulty: true,
      code: read.code,
      reason: `Still showing ${read.code}. That did not fix it.`,
    };
  }

  // A different code appeared — do not report success, and do not pretend to understand it yet.
  if (read.code && (!code || read.code.toUpperCase() !== String(code).toUpperCase())) {
    return {
      confirmed: false,
      unknown: false,
      newFault: true,
      code: read.code,
      reason: `The original fault is gone, but it is now showing ${read.code}. That is a different problem.`,
    };
  }

  // Confirming a repair is the one claim here that stops a person looking further, so it needs a
  // read worth relying on. A blank display read at 0.1 confidence is not evidence that a fault
  // cleared — it is evidence that we could not see properly, and those are opposite things.
  if (typeof read.confidence === 'number' && read.confidence < CONFIRM_FLOOR) {
    return {
      confirmed: false,
      unknown: true,
      code: null,
      confidence: read.confidence,
      reason: `I can't see the panel well enough to tell you it cleared (confidence ${read.confidence}).`,
      note: 'Absence of a code in a poor read is not the same as absence of a fault.',
    };
  }

  return {
    confirmed: true,
    unknown: false,
    code: null,
    reason: 'No fault code showing.',
    confidence: read.confidence ?? null,
  };
}

module.exports = { name: 'confirm_fix', confirm_fix, CONFIRM_FLOOR };
