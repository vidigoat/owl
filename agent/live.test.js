/**
 * The live agent endpoint, without spending anything.
 *
 *   node agent/live.test.js
 *
 * The model is a script (as in alexa.test.js); the MCP server is this project's own, reached
 * in-process; the route is the real handler over real HTTP. What is tested is the part a stranger's
 * browser reaches: what it refuses, what it remembers between turns, and what it hands the screen.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// Its own household, always: another suite's recorded repair would make this conversation open
// with "This E24 is back", which is right for that house and not the one under test here.
process.env.HOME_STORE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live-')), 'home.json');

const live = require('./live');
const { Alexa } = require('./alexa');
const { McpClient, inProcess } = require('./mcp-client');

let passed = 0;
const it = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n       ', e.message);
    process.exitCode = 1;
  }
};

/** An Alexa whose "model" makes exactly these calls, one list per round. */
const scripted = (rounds) => () => {
  let i = 0;
  let n = 0;
  const converse = async () => {
    const step = rounds[i++] || [{ tool: 'speak', input: { text: 'Done.' } }];
    return {
      message: { role: 'assistant', content: step.map((s) => ({ toolUse: { toolUseId: `t${++n}`, name: s.tool, input: s.input || {} } })) },
      usage: { inputTokens: 10, outputTokens: 2 },
      cost: 0.0001,
    };
  };
  return new Alexa({ converse, client: new McpClient('in-process://mcp', { fetchImpl: inProcess() }) });
};

(async () => {
  console.log('the live agent endpoint');

  await it('it speaks the protocol to its own server in-process — handshake, tools, calls', async () => {
    const c = new McpClient('in-process://mcp', { fetchImpl: inProcess() });
    await c.connect();
    assert.equal(c.protocol, '2025-11-25');
    assert.ok(c.session, 'no session id');
    assert.ok(c.tools.some((t) => t.name === 'hypotheses'));
    const r = await c.call('hypotheses', { model: 'SHE3AR75UC', code: 'E24' });
    assert.equal(r.value.known, true);
  });

  await it('nothing said is a 400, and without credentials it says it will not pretend to talk', async () => {
    assert.equal((await live.turn({ said: '   ' })).status, 400);
    const r = await live.turn({ said: 'hello' }, { creds: null });
    assert.equal(r.status, 503);
    assert.match(r.body.reason, /will not pretend/);
  });

  await it('a conversation continues under its id, and the screen gets the last tool it can draw', async () => {
    const make = scripted([
      [{ tool: 'hypotheses', input: { model: 'SHE3AR75UC', code: 'E24' } }],
      [{ tool: 'next_test', input: {} }],
      [{ tool: 'speak', input: { text: 'Can you hear the pump humming?' } }],
      [{ tool: 'observe', input: { testId: 'pump-hum', value: 'silent' } }],
      [{ tool: 'speak', input: { text: 'It is the pump.' } }],
    ]);
    const a = await live.turn({ said: 'SHE3AR75UC, E24.' }, { make });
    assert.equal(a.status, 200);
    assert.equal(a.body.say, 'Can you hear the pump humming?');
    assert.equal(a.body.card.tool, 'next_test');
    assert.match(a.body.card.result.structuredContent.test.question, /pump humming/);
    assert.ok(a.body.steps.every((s) => !('result' in s)), 'raw tool results were sent as well as the card');

    const b = await live.turn({ conversation: a.body.conversation, said: "It's silent." }, { make });
    assert.equal(b.body.conversation, a.body.conversation, 'the second turn started a new conversation');
    assert.equal(b.body.card.tool, 'observe');
    assert.deepEqual(b.body.card.result.structuredContent.space.map((c) => c.id), ['pump']);
    assert.equal(b.body.turn, 2);
  });

  await it('a conversation has a turn limit, and says so in words', async () => {
    const make = scripted([]);
    let r = await live.turn({ said: 'one' }, { make });
    const id = r.body.conversation;
    for (let i = 1; i < live.MAX_TURNS; i++) r = await live.turn({ conversation: id, said: 'again' }, { make });
    assert.equal(r.status, 200);
    r = await live.turn({ conversation: id, said: 'and again' }, { make });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /turns/);
  });

  await it('the route takes turns only from this site\'s own pages', async () => {
    const { handler } = require('../server');
    const srv = http.createServer(handler);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const get = await (await fetch(`${base}/api/alexa`)).json();
      assert.equal(typeof get.available, 'boolean');
      const post = (headers) => fetch(`${base}/api/alexa`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ said: 'hi' }) });
      assert.equal((await post({})).status, 403, 'a request with no page behind it was taken');
      assert.equal((await post({ origin: 'https://elsewhere.example' })).status, 403, 'another site could spend on this one');
      const bad = await fetch(`${base}/api/alexa`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{nope' });
      assert.equal(bad.status, 400);
      // Too long is answered in words — it used to be a reset connection, which a page reads as
      // "the network is down" rather than "say less".
      const big = await fetch(`${base}/api/alexa`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ said: 'x'.repeat(50_000) }) });
      assert.equal(big.status, 413);
      assert.match((await big.json()).error, /Too long/);
      const mcp = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1_200_000) });
      assert.equal(mcp.status, 413);
    } finally {
      srv.close();
    }
  });

  await it('the client\'s own note to the model is never drawn as the card', async () => {
    const make = scripted([
      [{ tool: 'verify_diagnosis', input: { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: ['filter', 'hose'] } }],
      [{ tool: 'guide', input: { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' } }],
      [{ tool: 'speak', input: { text: 'It is the drain pump. Shall I order one?' } }],
    ]);
    // The person names the machine: the client lets a model number through only if somebody said it.
    const r = await live.turn({ said: "My SHE3AR75UC shows E24, and the pump is silent." }, { make });
    // Recorded footage showed "No procedure on record" here: the held-back guide call, drawn.
    assert.equal(r.body.card.tool, 'verify_diagnosis');
    assert.equal(r.body.card.result.structuredContent.upheld, true);
  });

  console.log(`\n${passed} passed`);
})();
