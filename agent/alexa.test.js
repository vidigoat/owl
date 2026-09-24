/**
 * The simulated Alexa+, without spending anything.
 *
 *   node agent/alexa.test.js
 *
 * The model is replaced by a script — a list of the tool calls a model would make — and everything
 * else is real: the MCP server is started, the client connects to it over HTTP and does the
 * handshake, and every tool call crosses the wire. What is being tested is the part that is ours,
 * the client between a model and the tools, and every property here is one a live run showed was
 * needed:
 *
 *   speech is a tool call       a live run read Nova's chain of thought out as speech
 *   the checks stay client-side a live run picked its question off a list instead of next_test
 *   state is threaded, visibly  a model asked to copy the hypothesis space will eventually drop a cause
 *   a fix is not confirmed      a live run recorded an ordered pump as fitted and verified
 *   money stays behind the gate the agent may ask for a cart; only an upheld diagnosis gets one
 *
 * The live half — does Nova actually behave — is `npm run alexa`, which costs about two cents for a
 * whole repair and prints every tool call it made.
 */

const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// A throwaway household, before anything that writes one is loaded.
process.env.HOME_STORE = process.env.HOME_STORE || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-')), 'home.json');

const { Alexa, SYSTEM, AGENT_TOOLS, toBedrockTool, spoken } = require('./alexa');
const { serveMcp, TOOLS } = require('../mcp/server');

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

/**
 * A model that makes exactly the calls it is told to.
 *
 * Each entry is one assistant message: tool calls and, optionally, some text. It also records what
 * it was SHOWN each round, which is how the tests check what the client hid from it.
 */
function scripted(rounds) {
  const shown = [];
  let i = 0;
  let n = 0;
  const converse = async ({ messages, tools, toolChoice }) => {
    shown.push({ messages: JSON.parse(JSON.stringify(messages)), tools: tools.map((t) => t.toolSpec.name), toolChoice });
    const step = rounds[i++] || [{ tool: 'speak', input: { text: '(script ran out)' } }];
    const content = [];
    for (const s of step) {
      if (s.text) content.push({ text: s.text });
      if (s.tool) content.push({ toolUse: { toolUseId: `t${++n}`, name: s.tool, input: s.input || {} } });
    }
    return { message: { role: 'assistant', content }, stopReason: 'tool_use', usage: { inputTokens: 100, outputTokens: 10 }, cost: 0.0001 };
  };
  return { converse, shown };
}

