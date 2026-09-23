/**
 * The MCP App — the card an Echo Show draws — tested as the host would drive it.
 *
 *   node mcp/apps/card.test.js
 *
 * The card's own script runs, unmodified, against a stub document and a fake host that speaks the
 * MCP Apps protocol over a stub postMessage. The tool results it is handed are REAL: produced by
 * calling this server's tools. So what is tested is the page that ships, fed what ships.
 *
 * No browser here — the suite installs nothing. `public/app-host.html` is the same card in a real
 * browser, in a host we wrote, for looking at.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');

process.env.HOME_STORE = process.env.HOME_STORE || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'card-')), 'home.json');

const { handle } = require('../server');
const { APP_URI, APP_MIME, APP_TOOLS } = require('../cards');

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

const rpc = async (method, params) => (await handle({ jsonrpc: '2.0', id: 1, method, params })).result;
const call = async (name, args) => rpc('tools/call', { name, arguments: args });

/** Boot the card's script in a sandbox. Returns the host's side of the conversation. */
async function boot({ theme = 'dark', tool } = {}) {
  const read = await rpc('resources/read', { uri: APP_URI });
  const html = read.contents[0].text;
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

  const root = { innerHTML: '', querySelectorAll: () => [] };
  const docEl = { dataset: {}, getBoundingClientRect: () => ({ width: 600, height: 400 }) };
  const toHost = [];
  let listener = null;
  const parent = { postMessage: (m) => toHost.push(JSON.parse(JSON.stringify(m))) };
  const win = { parent, addEventListener: (type, fn) => { if (type === 'message') listener = fn; } };
  const ctx = {
    window: win,
    document: { getElementById: () => root, documentElement: docEl },
    ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } },
    Promise, Map, Math, Number, String, Array, JSON, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);

  const fromHost = (m) => listener({ source: parent, data: { jsonrpc: '2.0', ...m } });
  const fromElsewhere = (m) => listener({ source: {}, data: { jsonrpc: '2.0', ...m } });
  const init = toHost.find((m) => m.method === 'ui/initialize');
  fromHost({ id: init.id, result: { protocolVersion: '2026-01-26', hostContext: { theme, ...(tool ? { toolInfo: { tool: { name: tool } } } : {}) } } });
  await new Promise((r) => setImmediate(r));
  return { html, root, docEl, toHost, fromHost, fromElsewhere, init };
}

const E24 = { model: 'SHE3AR75UC', code: 'E24' };
const CART = { ...E24, causeId: 'pump', ruledOut: ['filter', 'hose'] };

