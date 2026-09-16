/**
 * Reading a machine off a photograph.
 *
 * Bedrock is not reachable in CI or without credentials, so these tests cover the two things that
 * must be true regardless: the parser never invents a reading, and a failed read is labelled as
 * simulated rather than dressed up as a real one.
 *
 * Run: node mcp/tools/see.test.js
 */

const assert = require('node:assert');
const { see, parseReading, PROMPT } = require('./see');

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

(async () => {
  console.log('reading a photograph');

  await it('pulls a reading out of whatever the model wraps it in', () => {
    const r = parseReading('Here you go: {"model":"SHE3AR75UC","code":"e24","confidence":0.94} — hope that helps');
    assert.equal(r.model, 'SHE3AR75UC');
    assert.equal(r.code, 'E24', 'codes are normalised to upper case');
    assert.equal(r.confidence, 0.94);
  });

  await it('treats a missing field as unknown rather than filling it in', () => {
    const r = parseReading('{"model":null,"code":"OE","confidence":0.7}');
    assert.equal(r.model, null);
    assert.equal(r.code, 'OE');
  });

  await it('returns nothing readable when the model answered in prose', () => {
    assert.equal(parseReading('It looks like a dishwasher of some kind.'), null);
  });

  await it('instructs the model to refuse rather than guess', () => {
    assert.match(PROMPT, /Do not guess/i);
    assert.match(PROMPT, /Do not infer a plausible\s+model number/i);
  });

  await it('labels a read it could not actually perform', async () => {
    const r = await see({ imagePath: '/nonexistent/photo.jpg' });
    assert.equal(r.ok, false);
    assert.equal(r.simulated, true);
    assert.equal(r.model, null, 'a failed read must not return a model number');
  });

  await it('never reports a simulated read as if it were real', async () => {
    const r = await see({ imagePath: '/nonexistent/photo.jpg', expect: { model: 'X', code: 'Y' } });
    assert.equal(r.simulated, true);
    assert.ok(r.note && /Simulated/.test(r.note), 'must say so in the payload itself');
  });

  console.log(`\n${passed} passed`);
})();
