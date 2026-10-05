#!/usr/bin/env node
/**
 * Every route the deployed site serves, asked once, after a deploy.
 *
 *   npm run smoke:live                        # https://owl-repair.vercel.app
 *   npm run smoke:live -- https://preview-url
 *
 * The hosted functions are a compiled bundle, and a bundle can break what every local test passes —
 * the sibling project shipped a 500 on its front page that way on 23 September, with its suite
 * green. So this asks the real URL the way a browser and an MCP client do, and fails on anything a
 * visitor should not get. Spends nothing: the agent route is expected to say it has no credentials.
 */

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || 'https://owl-repair.vercel.app').replace(/\/$/, '');
const J = (t) => JSON.parse(t);

const CHECKS = [
  ['GET', '/', 200, (t) => /<html/i.test(t)],
  ['GET', '/talk.html', 200, (t) => /<video|talk/i.test(t)],
  ['GET', '/connect.html', 200, (t) => t.includes('/mcp')],
  ['GET', '/app-host.html', 200, (t) => /<html/i.test(t)],
  ['GET', '/review.html', 200, (t) => /<html/i.test(t)],
  ['GET', '/fix.html', 200, (t) => /<html/i.test(t) && t.includes('fix.js')],
  ['GET', '/privacy.html', 200, (t) => /privacy/i.test(t)],
  ['GET', '/terms.html', 200, (t) => /terms/i.test(t)],
  ['GET', '/addon/icon.svg', 200, (t) => t.includes('<svg')],
  ['GET', '/api/diagnose?model=SHE3AR75UC&code=E24', 200, (t) => J(t).known === true && J(t).causes.length > 0],
  ['GET', '/api/verify?model=SHE3AR75UC&code=E24', 200, (t) => typeof J(t) === 'object'],
  ['GET', '/api/review/queue', 200, (t) => Array.isArray(J(t).pending)],
  ['POST', '/mcp', 200, (t) => J(t).result.protocolVersion === '2025-11-25', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } }],
  ['POST', '/mcp', 200, (t) => J(t).result.tools.length === 22, { jsonrpc: '2.0', id: 2, method: 'tools/list' }],
  ['POST', '/mcp', 200, (t) => J(t).result.isError === true && /needs code/.test(J(t).result.content[0].text), { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'diagnose', arguments: { model: 'SHE3AR75UC' } } }],
  ['POST', '/mcp', 200, (t) => J(t).result.contents[0].mimeType === 'text/html;profile=mcp-app', { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'ui://owl/card' } }],
  // Saved durably, or said to be not kept — never a silent "saved" on a host that cannot keep it.
  // Only with --write: with the shared store on, it would add a receipt to the demo household.
  ...(process.argv.includes('--write') ? [] : [null]).filter(Boolean),
  ...(!process.argv.includes('--write') ? [] : [['POST', '/mcp', 200, (t) => { const v = J(t).result.structuredContent; return v.saved === true ? !v.kept : v.kept === 'session' && /^Not kept/.test(v.keptFor); }, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'remember_repair', arguments: { model: 'SHE3AR75UC', code: 'E24', cause: 'Blocked filter', action: 'Smoke check: cleaned the filter' } } }]]),
  ['POST', '/api/read-text', 200, (t) => J(t).codes[0].code === 'E24' && J(t).codes[0].causes.length === 2, { text: 'E24\tWater cannot drain\tCheck the drain filter; straighten the drain hose' }],
  // The repair kit records an outcome only with consent; without it, refused, and nothing kept.
  ['POST', '/api/outcome', 200, (t) => J(t).recorded === false, { model: 'SHE3AR75UC', code: 'E24', outcome: 'fixed' }],
  ['GET', '/api/outcomes', 200, (t) => typeof J(t).total === 'number'],
  ['POST', '/api/alexa', 503, (t) => J(t).available === false, { said: 'my dishwasher shows E24' }, { origin: BASE }],
];

(async () => {
  let bad = 0;
  for (const [method, route, want, ok, body, extra] of CHECKS) {
    const started = Date.now();
    let line;
    try {
      const res = await fetch(`${BASE}${route}`, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } : {}), ...(extra || {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let good = res.status === want;
      try { good = good && ok(text); } catch { good = false; }
      if (!good) bad++;
      line = `${good ? 'ok  ' : 'FAIL'} ${res.status} ${method.padEnd(4)} ${route}${good ? '' : `  ${text.slice(0, 120).replace(/\s+/g, ' ')}`}`;
    } catch (e) {
      bad++;
      line = `FAIL ---  ${method.padEnd(4)} ${route}  ${e.message}`;
    }
    console.log(`  ${line}  ${Date.now() - started}ms`);
  }
  console.log(bad ? `\n  ${bad} route(s) wrong on ${BASE}\n` : `\n  every route answered as it should on ${BASE}\n`);
  process.exitCode = bad ? 1 : 0;
})();