(async () => {
  console.log('the MCP App');

  await it('it is served the way MCP Apps says — ui://, text/html;profile=mcp-app — and listed', async () => {
    const list = await rpc('resources/list');
    const r = list.resources.find((x) => x.uri === APP_URI);
    assert.ok(r, 'the card is not in resources/list');
    assert.equal(r.mimeType, 'text/html;profile=mcp-app');
    assert.equal(APP_MIME, 'text/html;profile=mcp-app');
    const read = await rpc('resources/read', { uri: APP_URI });
    assert.equal(read.contents[0].mimeType, APP_MIME);
    assert.match(read.contents[0].text, /^<!doctype html>/i);
  });

  await it('every tool it can draw names it in _meta.ui.resourceUri, and no other tool does', async () => {
    const { tools } = await rpc('tools/list');
    for (const t of tools) {
      const uri = t._meta?.ui?.resourceUri;
      if (APP_TOOLS.has(t.name)) assert.equal(uri, APP_URI, `${t.name} does not point at the card`);
      else assert.equal(uri, undefined, `${t.name} points at a card that cannot draw it`);
    }
    assert.ok(APP_TOOLS.has('begin_checkout') && APP_TOOLS.has('verify_diagnosis') && APP_TOOLS.has('guide'));
  });

  await it('it reaches nothing on the network — so it needs no CSP allowance at all', async () => {
    const { html } = await boot();
    assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i, 'the card loads something from elsewhere');
    assert.doesNotMatch(html, /url\(\s*["']?(?:https?:)?\/\//i, 'the card styles load something from elsewhere');
    assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|WebSocket|@import/, 'the card talks to the network');
  });

  await it('the handshake runs in the order the spec fixes: initialize, then initialized', async () => {
    const { toHost, init, docEl } = await boot({ theme: 'light' });
    assert.equal(init.params.protocolVersion, '2026-01-26');
    const order = toHost.map((m) => m.method).filter(Boolean);
    assert.ok(order.indexOf('ui/notifications/initialized') > order.indexOf('ui/initialize'), order.join(', '));
    assert.ok(order.includes('ui/notifications/size-changed'), 'the card never reported its size');
    assert.equal(docEl.dataset.theme, 'light', 'the host theme was ignored');
  });

  await it('a cart is drawn itemised from the tool result, and says nothing is charged until they say yes', async () => {
    const { root, fromHost } = await boot({ tool: 'begin_checkout' });
    const r = await call('begin_checkout', CART);
    assert.equal(r.structuredContent.ok, true);
    fromHost({ method: 'ui/notifications/tool-result', params: r });
    assert.match(root.innerHTML, /\$38\.42/);
    assert.match(root.innerHTML, /\$41\.78/);
    assert.match(root.innerHTML, /yes, order it/);
    assert.match(root.innerHTML, /\$179/);
  });

  await it('a refusal is drawn as a refusal — the mains fault sells nothing', async () => {
    const { root, fromHost } = await boot({ tool: 'verify_diagnosis' });
    fromHost({ method: 'ui/notifications/tool-result', params: await call('verify_diagnosis', { model: 'SHE3AR75UC', code: 'E09' }) });
    assert.match(root.innerHTML, /NOT UPHELD/);
    assert.match(root.innerHTML, /mains/);
    assert.doesNotMatch(root.innerHTML, /\$/);
  });

  await it('a lone surviving cause is "the only one left", never "100%"', async () => {
    const { root, fromHost } = await boot({ tool: 'observe' });
    const h = (await call('hypotheses', E24)).structuredContent;
    const o = await call('observe', { ...E24, space: h.space, tests: h.tests, testId: 'pump-hum', value: 'silent' });
    fromHost({ method: 'ui/notifications/tool-result', params: o });
    assert.match(root.innerHTML, /the only one left/);
    assert.doesNotMatch(root.innerHTML, />100%</);
    assert.match(root.innerHTML, /ruled out/);
  });

  await it('it tells the tools apart by what came back when the host does not say which ran', async () => {
    const { root, fromHost } = await boot();
    fromHost({ method: 'ui/notifications/tool-result', params: await call('next_test', { ...E24, space: (await call('hypotheses', E24)).structuredContent.space }) });
    assert.match(root.innerHTML, /ONE CHECK/);
    assert.match(root.innerHTML, /pump humming/);
  });

  await it('a step read off a manual shows no duration, because no manual gave one', async () => {
    const { root, fromHost } = await boot({ tool: 'guide' });
    const d = (await call('describe_problem', { model: 'SGE53C55UC', said: 'water is left at the end of the program' })).structuredContent;
    const id = d.matches[0].id;
    fromHost({ method: 'ui/notifications/tool-result', params: await call('guide', { model: 'SGE53C55UC', code: id, causeId: `${id}-0` }) });
    assert.match(root.innerHTML, /STEP 1 OF/);
    assert.doesNotMatch(root.innerHTML, /about \d+s/);
  });

  await it('nothing in a tool result is ever put on the page as markup', async () => {
    const { root, fromHost } = await boot({ tool: 'observe' });
    const hostile = '<img src=x onerror="parent.postMessage(1)">';
    fromHost({ method: 'ui/notifications/tool-result', params: { structuredContent: { space: [{ id: 'a', label: hostile, prior: 0.5 }, { id: 'b', label: 'ok', prior: 0.5 }], eliminated: [] } } });
    assert.doesNotMatch(root.innerHTML, /<img/);
    assert.match(root.innerHTML, /&lt;img/);
  });

  await it('a tool result from anything but the host that embedded it is ignored', async () => {
    const { root, fromElsewhere } = await boot({ tool: 'begin_checkout' });
    const before = root.innerHTML;
    // A real cart, posted by another frame on the page — it must not be drawn as if the host sent it.
    fromElsewhere({ method: 'ui/notifications/tool-result', params: await call('begin_checkout', CART) });
    assert.equal(root.innerHTML, before);
    assert.doesNotMatch(root.innerHTML, /41\.78/);
  });

  console.log(`\n${passed} passed`);
})();
