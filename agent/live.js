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
 *   - every Bedrock call goes through mcp/budget.js, whose ceiling refuses a call that COULD
 *     exceed it;
 *   - a conversation is capped in turns, and the number of live conversations is capped.
 */

const crypto = require('node:crypto');
const { Alexa } = require('./alexa');
const { McpClient, inProcess } = require('./mcp-client');
const { credentials } = require('./sigv4');
const { APP_TOOLS } = require('../mcp/cards');

const MAX_CONVERSATIONS = 40;
const MAX_TURNS = 16;
const IDLE_MS = 30 * 60 * 1000;

const conversations = new Map();

function available(creds = credentials()) {
  return creds
    ? { available: true }
    : { available: false, reason: 'The live agent runs where AWS credentials for Bedrock are. This deployment has none, so it will not pretend to talk.' };
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
    const alexa = make ? make() : new Alexa({ client: new McpClient('in-process://mcp', { fetchImpl: inProcess() }) });
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
  const last = [...shown].reverse().find((s) => APP_TOOLS.has(s.tool) && s.result && typeof s.result === 'object');
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

module.exports = { turn, available, conversations, MAX_TURNS, MAX_CONVERSATIONS };
