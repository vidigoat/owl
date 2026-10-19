/**
 * Owl's voice: what it sends to Polly, and what it refuses before spending anything.
 *
 *   node agent/voice.test.js
 */
const assert = require('node:assert');
const { speak, MAX_CHARS } = require('./voice');

let passed = 0;
const it = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; } };
const creds = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const ok = (bytes = [1, 2, 3]) => ({ ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer });

(async () => {
  console.log('voice');

  await it('one line becomes one signed Polly request for MP3, in the neural voice', async () => {
    const calls = [];
    const audio = await speak('Can you hear the   pump humming?', { creds, fetch: async (url, o) => { calls.push({ url, ...o }); return ok(); } });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/polly\.[a-z0-9-]+\.amazonaws\.com\/v1\/speech$/);
    const body = JSON.parse(calls[0].body);
    assert.equal(body.Engine, 'neural');
    assert.equal(body.OutputFormat, 'mp3');
    assert.equal(body.Text, 'Can you hear the pump humming?', 'whitespace was not tidied');
    assert.match(calls[0].headers.authorization, /AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/[a-z0-9-]+\/polly\/aws4_request/);
    assert.deepEqual([...audio], [1, 2, 3]);
  });

  await it('a voice without the neural engine falls back to the generative one', async () => {
    const engines = [];
    await speak('The part is a drain pump.', { creds, fetch: async (url, o) => {
      engines.push(JSON.parse(o.body).Engine);
      return engines.length === 1 ? { ok: false, status: 400, text: async () => 'engine not supported' } : ok();
    } });
    assert.deepEqual(engines, ['neural', 'generative']);
  });

  await it('the same line twice is one call', async () => {
    let n = 0;
    const f = async () => { n++; return ok(); };
    await speak('Ordered. It arrives tomorrow.', { creds, fetch: f });
    await speak('Ordered.  It arrives tomorrow.', { creds, fetch: f });
    assert.equal(n, 1);
  });

  await it('nothing is spent on an empty line, a too-long one, or without credentials', async () => {
    const never = async () => { throw new Error('called Polly'); };
    await assert.rejects(speak('   ', { creds, fetch: never }), (e) => e.status === 400);
    await assert.rejects(speak('x'.repeat(MAX_CHARS + 1), { creds, fetch: never }), (e) => e.status === 413);
    await assert.rejects(speak('Hello there.', { creds: null, fetch: never }), (e) => e.status === 503);
  });

  await it('a refusal from Polly is an error the page can fall back from, never silence', async () => {
    await assert.rejects(speak('Call a technician.', { creds, fetch: async () => ({ ok: false, status: 403, text: async () => 'denied' }) }), (e) => e.status === 403);
  });

  console.log(`\n${passed} passed`);
})();
