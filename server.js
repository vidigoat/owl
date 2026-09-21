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
const { MODELS, LEARNED, learn } = require('./data/service-data');
const { parse: parseManual } = require('./manual/faultgraph');
const { see } = require('./mcp/tools/see');
const { read_manual } = require('./mcp/tools/read_manual');
const review = require('./manual/review');
const { confirm_fix } = require('./mcp/tools/confirm_fix');
const { beginCheckout, confirmCheckout } = require('./mcp/tools/order_part');
const { remember: rememberAppliance, receipt: writeReceipt, due: dueNow } = require('./mcp/tools/home');

/** Read a JSON body. The diagnosis loop passes objects around, so GET params won't do. */
/** 28 MB: a phone photo becomes ~33% larger as base64, and see() caps the image itself at 20 MB. */
const MAX_BODY = 28 * 1024 * 1024;

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      // Refuse early rather than buffering an unbounded upload into memory.
      if (body.length > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

const PORT = Number(process.env.PORT) || 8792;
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

    // Read a photograph. Without credentials this comes back labelled as simulated, and the device
    // shows that label — a demo that cannot tell a real read from a canned one is a magic trick.
    if (req.method === 'POST' && url.pathname === '/api/see') {
      return readJson(req)
        .then((body) => see(body))
        .then((r) => send(res, 200, JSON.stringify(r), 'application/json'))
        .catch((e) => send(res, 500, JSON.stringify({ error: e.message }), 'application/json'));
    }

    // Checkout. The refusal lives here too: a cart cannot be opened for a cause the gate refused.
    if (req.method === 'POST' && url.pathname === '/api/checkout/begin') {
      return readJson(req)
        .then((body) => send(res, 200, JSON.stringify(beginCheckout(body)), 'application/json'))
        .catch((e) => send(res, 400, JSON.stringify({ error: e.message }), 'application/json'));
    }

    if (req.method === 'POST' && url.pathname === '/api/checkout/confirm') {
      return readJson(req)
        .then((body) => send(res, 200, JSON.stringify(confirmCheckout(body)), 'application/json'))
        .catch((e) => send(res, 400, JSON.stringify({ error: e.message }), 'application/json'));
    }

    // Did the repair actually work, and write down what happened.
    if (req.method === 'POST' && url.pathname === '/api/confirm') {
      return readJson(req)
        .then((body) => confirm_fix(body))
        .then((r) => send(res, 200, JSON.stringify(r), 'application/json'))
        .catch((e) => send(res, 500, JSON.stringify({ error: e.message }), 'application/json'));
    }

    if (req.method === 'POST' && url.pathname === '/api/remember') {
      return readJson(req)
        .then((body) => {
          rememberAppliance({ model: body.model, brand: body.brand, kind: body.kind });
          const saved = writeReceipt(body);
          return send(res, 200, JSON.stringify({ ...saved, due: dueNow().due }), 'application/json');
        })
        .catch((e) => send(res, 500, JSON.stringify({ error: e.message }), 'application/json'));
    }

    // Teach it a machine it has never seen, from that machine's own service manual.
    // Learn a machine from a PHOTOGRAPH of its manual page. Same destination as /api/learn, a
    // different way of getting the characters there.
    if (req.method === 'POST' && url.pathname === '/api/learn-from-photo') {
      return readJson(req)
        .then((body) => read_manual(body))
        .then((r) => send(res, 200, JSON.stringify(r), 'application/json'))
        .catch((e) => send(res, 500, JSON.stringify({ error: e.message }), 'application/json'));
    }

    if (req.method === 'POST' && url.pathname === '/api/learn') {
      return readJson(req)
        .then((body) => {
          const graph = parseManual({ model: body.model, text: body.text, sourceName: body.source || 'service manual' });
          const result = learn({
            model: body.model,
            brand: body.brand,
            kind: body.kind,
            codes: graph.codes,
            source: body.source,
          });
          return send(res, 200, JSON.stringify({ ...result, coverage: graph.coverage, found: graph.found }), 'application/json');
        })
        .catch((e) => send(res, 400, JSON.stringify({ error: e.message }), 'application/json'));
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

    /* ── the review queue: nothing reaches the library without a person saying so ── */

    if (url.pathname === '/api/review/queue') {
      return send(res, 200, JSON.stringify({ pending: review.queue() }), 'application/json');
    }

    if (url.pathname === '/api/review/candidate') {
      const entry = review.candidate(url.searchParams.get('model'));
      if (!entry) return send(res, 404, JSON.stringify({ error: 'nothing pending for that model' }), 'application/json');
      return send(res, 200, JSON.stringify(entry), 'application/json');
    }

    /*
     * The page the parse came from. A reviewer who has to go and find the PDF will approve on
     * trust instead, which would make the whole step theatre.
     */
    if (url.pathname === '/api/review/page') {
      const file = review.pageImagePath(url.searchParams.get('model'));
      if (!file) return send(res, 404, 'no page kept for that model', 'text/plain');
      return fs.readFile(file, (err, buf) =>
        err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, buf, 'image/png'));
    }

    if (req.method === 'POST' && url.pathname === '/api/review/admit') {
      return readJson(req)
        .then((body) => {
          const accept = Array.isArray(body.accept) ? body.accept : [];
          const result = review.admit(body.model, accept, body.by || 'unattributed');
          return send(res, result.admitted ? 200 : 400, JSON.stringify(result), 'application/json');
        })
        .catch((e) => send(res, 400, JSON.stringify({ error: e.message }), 'application/json'));
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