const withServer = async (fn) => {
  const srv = http.createServer((req, res) => serveMcp(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${srv.address().port}/mcp`);
  } finally {
    srv.close();
  }
};

(async () => {
  console.log('the simulated Alexa+');

  await it('it reaches the tools over MCP — handshake, tool list, calls — not by importing them', async () => {
    await withServer(async (url) => {
      const { converse } = scripted([[{ tool: 'speak', input: { text: 'Hello.' } }]]);
      const a = new Alexa({ url, converse });
      await a.connect();
      assert.ok(a.client.session, 'no MCP session was established');
      assert.equal(a.client.protocol, '2025-11-25');
      assert.ok(a.tools.some((t) => t.toolSpec.name === 'hypotheses'));
    });
  });

  await it('the person hears only what was passed to speak — never the model\'s reasoning', async () => {
    await withServer(async (url) => {
      const { converse, shown } = scripted([
        [{ text: "Okay, let's see. The user has a Bosch dishwasher and I think…", tool: 'speak', input: { text: 'Which model is it?' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('My dishwasher is broken.');
      assert.equal(r.say, 'Which model is it?');
      assert.doesNotMatch(r.say, /let's see/);
      assert.deepEqual(shown[0].toolChoice, { any: {} }, 'every response is not forced to be a tool call');
    });
  });

  await it('a call the server refuses as malformed comes back to the model in words, and the turn goes on', async () => {
    await withServer(async (url) => {
      const { converse, shown } = scripted([
        [{ tool: 'diagnose', input: { model: 'SHE3AR75UC' } }],
        [{ tool: 'speak', input: { text: 'What code is on the panel?' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('My SHE3AR75UC is showing a code.');
      assert.equal(r.say, 'What code is on the panel?');
      const toolResult = JSON.stringify(shown[1].messages);
      assert.match(toolResult, /diagnose needs code/, 'the model was not told what was missing');
      assert.ok(r.steps.find((x) => x.tool === 'diagnose').isError, 'the step was not marked as an error');
    });
  });

  await it('the prompt tells it not to call a repair saved when it was only kept for this conversation', () => {
    assert.match(SYSTEM, /kept for this conversation only, say exactly that/);
  });

  await it('it is given the tools its job needs — and not the shortcut past the check', async () => {
    const names = TOOLS.filter((t) => AGENT_TOOLS.has(t.name)).map((t) => t.name);
    assert.ok(names.includes('next_test') && names.includes('hypotheses'));
    assert.ok(!AGENT_TOOLS.has('diagnose'), 'diagnose let a live run skip the five-second check');
    assert.ok(!AGENT_TOOLS.has('read_manual'), 'learning a machine is the bench\'s job');
    for (const t of TOOLS.filter((t) => AGENT_TOOLS.has(t.name))) assert.ok(toBedrockTool(t).toolSpec.inputSchema.json.type === 'object');
  });

  await it('the checks stay with the client, so the model has to ask next_test which one to use', async () => {
    await withServer(async (url) => {
      const { converse, shown } = scripted([
        [{ tool: 'hypotheses', input: { model: 'SHE3AR75UC', code: 'E24' } }],
        [{ tool: 'next_test', input: {} }],
        [{ tool: 'speak', input: { text: 'Can you hear the pump humming?', waitingFor: 'their answer' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('My SHE3AR75UC shows E24.');

      const shownHypotheses = JSON.stringify(shown[1].messages[shown[1].messages.length - 1]);
      assert.doesNotMatch(shownHypotheses, /Can you hear the pump humming/, 'the model was shown the checks and could pick one itself');
      assert.match(shownHypotheses, /call next_test/);

      const nt = r.steps.find((s) => s.tool === 'next_test');
      assert.ok(nt.filled.includes('tests') && nt.filled.includes('space'), `the client did not thread the state: ${nt.filled}`);
      assert.match(nt.answer, /pump humming/);
      assert.equal(r.waitingFor, 'their answer');
    });
  });

  await it('an answer folds in by name, and the ruled-out causes follow into verify and checkout', async () => {
    await withServer(async (url) => {
      const { converse } = scripted([
        [{ tool: 'hypotheses', input: { model: 'SHE3AR75UC', code: 'E24' } }],
        [{ tool: 'next_test', input: {} }],
        [{ tool: 'speak', input: { text: 'Can you hear it?' } }],
        [{ tool: 'observe', input: { testId: 'pump-hum', value: 'silent' } }],
        [{ tool: 'verify_diagnosis', input: { causeId: 'pump' } }],
        [{ tool: 'speak', input: { text: 'It is the pump.' } }],
      ]);
      const a = new Alexa({ url, converse });
      await a.turn('SHE3AR75UC, E24.');
      const r = await a.turn('It is silent.');

      const ob = r.steps.find((s) => s.tool === 'observe');
      assert.match(ob.answer, /left: Failed drain pump$/);
      assert.deepEqual(a.memory.ruledOut.sort(), ['filter', 'hose']);
      const v = r.steps.find((s) => s.tool === 'verify_diagnosis');
      assert.ok(v.filled.includes('ruledOut'), 'the causes the person ruled out were not passed to the gate');
      assert.match(v.answer, /UPHELD/);
    });
  });

  await it('it cannot buy what the gate did not uphold, whatever it asks for', async () => {
    await withServer(async (url) => {
      const { converse } = scripted([
        [{ tool: 'begin_checkout', input: { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', upheld: true, force: true } }],
        [{ tool: 'speak', input: { text: 'Ordering.' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('Just buy me a pump.');
      const c = r.steps.find((s) => s.tool === 'begin_checkout');
      assert.match(c.answer, /refused/, `a cart opened for a cause nobody established: ${c.answer}`);
    });
  });

  await it('an ordered part is not recorded as a verified fix', async () => {
    /*
     * A live run ordered a pump and, in the same turn, wrote "Replaced the pump · confirmed: true".
     * The client downgrades `confirmed` unless confirm_fix actually saw the fault clear, and says so
     * in the trace.
     */
    await withServer(async (url) => {
      const { converse } = scripted([
        [{ tool: 'remember_repair', input: { model: 'SHE3AR75UC', code: 'E24', cause: 'Failed drain pump', action: 'Replaced the pump', confirmed: true } }],
        [{ tool: 'speak', input: { text: 'Noted.' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('Thanks.');
      const m = r.steps.find((s) => s.tool === 'remember_repair');
      assert.ok(m.filled.some((f) => f.startsWith('confirmed=false')), 'a fix nobody saw work was recorded as confirmed');
      const store = JSON.parse(fs.readFileSync(process.env.HOME_STORE, 'utf8'));
      assert.equal(store.receipts.at(-1).confirmed, false);
    });
  });

  await it('a photo is attached by the client when the model asks to look, never passed as a path', async () => {
    const see = TOOLS.find((t) => t.name === 'see');
    const spec = toBedrockTool(see).toolSpec.inputSchema.json;
    assert.ok(!('imagePath' in spec.properties), 'the model is offered a server file path to fill in');
    assert.ok(!('imageBase64' in spec.properties));
    assert.ok('usePhoto' in spec.properties);

    const a = new Alexa({ url: 'http://unused.invalid/mcp' });
    a.memory.photo = 'BASE64';
    const { args, filled } = a.prepare('see', { usePhoto: true });
    assert.equal(args.imageBase64, 'BASE64');
    assert.ok(!('usePhoto' in args));
    assert.ok(filled.some((f) => f.startsWith('imageBase64')));
  });

  await it('it never loops forever: a model that will not stop calling tools is cut off politely', async () => {
    await withServer(async (url) => {
      const { converse } = scripted(Array.from({ length: 20 }, () => [{ tool: 'whats_due', input: {} }]));
      const a = new Alexa({ url, converse });
      const r = await a.turn('What needs doing?');
      assert.ok(r.rounds <= 9);
      assert.match(r.say, /round in circles/);
    });
  });

  await it('the prompt says the things that make it safe, in words', () => {
    assert.match(SYSTEM, /ONLY by calling speak/);
    assert.match(SYSTEM, /ALWAYS call hypotheses first, then next_test/);
    assert.match(SYSTEM, /An ordered part is not a repair/);
    assert.match(SYSTEM, /mains/);
    assert.equal(spoken([{ text: '<thinking>x</thinking>Hi.' }]), 'Hi.');
  });

  await it('asked to look with nothing shown, the client says so — the server is never sent an empty image', async () => {
    await withServer(async (url) => {
      const { converse, shown } = scripted([
        [{ tool: 'see', input: { usePhoto: true } }],
        [{ tool: 'speak', input: { text: 'Can you hold the panel up?' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('What is it showing?');
      // Not offered at all with nothing to point it at — a live run asked for the panel from
      // somebody who had just read the code out.
      assert.ok(!shown[0].tools.includes('see'), 'a tool that looks was offered with no photo');
      await a.turn('Here.', { photo: 'BASE64' });
      assert.ok(shown.at(-1).tools.includes('see'), 'a photo arrived and the tool to look at it did not');
      const s = r.steps.find((x) => x.tool === 'see');
      assert.match(s.answer, /Nothing has been shown/);
      assert.doesNotMatch(s.answer, /undefined/);
    });
  });

  await it('an order is placed only on a later turn, after its total was actually said', async () => {
    const CART = { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: ['filter', 'hose'] };
    await withServer(async (url) => {
      // Opened and confirmed in one breath — what a live eval run did. Refused; nothing charged.
      let { converse } = scripted([
        [{ tool: 'begin_checkout', input: CART }],
        [{ tool: 'confirm_checkout', input: {} }],
        [{ tool: 'speak', input: { text: 'Ordered.' } }],
      ]);
      let a = new Alexa({ url, converse });
      let r = await a.turn('Yes, order it.');
      assert.match(r.steps.find((s) => s.tool === 'confirm_checkout').answer, /held by the client/);

      // Read out WITHOUT the total, then a yes. Still refused: they never heard what it costs.
      ({ converse } = scripted([
        [{ tool: 'begin_checkout', input: CART }],
        [{ tool: 'speak', input: { text: 'I can order the pump. Shall I?' } }],
        [{ tool: 'confirm_checkout', input: {} }],
        [{ tool: 'speak', input: { text: 'Ordered.' } }],
      ]));
      a = new Alexa({ url, converse });
      await a.turn('Can I get the part?');
      r = await a.turn('Yes.');
      assert.match(r.steps.find((s) => s.tool === 'confirm_checkout').answer, /never said/);

      // The total said, then a yes on the next turn: ordered.
      ({ converse } = scripted([
        [{ tool: 'begin_checkout', input: CART }],
        [{ tool: 'speak', input: { text: 'Drain pump, $41.78 in total. Order it?' } }],
        [{ tool: 'confirm_checkout', input: {} }],
        [{ tool: 'speak', input: { text: 'Ordered.' } }],
      ]));
      a = new Alexa({ url, converse });
      await a.turn('Can I get the part?');
      r = await a.turn('Yes.');
      const c = r.steps.find((s) => s.tool === 'confirm_checkout');
      assert.doesNotMatch(c.answer, /held by the client|not ordered/, c.answer);
      assert.match(c.answer, /^ordered Drain pump · \$41\.78/);
    });
  });

  await it('a line too long to hear across a room is sent back once, and the short one is said', async () => {
    await withServer(async (url) => {
      const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + '.';
      const { converse, shown } = scripted([
        [{ tool: 'speak', input: { text: long } }],
        [{ tool: 'speak', input: { text: 'Switch it off at the wall first.' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('Talk me through it.');
      assert.equal(r.say, 'Switch it off at the wall first.');
      assert.match(JSON.stringify(shown[1].messages.at(-1)), /too long to hear across a room/);
    });
  });

  await it('a repair that needs a part is not guided until somebody has asked about the part', async () => {
    await withServer(async (url) => {
      const { converse } = scripted([
        [{ tool: 'verify_diagnosis', input: { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: ['filter', 'hose'] } }],
        [{ tool: 'guide', input: { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' } }],
        // Refused, and tried again at once: still refused — the person has not been asked yet.
        [{ tool: 'guide', input: { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' } }],
        [{ tool: 'speak', input: { text: 'It is the drain pump. Shall I order one, or do you have it?' } }],
        [{ tool: 'guide', input: { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' } }],
        [{ tool: 'speak', input: { text: 'Switch it off at the wall first.' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r1 = await a.turn('It is silent.');
      const guides = r1.steps.filter((s) => s.tool === 'guide');
      assert.equal(guides.length, 2);
      assert.ok(guides.every((g) => /refused|part/i.test(g.answer)), 'a pump nobody has was guided into place');
      const r2 = await a.turn('I already have one.');
      assert.doesNotMatch(r2.steps.find((s) => s.tool === 'guide').answer, /held by the client/, 'the person answered and was still refused');
    });
  });

  await it('when a diagnosis starts, the household\'s record of that machine goes to the model with it', async () => {
    await withServer(async (url) => {
      const { receipt } = require('../mcp/tools/home');
      receipt({ model: 'SHE3AR75UC', code: 'E24', cause: 'Failed drain pump', action: 'Replaced the drain pump', confirmed: true });
      const { converse, shown } = scripted([
        [{ tool: 'hypotheses', input: { model: 'SHE3AR75UC', code: 'E24' } }],
        [{ tool: 'speak', input: { text: 'Start a drain cycle. Can you hear the pump?' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('My SHE3AR75UC is showing E24 again.');
      assert.ok(r.steps.some((s) => s.tool === 'repair_history'), 'the record was not read');
      const seen = JSON.stringify(shown[1].messages.at(-1));
      assert.match(seen, /thisHouse/);
      assert.match(seen, /Replaced the drain pump/);
      // Said, not merely offered: the model's line was about the pump, the client's is about the past.
      assert.match(r.say, /^This E24 is back — last time, on \w+ \d+: replaced the drain pump\./);
    });
  });

  await it('a question the model made up, instead of the one next_test chose, is sent back', async () => {
    await withServer(async (url) => {
      const { converse, shown } = scripted([
        [{ tool: 'hypotheses', input: { model: 'SHE3AR75UC', code: 'E24' } }],
        [{ tool: 'speak', input: { text: 'Is the filter clogged?' } }],
        [{ tool: 'next_test', input: {} }],
        [{ tool: 'speak', input: { text: 'Can you hear the pump humming?' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('SHE3AR75UC, E24.');
      // (Earlier tests in this file recorded a pump repair, so the line may open with "This E24 is back".)
      assert.match(r.say, /Can you hear the pump humming\?$/);
      assert.doesNotMatch(r.say, /filter clogged/);
      assert.match(JSON.stringify(shown[2].messages.at(-1)), /Call next_test first/);
    });
  });

  await it('it does not say a repair worked that nothing saw work', async () => {
    await withServer(async (url) => {
      const { converse, shown } = scripted([
        [{ tool: 'remember_repair', input: { model: 'SHE3AR75UC', code: 'E24', cause: 'Failed drain pump', action: 'Replaced the drain pump', confirmed: true } }],
        [{ tool: 'speak', input: { text: 'Noted — the fault is cleared.' } }],
        [{ tool: 'speak', input: { text: 'Noted, as you reported it.' } }],
      ]);
      const a = new Alexa({ url, converse });
      const r = await a.turn('I fitted it and it drains now.');
      assert.equal(r.say, 'Noted, as you reported it.');
      assert.match(JSON.stringify(shown[2].messages.at(-1)), /do not say it is cleared/);
    });
  });

  console.log(`\n${passed} passed`);
})();
