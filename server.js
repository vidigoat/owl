/* SECOND SET OF HANDS — zero-dependency dev server. node server.js -> http://localhost:8792 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const data = require('./engine');
// The device experience calls the same modules the MCP server exposes — no second copy of the truth.
const { diagnose } = require('./mcp/tools/diagnose');
const { verify_diagnosis } = require('./mcp/tools/verify_diagnosis');
const { guide } = require('./mcp/tools/guide');
const { find_part } = require('./mcp/tools/find_part');
const { buildSpace, prune } = require('./mcp/tools/hypotheses');
const { nextTest } = require('./mcp/tools/next_test');
const { MODELS } = require('./data/service-data');

/** Read a JSON body. The diagnosis loop passes objects around, so GET params won't do. */
const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

const PORT = 8792;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const send = (res, code, body, type) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/session') {
      return send(res, 200, JSON.stringify({
        appliance: data.APPLIANCE, fault: data.FAULT, causes: data.CAUSES,
        steps: data.STEPS, part: data.PART, abstain: data.ABSTAIN_CASE,
        memory: data.MEMORY, trace: data.TRACE,
      }), 'application/json');
    }

    if (url.pathname === '/api/diagnose') {
      const model = url.searchParams.get('model');
      const code = url.searchParams.get('code');
      return send(res, 200, JSON.stringify(diagnose({ model, code })), 'application/json');
    }

    if (url.pathname === '/api/verify') {
      const model = url.searchParams.get('model');
      const code = url.searchParams.get('code');
      const causeId = url.searchParams.get('causeId') || undefined;
      const ruledOut = (url.searchParams.get('ruledOut') || '').split(',').filter(Boolean);
      return send(res, 200, JSON.stringify(verify_diagnosis({ model, code, causeId, ruledOut })), 'application/json');
    }

    // ── the diagnosis loop: the device holds the state, the server holds the reasoning ──
    if (req.method === 'POST' && url.pathname.startsWith('/api/diagnosis/')) {
      return readJson(req)
        .then((body) => {
          const step = url.pathname.split('/').pop();

          if (step === 'start') {
            const built = buildSpace({ model: body.model, code: body.code });
            const fault = MODELS[body.model]?.codes?.[body.code];
            return send(res, 200, JSON.stringify({ ...built, tests: fault?.tests || [] }), 'application/json');
          }

          if (step === 'next') {
            return send(res, 200, JSON.stringify(nextTest(body)), 'application/json');
          }

          if (step === 'observe') {
            return send(res, 200, JSON.stringify(prune(body)), 'application/json');
          }

          return send(res, 404, JSON.stringify({ error: `no diagnosis step "${step}"` }), 'application/json');
        })
        .catch((e) => send(res, 400, JSON.stringify({ error: e.message }), 'application/json'));
    }

    if (url.pathname === '/api/guide') {
      const model = url.searchParams.get('model');
      const code = url.searchParams.get('code');
      const causeId = url.searchParams.get('causeId');
      return send(res, 200, JSON.stringify(guide({ model, code, causeId })), 'application/json');
    }

    if (url.pathname === '/api/part') {
      const model = url.searchParams.get('model');
      const causeId = url.searchParams.get('causeId');
      return send(res, 200, JSON.stringify(find_part({ model, causeId })), 'application/json');
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'no', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
    });
  })
  .listen(PORT, () => console.log(`second-set-of-hands  http://localhost:${PORT}`));
