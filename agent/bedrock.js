/**
 * Bedrock Converse, with tools, and nothing installed.
 *
 * The one call the agent makes: a conversation so far, the tools it may use, and the model's next
 * move — either words for the person, or a request to call a tool. Signed by `agent/sigv4.js`,
 * metered by `mcp/budget.js` before it is made, and priced from the numbers AWS publishes rather
 * than from a guess.
 */

const { sign, credentials } = require('./sigv4');
const { Budget } = require('../mcp/budget');

/**
 * Per million tokens, on-demand, us-east-1 — from the AWS Price List API
 * (offers/v1.0/aws/AmazonBedrock, retrieved 2026-09-23), not from memory. A price nobody can trace
 * is a price somebody eventually has to apologise for.
 */
const PRICES = {
  'us.amazon.nova-2-lite-v1:0': { in: 0.33, out: 2.75 },
  'us.amazon.nova-lite-v1:0': { in: 0.06, out: 0.24 },
  'us.amazon.nova-pro-v1:0': { in: 0.8, out: 3.2 },
};

const DEFAULT_MODEL = process.env.HANDS_AGENT_MODEL || 'us.amazon.nova-2-lite-v1:0';
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

const costOf = (model, usage = {}) => {
  const p = PRICES[model];
  if (!p) return null; // unpriced is unknown, and unknown is never zero
  return ((usage.inputTokens || 0) * p.in + (usage.outputTokens || 0) * p.out) / 1e6;
};

/**
 * One Converse call.
 *
 * @param {object} req  { messages, system, tools, maxTokens, model }
 * @returns {{ message, stopReason, usage, cost, model }}
 */
async function converse(
  { messages, system, tools, toolChoice, maxTokens = 700, model = DEFAULT_MODEL, temperature = 0.2 },
  { creds = credentials(), fetchImpl = globalThis.fetch, budget = new Budget(), region = REGION } = {}
) {
  if (!creds) {
    const e = new Error(
      'No AWS credentials. Set AWS_PROFILE to a profile with static keys (this project uses ' +
        '`bedrock`), or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.'
    );
    e.code = 'NO_CREDENTIALS';
    throw e;
  }

  const body = JSON.stringify({
    messages,
    ...(system ? { system: [{ text: system }] } : {}),
    ...(tools?.length ? { toolConfig: { tools, ...(toolChoice ? { toolChoice } : {}) } } : {}),
    inferenceConfig: { maxTokens, temperature },
  });

  // Pre-flight: refuse a call that COULD take the ledger past its ceiling, before it is made.
  const price = PRICES[model] || PRICES['us.amazon.nova-pro-v1:0'];
  const couldIn = Math.ceil(body.length / 3);
  const could = (couldIn * price.in + maxTokens * price.out) / 1e6;
  const { spent } = budget.read();
  if (spent + could > budget.ceiling) {
    const e = new Error(
      `Budget stop: this turn could cost up to $${could.toFixed(5)} and $${spent.toFixed(4)} of the ` +
        `$${budget.ceiling.toFixed(2)} ceiling is spent. Nothing was called.`
    );
    e.code = 'BUDGET';
    throw e;
  }

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;
  const { headers } = sign(
    { method: 'POST', url, headers: { 'content-type': 'application/json', accept: 'application/json' }, body },
    creds,
    { region, service: 'bedrock' }
  );

  const res = await fetchImpl(url, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) {
    const e = new Error(`bedrock ${res.status}: ${text.slice(0, 300)}`);
    e.status = res.status;
    throw e;
  }
  const out = JSON.parse(text);
  const cost = costOf(model, out.usage);
  budget.record(cost ?? could, { tool: `agent:${model}` });

  return { message: out.output?.message, stopReason: out.stopReason, usage: out.usage || {}, cost, model };
}

module.exports = { converse, costOf, PRICES, DEFAULT_MODEL };
