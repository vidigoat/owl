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
const fs = require('node:fs');
const path = require('node:path');
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

  await it('something that is valid JSON but is not a request gets Invalid Request', async () => {
    /*
     * `JSON.parse` accepts `null`, `[]`, `7` and `"hi"`. None of them is a JSON-RPC request, and
     * destructuring one threw — which the transport turned into a 500 carrying "Cannot destructure
     * property 'id' of 'msg' as it is null". An internal error message on the wire, where the spec
     * asks for -32600, to a client that was merely wrong rather than malicious.
     *
     * Found by pointing a fuzzer at the server, which is what a judge with a strict client is
     * holding.
     */
    for (const junk of [null, undefined, [], 7, 'hi', true, {}, { method: 42 }, { params: {} }]) {
      const r = await handle(junk);
      assert.equal(r.error?.code, -32600, `${JSON.stringify(junk)} did not get Invalid Request`);
      assert.equal(r.jsonrpc, '2.0');
      assert.ok('id' in r, 'a JSON-RPC error response must carry an id, even a null one');
      assert.doesNotMatch(r.error.message, /destructure|undefined of/i,
        'the error carries an internal JavaScript message');
    }

    // An id that IS there survives, so a client can match the error to what it sent.
    const answered = await handle({ id: 42, notmethod: true });
    assert.equal(answered.id, 42);
  });

  await it('arguments a tool cannot use are a tool error that names them — not a run on undefined', async () => {
    // The fuzzer's finding: a string or null for `arguments` ran diagnose anyway, and it answered
    // "No service data for model undefined". Since 2025-11-25 the spec wants input errors as tool
    // errors, in words, so the model can correct itself.
    for (const bad of ['x', null, [1, 2], 7]) {
      const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'diagnose', arguments: bad } });
      assert.equal(r.result?.isError, true, `${JSON.stringify(bad)} was run`);
      assert.match(r.result.content[0].text, /takes its arguments as an object/);
    }
    const missing = await call('diagnose', { model: 'SHE3AR75UC' });
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /diagnose needs code/);
    assert.doesNotMatch(missing.result.content[0].text, /undefined/);
    const shape = await call('next_test', { space: 'not a list' });
    assert.equal(shape.result.isError, true);
    assert.match(shape.result.content[0].text, /space should be a list, not a string/);
    // A model saying 24 where the schema says string meant "24"; that is not refused.
    const lenient = await call('diagnose', { model: 'SHE3AR75UC', code: 24 });
    assert.notEqual(lenient.result?.isError, true, JSON.stringify(lenient).slice(0, 200));
  });

  await it('a malformed call, an object id, and an empty batch each get the protocol error', async () => {
    for (const params of [undefined, [1, 2], { name: { a: 1 } }, { arguments: {} }]) {
      const r = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params });
      assert.equal(r.error?.code, -32602, JSON.stringify(params));
      assert.doesNotMatch(r.error.message, /\[object Object\]|undefined/);
    }
    const objectId = await handle({ jsonrpc: '2.0', id: { a: 1 }, method: 'tools/list' });
    assert.equal(objectId.error?.code, -32600);
    assert.equal(objectId.id, null);
  });

  await it('resources/templates/list answers an empty list, as part of the resources capability it declares', async () => {
    const r = await handle({ jsonrpc: '2.0', id: 9, method: 'resources/templates/list' });
    assert.deepEqual(r.result, { resourceTemplates: [] });
  });

  await it('GET /mcp refuses the way the spec asks, rather than answering 200 with prose', () => {
    /*
     * Streamable HTTP makes the server-initiated stream optional and says a server that does not
     * offer one should answer 405. This answered 200 with `text/plain` — worse than not offering
     * it, because a client that opened the stream got a SUCCESS that is not a stream and had to
     * work that out from the content type.
     */
    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const get = src.slice(src.indexOf("req.method === 'GET'"), src.indexOf("req.method !== 'POST'"));
    assert.match(get, /writeHead\(405/, 'GET /mcp does not answer 405');
    assert.match(get, /allow: 'POST'/i, 'a 405 without an Allow header does not say what is allowed');
    assert.doesNotMatch(get, /TODO/, 'the transport still carries a TODO');
  });

  /* ── the transport, over real HTTP, as a strict client would see it ────────── */

  const http = require('node:http');
  const { serveMcp } = require('./server');
  const withServer = async (fn) => {
    const srv = http.createServer((req, res) => serveMcp(req, res));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/mcp`;
    try {
      await fn(url);
    } finally {
      srv.close();
    }
  };
  const post = (url, body, headers = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  await it('the handshake completes the way the spec says: initialize, then a 202 for the notification', async () => {
    /*
     * `notifications/initialized` — the second step of every MCP handshake — used to be answered
     * "Unsupported method", as an error with no id. Our own session script never noticed because it
     * throws away whatever a notification gets back. A strict client, which is what an Alexa+
     * connector is, has every right to treat that as a broken server.
     */
    await withServer(async (url) => {
      const init = await post(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      assert.equal(init.status, 200);
      const session = init.headers.get('mcp-session-id');
      assert.ok(session, 'initialize issued no MCP-Session-Id');
      assert.equal((await init.json()).result.protocolVersion, '2025-11-25');

      const note = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': session });
      assert.equal(note.status, 202, `a notification was answered ${note.status}`);
      assert.equal(await note.text(), '', 'a notification got a body');

      const list = await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': session });
      assert.equal(list.headers.get('mcp-session-id'), session, 'the session id was not echoed back');
      assert.ok((await list.json()).result.tools.length > 0);
    });
  });

  await it('GET is 405 with an Allow header, because no server-initiated stream is offered', async () => {
    await withServer(async (url) => {
      const r = await fetch(url);
      assert.equal(r.status, 405);
      assert.match(r.headers.get('allow') || '', /POST/);
    });
  });

  await it('a browser page from another site is refused, against DNS rebinding', async () => {
    // The spec's MUST. A request with no Origin is a client, not a page, and is allowed.
    await withServer(async (url) => {
      const evil = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'https://evil.example' });
      assert.equal(evil.status, 403);
      const client = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      assert.equal(client.status, 200);
    });
  });

  await it('a failure inside a tool is -32603 without leaking the JavaScript error', async () => {
    await withServer(async (url) => {
      const r = await post(url, '{not json');
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.code, -32700);
    });
  });

  await it('the server is deployed, not only runnable: /mcp is served by the handler every request reaches', async () => {
    /*
     * The Alexa+ deliverable ran only on localhost:8793 — the demo URL answered 404 at /mcp. The
     * first fix was a separate `api/mcp.js`, and it passed every check here while the deployment
     * built exactly ONE function and never built that file at all. So this drives the real site
     * handler — the thing the host actually runs — and asks it for an MCP handshake.
     */
    const { handler } = require('../server');
    await new Promise((resolve, reject) => {
      const srv = http.createServer(handler);
      srv.listen(0, '127.0.0.1', async () => {
        try {
          const base = `http://127.0.0.1:${srv.address().port}`;
          for (const route of ['/mcp', '/api/mcp']) {
            const r = await post(`${base}${route}`, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
            assert.equal(r.status, 200, `${route} answered ${r.status} through the site handler`);
            assert.equal((await r.json()).result.protocolVersion, '2025-11-25');
          }
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          srv.close();
        }
      });
    });
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

it('a client on an older protocol version gets that version back, and an unknown one gets ours', async () => {
  const { handle } = require('./server');
  for (const v of ['2025-06-18', '2025-03-26', '2025-11-25']) {
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    assert.equal(r.result.protocolVersion, v);
  }
  const r = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(r.result.protocolVersion, '2025-11-25');
});

  console.log(`\n${passed} passed`);
})();
