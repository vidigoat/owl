/**
 * A ceiling on what this project can spend of somebody's AWS bill.
 *
 * Every vision call here — reading a panel, reading a rating plate, transcribing a manual page,
 * confirming a repair afterwards — is a real Bedrock invocation against a real account. There was
 * nothing stopping it. A loop in a demo, a stuck retry, or a browser tab left refreshing would have
 * billed until somebody noticed on a statement.
 *
 * That matters more here than in most projects, for two reasons. The account this runs against is
 * the owner's PRODUCTION account — a separate IAM user isolates permissions, not billing — and the
 * whole product is a machine that refuses to spend your money without being sure. A repair copilot
 * with a hard rule about not guessing with your money, quietly spending its owner's, is the kind of
 * irony that belongs in the friction log rather than in the code.
 *
 * Modelled directly on the sibling project's `judge/budget.js`, and deliberately so — the three
 * properties are the same and were arrived at the hard way there:
 *
 *   PERSISTENT    on disk, because a crashed run, a second terminal or a restarted loop each starts
 *                 a fresh process, and a fresh process with an in-memory counter spends it all again
 *   PRE-FLIGHT    refuses a call that COULD exceed the ceiling, not one that already did
 *   FAILS CLOSED  a ledger it cannot read means stop, never "assume nothing has been spent"
 *
 * That last one inverts the instinct everywhere else in this codebase, where a broken cache or a
 * missing file degrades to a slower path. Here it degrades to no path, because the thing being
 * guarded against is money nobody meant to spend.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Nova Lite, per million tokens, from the published price list.
 *
 * Images are charged as tokens too; a photograph lands in the low thousands. The estimate below is
 * deliberately generous, because the question a ceiling answers is "could this take me past the
 * line" and a guess that runs low answers it wrong in the expensive direction.
 */
const NOVA_LITE = { in: 0.06, out: 0.24 };

/** A photograph, over-counted. A 20 MB image is nowhere near this many tokens. */
const IMAGE_TOKENS = 3000;

/**
 * Low on purpose. A full `npm run eval` is about a dozen reads and costs well under a cent, so this
 * is roughly a hundred evals before anything stops. Raise it deliberately, once, with
 * HANDS_BUDGET_USD — never by editing this line in passing.
 */
const DEFAULT_CEILING_USD = 0.50;

const LEDGER =
  process.env.HANDS_LEDGER ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'second-set-of-hands', 'spend.json');

/** The most one vision call could cost, before it is made. */
function worstCase({ promptChars = 4000, maxTokens = 600, images = 1 } = {}) {
  const promptTokens = Math.ceil(promptChars / 3) + images * IMAGE_TOKENS;
  return (promptTokens * NOVA_LITE.in + maxTokens * NOVA_LITE.out) / 1e6;
}

class Budget {
  constructor({ ceiling = Number(process.env.HANDS_BUDGET_USD) || DEFAULT_CEILING_USD, file = LEDGER } = {}) {
    this.ceiling = ceiling;
    this.file = file;
  }

  read() {
    try {
      const l = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof l.spent !== 'number' || !Number.isFinite(l.spent) || l.spent < 0) {
        throw new Error('ledger is not a number');
      }
      return { spent: l.spent, calls: l.calls || 0, since: l.since || 'unknown' };
    } catch (e) {
      if (e.code === 'ENOENT') return { spent: 0, calls: 0, since: new Date().toISOString() };
      throw new Error(
        `Cannot read the spend ledger at ${this.file} (${e.message}). Refusing to call Bedrock ` +
          'rather than assume nothing has been spent. Delete the file to start a fresh ledger.'
      );
    }
  }

  /** May this call be made? Throws with something a caller can act on if not. */
  check({ label = 'a vision call', ...shape } = {}) {
    const { spent } = this.read();
    const could = worstCase(shape);
    if (spent + could > this.ceiling) {
      throw new Error(
        `Budget stop: ${label} could cost up to $${could.toFixed(6)}, and $${spent.toFixed(4)} of ` +
          `the $${this.ceiling.toFixed(2)} ceiling is already spent.\n` +
          `  Nothing was called. Raise it deliberately with HANDS_BUDGET_USD=<amount>, or reset the ` +
          `ledger at ${this.file}.`
      );
    }
    return { spent, could, remaining: this.ceiling - spent };
  }

  /** Record what a call cost. Written before the caller is told it succeeded. */
  record(costUsd, { tool = 'unknown' } = {}) {
    const before = this.read();
    const entry = {
      spent: Number((before.spent + (Number(costUsd) || 0)).toFixed(8)),
      calls: before.calls + 1,
      since: before.since,
      lastTool: tool,
      lastAt: new Date().toISOString(),
      ceiling: this.ceiling,
    };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(entry, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      // A spend that happened and was not recorded is the one state this must not leave behind:
      // the next process would believe the money is still there.
      throw new Error(
        `Spent $${costUsd} but could not record it to ${this.file} (${e.message}). Stopping, ` +
          'because the next run would believe that money is still available.'
      );
    }
    return entry;
  }

  /** What a call actually cost, from the usage Bedrock reports. Unknown usage costs 0, never NaN. */
  costOf(usage) {
    // `= {}` would not have been enough: a default fires on `undefined` only, and Bedrock returns
    // `usage: null` when it has nothing to report. That crashed rather than costing zero, and a
    // throw in the cost path fails a call that had already succeeded and already been billed.
    const u = usage || {};
    const inTok = Number(u.inputTokens ?? u.input_tokens ?? 0) || 0;
    const outTok = Number(u.outputTokens ?? u.output_tokens ?? 0) || 0;
    return Number(((inTok * NOVA_LITE.in + outTok * NOVA_LITE.out) / 1e6).toFixed(8));
  }

  reset() {
    fs.rmSync(this.file, { force: true });
  }

  summary() {
    const { spent, calls } = this.read();
    return `$${spent.toFixed(4)} of $${this.ceiling.toFixed(2)} spent across ${calls} call${calls === 1 ? '' : 's'}`;
  }
}

module.exports = { Budget, worstCase, NOVA_LITE, DEFAULT_CEILING_USD, LEDGER };
