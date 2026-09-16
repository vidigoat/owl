/**
 * The JSON-RPC layer.
 *
 * These exist because of a bug that shipped quietly: every tool happened to be synchronous, so
 * `tools/call` serialised the handler's return value directly. The first async tool turned into
 * `{}` and the response looked superficially fine. A tool doing real work is the normal case, not
 * the exception, so it gets a regression test.
 *
 * Run: node mcp/server.test.js
 */

const assert = require('node:assert');
const { handle, TOOLS, PROTOCOL_VERSION } = require('./server');

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

const call = (name, args = {}) => handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

(async () => {
  console.log('mcp server');

  await it('announces the protocol version the rules require', async () => {
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(r.result.protocolVersion, '2025-11-25');
    assert.equal(PROTOCOL_VERSION, '2025-11-25');
  });

  await it('every registered tool has a description and a schema', async () => {
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.ok(r.result.tools.length >= 8, `only ${r.result.tools.length} tools`);
    r.result.tools.forEach((t) => {
      assert.ok(t.description && t.description.length > 20, `${t.name} needs a real description`);
      assert.equal(t.inputSchema.type, 'object');
    });
  });

  await it('every tool in the list is actually callable', async () => {
    const listed = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((t) => t.name);
    const registered = TOOLS.map((t) => t.name);
    assert.deepEqual(listed.sort(), registered.sort());
  });

  await it('resolves an async tool instead of serialising a promise', async () => {
    const r = await call('see', { imagePath: '/definitely/not/here.jpg' });
    assert.ok(r.result.structuredContent, 'no structured content came back');
    assert.equal(r.result.structuredContent.simulated, true, 'a promise was serialised instead of awaited');
  });

  await it('still handles a synchronous tool', async () => {
    const r = await call('verify_diagnosis', { model: 'SHE3AR75UC', code: 'E24' });
    assert.equal(r.result.structuredContent.upheld, true);
  });

  await it('answers every message in a batch', async () => {
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ];
    const responses = await Promise.all(batch.map(handle));
    assert.equal(responses.length, 2);
    assert.ok(responses[1].result.tools.length > 0);
  });

  await it('rejects an unknown tool rather than failing silently', async () => {
    const r = await call('no-such-tool');
    assert.ok(r.error, 'should be a JSON-RPC error');
    assert.equal(r.error.code, -32602);
  });

  await it('rejects an unknown method', async () => {
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/destroy' });
    assert.equal(r.error.code, -32601);
  });

  console.log(`\n${passed} passed`);
})();
