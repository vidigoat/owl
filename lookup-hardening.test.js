/**
 * What a caller can send as a key, and what it must never reach.
 *
 *   node lookup-hardening.test.js
 *
 * Found fuzzing the hosted routes on 24 September: model "__proto__", code "constructor" crashed the
 * deployed function — the service tables are plain objects, and `MODELS['__proto__']` is
 * Object.prototype, which is truthy — and a body that was not JSON came back as a 500 carrying the
 * parser's own message. Every lookup of a caller-chosen key now reads only a table's own entries.
 */
const assert = require('node:assert');
const http = require('node:http');
const { lookup, learn, resolveModel, provenance } = require('./data/service-data');
const { handle, TOOLS } = require('./mcp/server');
const handler = require('./server');

let passed = 0;
const it = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; }
};
const RESERVED = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];

(async () => {
  console.log('lookup hardening');

  await it('a built-in name is never a machine, a fault code, or a provenance', () => {
    for (const k of RESERVED) {
      assert.equal(lookup(k, 'E24').known, false, `model ${k}`);
      assert.equal(lookup('SHE3AR75UC', k).known, false, `code ${k}`);
      assert.equal(provenance(k), null, `provenance ${k}`);
      assert.equal(resolveModel(k), k);
    }
  });

  await it('a built-in name cannot be learned into the table', () => {
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      const r = learn({ model: k, codes: { E1: { meaning: 'x', causes: [] } } });
      assert.equal(r.learned, false, `learned ${k}`);
    }
    assert.equal(({}).polluted, undefined);
  });

  await it('every tool answers a built-in name in words — none of them throws', async () => {
    for (const t of TOOLS) {
      const args = {};
      for (const [k, v] of Object.entries(t.inputSchema.properties || {})) {
        if (/image/i.test(k)) continue;
        args[k] = v.type === 'array' ? ['constructor'] : v.type === 'number' ? 1 : v.type === 'boolean' ? false : v.type === 'object' ? {} : 'constructor';
      }
      const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: t.name, arguments: args } });
      assert.ok(!r.error, `${t.name}: ${r.error?.message}`);
    }
  });

  await it('a body that is not JSON is a 400 in words, not the parser\'s message as a 500', async () => {
    const srv = http.createServer(handler);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/see`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
      assert.equal(res.status, 400);
      const j = await res.json();
      assert.equal(j.error, 'That is not JSON.');
    } finally { srv.close(); }
  });

  console.log(`\n${passed} passed`);
})();
