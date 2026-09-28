/**
 * Watching a repair step through the camera.
 *
 * Bedrock is handed in, so nothing here reaches AWS. What is tested is every way a watching
 * assistant can hurt somebody or lie to them: waving them on with a shaky read, signing off mains
 * work from a picture, going quiet about a hazard, putting a model's invented instruction in their
 * ear, or presenting "could not look" as a look.
 *
 * Run: node mcp/tools/watch_step.test.js
 */

const assert = require('node:assert');
const { watchStep, viaConverse, parseWatch, decide, prompt, DONE_AT, DANGER_AT, WATCH_MODEL } = require('./watch_step');
const { Budget } = require('../budget');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

const FILTER = { text: 'Turn the coarse filter counterclockwise and remove the filter system.', notes: ['Ensure that foreign objects do not fall into the sump.'] };
const POWER = { text: 'Disconnect the appliance from the power supply.' };
const ELEMENT = { text: 'Replace the heating element.' };
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** A different frame: identical frames never reach a model (see "nothing changed, nothing done"). */
const OTHER = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
/** Bedrock's envelope around a text answer. */
const answer = (obj) => async () => JSON.stringify({ output: { message: { content: [{ text: JSON.stringify(obj) }] } }, usage: {} });

(async () => {
  console.log('watch_step');

  await it('the prompt carries the manual\'s words for the step and asks for facts, never instructions', () => {
    const p = prompt(FILTER);
    assert.ok(p.includes(FILTER.text));
    assert.ok(p.includes(FILTER.notes[0]));
    assert.match(p, /FIRST image[\s\S]*SECOND is now/);
    assert.match(p, /Do not give instructions/);
  });

  await it('only the six-way answer is accepted; anything else is a failed read, not a guess', () => {
    assert.equal(parseWatch('Looks done to me!'), null);
    assert.equal(parseWatch('{"verdict":"probably","confidence":0.9}'), null);
    const r = parseWatch('Sure: {"verdict":"DONE","seen":"The coarse filter is lifted out and held above the tub floor now","part":null,"hazard":"none","confidence":1.4}');
    assert.equal(r.verdict, 'done');
    assert.equal(r.seen.split(' ').length, 12, 'what was seen is read aloud, and must stay short');
    assert.equal(r.hazard, null, '"none" is an absence, not a hazard called "none"');
    assert.equal(r.confidence, 1, 'confidence is clamped to 0..1');
  });

  await it('"done" needs something seen AND 70% — below that it asks again rather than waving the person on', () => {
    const shaky = decide({ scene: 'appliance', verdict: 'done', seen: 'filter out', confidence: DONE_AT - 0.01 }, FILTER);
    assert.equal(shaky.verdict, 'cant-see');
    assert.equal(shaky.downgradedFrom, 'done');
    const blind = decide({ scene: 'appliance', verdict: 'done', seen: null, confidence: 0.95 }, FILTER);
    assert.equal(blind.verdict, 'cant-see', 'a confident "done" that names nothing it saw passed');
    const sure = decide({ scene: 'appliance', verdict: 'done', seen: 'the filter is out of the sump', confidence: 0.9 }, FILTER);
    assert.equal(sure.verdict, 'done');
    assert.match(sure.say, /filter is out/);
  });

  await it('only a real machine can be "done": a screen or a page showing the step is not the step (both models fell for it)', () => {
    for (const scene of ['screen', 'paper', 'other', null]) {
      const r = decide({ scene, verdict: 'done', seen: 'filter removed from machine', confidence: 0.95 }, FILTER);
      assert.equal(r.verdict, 'cant-see', `a "${scene}" was accepted as a finished repair`);
      assert.equal(r.downgradedFrom, 'done');
    }
    assert.match(decide({ scene: 'screen', verdict: 'done', seen: 'x', confidence: 0.95 }, FILTER).say, /screen or a page/);
    assert.equal(parseWatch('{"scene":"Television","verdict":"done","seen":"x","confidence":1}').scene, null, 'an unknown scene was trusted');
    assert.match(prompt(FILTER), /Words, drawings and diagrams are never evidence/);
  });

  await it('a camera never signs off the power: a power step or mains work waits for the person to say it', () => {
    for (const step of [POWER, ELEMENT, { text: 'Switch the machine off at the wall before you start.' }]) {
      const held = decide({ scene: 'appliance', verdict: 'done', seen: 'the plug is out of the socket', confidence: 0.99 }, step);
      assert.equal(held.verdict, 'not-yet', `"${step.text}" was signed off by a picture`);
      assert.equal(held.heldBack, 'mains');
      assert.match(held.say, /Tell me it's off at the wall/);
      assert.equal(decide({ scene: 'appliance', verdict: 'done', seen: 'the plug is out of the socket', confidence: 0.99 }, step, { powerConfirmed: true }).verdict, 'done');
    }
    assert.equal(decide({ scene: 'appliance', verdict: 'done', seen: 'filter out', confidence: 0.9 }, FILTER).heldBack, undefined, 'an ordinary step was held back');
  });

  await it('a hazard is passed through at 40% — a false "stop" costs seconds, a missed one costs a hand', () => {
    const d = decide({ verdict: 'danger', hazard: 'display is lit with the panel off', confidence: DANGER_AT }, FILTER);
    assert.equal(d.verdict, 'danger');
    assert.match(d.say, /^Stop\. Display is lit/);
    const faint = decide({ verdict: 'danger', hazard: 'maybe water near a wire', confidence: 0.2 }, FILTER);
    assert.equal(faint.verdict, 'cant-see');
    assert.match(faint.say, /Is the machine off\?/, 'a faint hazard went silent');
  });

  await it('what the person hears is composed here; the step they follow is always the manual\'s sentence', () => {
    const wrong = decide({ verdict: 'wrong-part', part: 'the white inlet hose', confidence: 0.8 }, FILTER);
    assert.ok(wrong.say.endsWith(FILTER.text), 'the correction did not repeat the manual\'s step');
    assert.match(wrong.say, /the white inlet hose/);
    // A model answering with a whole invented procedure only ever reaches the person as 12 words
    // of description, never as the thing to do.
    const r = parseWatch(JSON.stringify({ verdict: 'not-yet', seen: 'filter still in. Now unscrew the four torx screws on the base and remove the heating element carefully', confidence: 0.8 }));
    const d = decide(r, FILTER);
    assert.ok(!/unscrew|torx|heating element/i.test(d.say), `an instruction invented by the model reached the person: "${d.say}"`);
    assert.match(d.say, /^Not yet — filter still in\.$/);
    // And a description that is only an instruction is dropped whole.
    const bare = decide(parseWatch(JSON.stringify({ verdict: 'not-yet', seen: 'Remove the pump cover next', confidence: 0.8 })), FILTER);
    assert.equal(bare.say, 'Not yet. Take your time.');
    const hazardOrder = decide(parseWatch(JSON.stringify({ verdict: 'danger', hazard: 'Unplug it now', confidence: 0.9 })), FILTER);
    assert.match(hazardOrder.say, /^Stop\. Something in view looks unsafe/, 'a hazard phrased as an order was read out as one');
  });

  await it('two frames through Bedrock: the start of the step and now, one prompt, one answer', async () => {
    let got;
    const invoke = async (req) => { got = req; return answer({ scene: 'appliance', verdict: 'done', seen: 'the coarse filter is out', part: 'coarse filter', hazard: null, confidence: 0.86 })(); };
    const r = await watchStep({ step: FILTER, before: `data:image/png;base64,${PIXEL}`, now: OTHER, invoke });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, 'done');
    assert.equal(got.images.length, 2);
    assert.equal(got.images[0].format, 'png');
    assert.equal(got.tool, 'watch_step', 'the spend was not attributed to this tool');
    assert.ok(got.timeoutMs > 0, 'a Bedrock call with no timeout can leave somebody waiting forever');
  });

  await it('could not look — no credentials, ceiling reached, too slow, a garbled answer — is "unavailable", never a verdict', async () => {
    const cases = [
      async () => { const e = new Error('spawn aws ENOENT'); e.code = 'ENOENT'; throw e; },
      async () => { throw new Error('Budget stop: a Bedrock vision call could cost up to $0.0004'); },
      async () => { const e = new Error('Bedrock took longer than 8 s'); e.code = 'TIMEOUT'; throw e; },
      async () => JSON.stringify({ output: { message: { content: [{ text: 'I think it looks fine' }] } } }),
    ];
    for (const invoke of cases) {
      const r = await watchStep({ step: FILTER, before: PIXEL, now: OTHER, invoke });
      assert.equal(r.verdict, 'unavailable');
      assert.equal(r.ok, false);
      assert.match(r.say, /tell me when it's done/, 'the repair did not fall back to the voice');
    }
    const budget = await watchStep({ step: FILTER, before: PIXEL, now: OTHER, invoke: cases[1] });
    assert.match(budget.reason, /spending ceiling/);
  });

  await it('bad input is refused before anything is sent: no step, one frame, a frame that is not an image', async () => {
    let calls = 0;
    const invoke = async () => { calls++; return answer({ scene: 'appliance', verdict: 'done', seen: 'x', confidence: 1 })(); };
    assert.equal((await watchStep({ before: PIXEL, now: PIXEL, invoke })).verdict, 'unavailable');
    assert.equal((await watchStep({ step: { text: 123 }, before: PIXEL, now: PIXEL, invoke })).verdict, 'unavailable', 'a non-string step text produced a verdict');
    assert.equal((await watchStep({ step: { text: '   ' }, before: PIXEL, now: PIXEL, invoke })).verdict, 'unavailable');
    assert.equal((await watchStep({ step: FILTER, now: PIXEL, invoke })).verdict, 'unavailable');
    assert.equal((await watchStep({ step: FILTER, before: PIXEL, now: '<script>alert(1)</script>', invoke })).verdict, 'unavailable');
    assert.equal((await watchStep({ step: FILTER, before: PIXEL, now: 'A'.repeat(6 * 1024 * 1024), invoke })).verdict, 'unavailable');
    assert.equal(calls, 0, 'something was sent to Bedrock that should have been refused first');
  });

  await it('nothing changed, nothing done — whatever the model says (Nova 2 Lite said "done" on identical frames)', async () => {
    let calls = 0;
    const liar = async () => { calls++; return answer({ scene: 'appliance', verdict: 'done', seen: 'coarse filter turned and removed', confidence: 1 })(); };
    const same = await watchStep({ step: FILTER, before: PIXEL, now: PIXEL, invoke: liar });
    assert.equal(same.verdict, 'not-yet');
    assert.equal(calls, 0, 'identical frames were sent to a model at all');
    const stillScene = await watchStep({ step: FILTER, before: PIXEL, now: OTHER, sceneChange: 0.8, invoke: liar });
    assert.equal(stillScene.verdict, 'not-yet', 'a page that measured no change was overruled by a model');
    assert.equal(stillScene.downgradedFrom, 'done');
    const moved = await watchStep({ step: FILTER, before: PIXEL, now: OTHER, sceneChange: 14, invoke: liar });
    assert.equal(moved.verdict, 'done');
    for (const unmeasured of [null, undefined, '0', 'none']) {
      const r = await watchStep({ step: FILTER, before: PIXEL, now: OTHER, sceneChange: unmeasured, invoke: liar });
      assert.equal(r.verdict, 'done', `sceneChange ${JSON.stringify(unmeasured)} (not measured) was read as "no change"`);
    }
  });

  const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
  const roomy = () => new Budget({ ceiling: 1, file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'watch-')), 'spend.json') });
  const req = { images: [{ base64: PIXEL, format: 'png' }, { base64: PIXEL, format: 'jpeg' }], prompt: 'look', maxTokens: 160, timeoutMs: 2000 };

  await it('on a host with no CLI it still looks: one signed Converse call, two images as bytes, temperature 0', async () => {
    let sent;
    const fetchImpl = async (url, opts) => { sent = { url, opts }; return { ok: true, status: 200, text: async () => JSON.stringify({ output: { message: { content: [{ text: '{"verdict":"not-yet","confidence":0.5}' }] } }, usage: { inputTokens: 1800, outputTokens: 30 } }) }; };
    const raw = await viaConverse(req, { creds: CREDS, env: {}, fetchImpl, budget: roomy() });
    const body = JSON.parse(sent.opts.body);
    assert.ok(sent.url.includes(`/model/${encodeURIComponent(WATCH_MODEL)}/converse`));
    assert.match(sent.opts.headers.authorization || sent.opts.headers.Authorization, /^AWS4-HMAC-SHA256/);
    assert.deepEqual(body.messages[0].content.map((c) => Object.keys(c)[0]), ['image', 'image', 'text']);
    assert.equal(body.messages[0].content[1].image.format, 'jpeg');
    assert.equal(body.inferenceConfig.temperature, 0);
    const env = JSON.parse(raw);
    assert.ok(env.cost > 0 && env.cost < 0.001, `one look cost $${env.cost}`);
  });

  await it('no credentials, or a deployment with no shared ledger: nothing is sent, and the page is told why', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, text: async () => '{}' }; };
    await assert.rejects(viaConverse(req, { creds: null, fetchImpl }), (e) => e.code === 'NO_CREDENTIALS');
    await assert.rejects(viaConverse(req, { creds: CREDS, env: { VERCEL: '1' }, fetchImpl }), (e) => e.code === 'NO_LEDGER');
    assert.equal(calls, 0, 'a call went out with no ceiling that holds across instances');
    const r = await watchStep({ step: FILTER, before: PIXEL, now: OTHER, invoke: (q) => viaConverse(q, { creds: CREDS, env: { VERCEL: '1' }, fetchImpl }) });
    assert.match(r.reason, /no shared spend ledger/);
  });

  await it('a ceiling already reached refuses before anything is sent; a slow Bedrock is cut off, not waited on', async () => {
    let calls = 0;
    const spent = roomy();
    spent.record(1, { tool: "test" });
    await assert.rejects(viaConverse(req, { creds: CREDS, env: {}, budget: spent, fetchImpl: async () => { calls++; } }), /Budget stop/);
    assert.equal(calls, 0);
    const hang = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
    const started = Date.now();
    await assert.rejects(viaConverse({ ...req, timeoutMs: 150 }, { creds: CREDS, env: {}, budget: roomy(), fetchImpl: hang }), (e) => e.code === 'TIMEOUT');
    assert.ok(Date.now() - started < 1500, 'the timeout did not cut the call off');
  });

  console.log(`\n${passed} passed`);
})();
