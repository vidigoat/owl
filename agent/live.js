/**
 * The live agent, for a page to talk to: POST /api/alexa.
 *
 * A conversation is an Alexa (agent/alexa.js) kept in memory under an id the page holds. Each turn
 * is one person's line in and one spoken line out, with the tool calls behind it and — when the
 * last tool it called is one the card can draw — that tool's result, so the page can put the real
 * MCP App card next to the words.
 *
 * It spends money, so it is bounded three ways before anything is called:
 *   - it runs only where AWS credentials are, and says so plainly where they are not;
 *   - every Bedrock call goes through a ledger whose ceiling refuses a call that COULD exceed it —
 *     on a deployment, mcp/shared-budget.js, one ledger for every instance; a deployment with
 *     credentials and no shared ledger refuses to talk, because a per-instance file ledger there is
 *     a ceiling that multiplies with traffic;
 *   - a conversation is capped in turns, and the number of live conversations is capped.
 */

const crypto = require('node:crypto');
const { Alexa } = require('./alexa');
const { McpClient, inProcess } = require('./mcp-client');
const { credentials } = require('./sigv4');
const { APP_TOOLS } = require('../mcp/cards');
const { deploymentLedger } = require('../mcp/shared-budget');

const MAX_CONVERSATIONS = 40;
const MAX_TURNS = 16;
const IDLE_MS = 30 * 60 * 1000;

const conversations = new Map();

// Where the ledger lives: mcp/shared-budget.js, so the tools can apply the same rule.
const ledger = deploymentLedger;

function available(creds = credentials(), env = process.env) {
  if (!creds) return { available: false, reason: 'The live agent runs where AWS credentials for Bedrock are. This deployment has none, so it will not pretend to talk.' };
  if (ledger(creds, env) === null) return { available: false, reason: 'This deployment has AWS credentials but no shared spend ledger, and a ceiling kept per instance is no ceiling. It will not talk until HANDS_LEDGER_TABLE is set.' };
  return { available: true };
}

function sweep(now = Date.now()) {
  for (const [id, c] of conversations) if (now - c.last > IDLE_MS) conversations.delete(id);
}

/**
 * @param {{ conversation?: string, said: string }} body
 * @param {{ make?: () => Alexa }} [deps]  a test supplies its own agent
 */
async function turn({ conversation, said } = {}, { make, creds } = {}) {
  const text = typeof said === 'string' ? said.trim().slice(0, 500) : '';
  if (!text) return { status: 400, body: { error: 'Say something — `said` is empty.' } };

  if (!make) {
    const a = creds === undefined ? available() : available(creds);
    if (!a.available) return { status: 503, body: a };
  }

  sweep();
  let id = typeof conversation === 'string' && conversations.has(conversation) ? conversation : null;
  if (!id) {
    if (conversations.size >= MAX_CONVERSATIONS) {
      return { status: 429, body: { error: 'Too many conversations at once. Try again in a few minutes.' } };
    }
    id = crypto.randomUUID();
    const budget = make ? undefined : ledger(creds === undefined ? credentials() : creds);
    const alexa = make ? make() : new Alexa({
      client: new McpClient('in-process://mcp', { fetchImpl: inProcess() }),
      ...(budget ? { converseOpts: { budget } } : {}),
    });
    conversations.set(id, { alexa, turns: 0, last: Date.now() });
  }

  const c = conversations.get(id);
  if (c.turns >= MAX_TURNS) {
    return { status: 429, body: { conversation: id, error: `This conversation has had its ${MAX_TURNS} turns. Start a new one.` } };
  }
  c.turns++;
  c.last = Date.now();

  let r;
  try {
    r = await c.alexa.turn(text);
  } catch (e) {
    // A budget stop is an answer, in words; anything else is reported without its internals.
    const budget = e.code === 'BUDGET';
    return { status: budget ? 402 : 502, body: { conversation: id, error: budget ? e.message : 'The model could not be reached. Nothing was spent on this turn.' } };
  }

  const shown = r.steps.filter((s) => !s.private);
  // Never a card for the client's own answer: "tell them about the part first" is a note to the
  // model, and recorded footage showed it on the screen as "No procedure on record".
  const last = [...shown].reverse().find((s) => APP_TOOLS.has(s.tool) && s.result && typeof s.result === 'object' && s.result.answeredBy !== 'client');
  return {
    status: 200,
    body: {
      conversation: id,
      say: r.say,
      waitingFor: r.waitingFor,
      steps: shown.map(({ tool, asked, filled, answer, isError }) => ({ tool, asked, filled, answer, isError })),
      card: last ? { tool: last.tool, result: { structuredContent: last.result } } : null,
      cost: r.cost,
      total: c.alexa.cost,
      turn: c.turns,
      model: c.alexa.model,
    },
  };
}

module.exports = { turn, available, ledger, conversations, MAX_TURNS, MAX_CONVERSATIONS };
