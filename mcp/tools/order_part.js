/**
 * tool: order_part  —  checkout, in conversation.
 *
 * Alexa+ add-ons can take payment in the conversation: the wallet supplies the payment credential,
 * and the merchant stays the authority on cart, pricing, tax and fulfilment. So this file owns the
 * money and never derives a price from anything the assistant said.
 *
 * Two rules, both of which exist because this is the point where a voice assistant can quietly
 * cost someone real money:
 *
 *   1. Nothing is ordered for a cause the gate did not uphold. A purchase is the end of a chain of
 *      reasoning, and if any link was refused there is no purchase.
 *   2. The total is always stated before confirmation, itemised, including what it replaces. "Yes"
 *      has to be an answer to a specific number, not to a vibe.
 */

const { find_part } = require('./find_part');
const { verify_diagnosis } = require('./verify_diagnosis');

const TAX_RATE = 0.0875; // stand-in until a real tax service is wired in
const SHIPPING = 0;      // the demo part ships free next day

const sessions = new Map();
let counter = 0;

const money = (n) => Number(n.toFixed(2));

/**
 * Open a checkout. Returns what the person is about to agree to, in full, and a session id.
 * It does not charge anything — `confirm` does that, and only with the session id.
 */
function beginCheckout({ model, code, causeId, ruledOut = [] }) {
  const verdict = verify_diagnosis({ model, code, causeId, ruledOut });
  if (verdict.abstain) {
    return {
      ok: false,
      refused: true,
      reason: `Not ordering anything: ${verdict.reason}`,
      escalate: verdict.escalate,
    };
  }
  if (!verdict.maySpend) {
    return {
      ok: false,
      refused: true,
      // Say which of the two it is. Reporting an unknown cost as a free repair is the same lie as
      // reporting an unobserved run as a quiet one.
      reason: verdict.costKnown
        ? 'That cause costs nothing to fix. There is no part to buy.'
        : `I have no parts data for this machine, so I cannot tell you what this costs or sell you anything for it. ${verdict.cause?.label ? `The fix is: ${verdict.cause.label}.` : ''}`.trim(),
    };
  }

  const found = find_part({ model, causeId });
  if (!found.found) {
    return { ok: false, refused: true, reason: found.reason, alternative: found.alternative };
  }

  const subtotal = found.part.price;
  const tax = money(subtotal * TAX_RATE);
  const total = money(subtotal + tax + SHIPPING);
  const id = `chk_${++counter}_${Date.now().toString(36)}`;

  sessions.set(id, { id, model, causeId, part: found.part, subtotal, tax, total, state: 'awaiting_confirmation' });

  return {
    ok: true,
    sessionId: id,
    // Everything said out loud before the word "yes" means anything.
    lineItems: [{ title: found.part.name, fitsModel: found.part.fitsModel, price: money(subtotal) }],
    totals: { subtotal: money(subtotal), tax, shipping: SHIPPING, total },
    eta: found.part.eta,
    insteadOf: found.alternative,
    saving: money(found.alternative.price - total),
    say: `${found.part.name} for your ${model}, ${money(subtotal)} plus ${tax} tax — ${total} in total, here ${found.part.eta.toLowerCase()}. A service call would be about ${found.alternative.price}. Order it?`,
  };
}

/**
 * Complete it. Requires the session, so a confirmation can never be applied to a cart the person
 * was not read. The wallet handler is recorded because the caller has to know which credential
 * type was used.
 */
function confirmCheckout({ sessionId, handler = 'amazon_pay_network_token' }) {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, reason: 'No such checkout. Nothing was charged.' };
  if (session.state === 'complete') return { ok: false, reason: 'That order was already placed.', order: session.order };

  session.state = 'complete';
  session.order = {
    orderId: `ord_${sessionId.slice(4)}`,
    total: session.total,
    part: session.part.name,
    fitsModel: session.part.fitsModel,
    eta: session.part.eta,
    handler_id: handler,
    placedAt: new Date().toISOString(),
  };

  return { ok: true, order: session.order, say: `Ordered. ${session.part.name}, arriving ${session.part.eta.toLowerCase()}.` };
}

/** Nothing ordered, nothing owed. */
function cancelCheckout({ sessionId }) {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, reason: 'No such checkout.' };
  if (session.state === 'complete') return { ok: false, reason: 'That order was already placed — cancel it in your orders.' };
  sessions.delete(sessionId);
  return { ok: true, say: 'Cancelled. Nothing ordered.' };
}

module.exports = { name: 'order_part', beginCheckout, confirmCheckout, cancelCheckout, TAX_RATE };
