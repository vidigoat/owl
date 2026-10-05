/* OWL — zero-dependency dev server. node server.js -> http://localhost:8792 */
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
const lib = require('./data/service-data');
const { learn } = lib;
const { parse: parseManual } = require('./manual/faultgraph');
const { readSymptoms } = require('./manual/symptoms');
const pdf = require('./manual/pdf');
const { see } = require('./mcp/tools/see');
const { watchStep } = require('./mcp/tools/watch_step');
const { record: recordOutcome, summary: outcomeSummary } = require('./mcp/tools/outcome');
const { read_manual } = require('./mcp/tools/read_manual');
const review = require('./manual/review');
const { serveMcp, readBody, originAllowed } = require('./mcp/server');
const { confirm_fix } = require('./mcp/tools/confirm_fix');
const { beginCheckout, confirmCheckout } = require('./mcp/tools/order_part');
const { remember: rememberAppliance, receipt: writeReceipt, due: dueNow } = require('./mcp/tools/home');

/** Read a JSON body. The diagnosis loop passes objects around, so GET params won't do. */
/** 28 MB: a phone photo becomes ~33% larger as base64, and see() caps the image itself at 20 MB. */
const MAX_BODY = 28 * 1024 * 1024;

/**
 * What a hosted upload may weigh.
 *
 * Not chosen: measured. The platform answers `413 FUNCTION_PAYLOAD_TOO_LARGE` above roughly 4.5 MB,
 * before this process is started, so nothing in here can make the refusal a good one. Four
 * megabytes leaves room for the request's own overhead, and `GET /api/read-manual` hands the number
 * to the page so the page can say so before spending somebody's upload.
 */
const UPLOAD_LIMIT = 4 * 1024 * 1024;

/**
 * On this machine (never on a deployment), each look is written down — how long it took, what it
 * cost, which model, what it answered — so a real kitchen session produces the latency and cost
 * figures instead of an estimate of them. No frame is ever written: only these few fields.
 */
function measureLook(r) {
  if (process.env.VERCEL) return;
  try {
    const dir = path.join(__dirname, 'local');
    fs.mkdirSync(dir, { recursive: true });
    const line = { at: new Date().toISOString(), verdict: r.verdict, ms: r.ms ?? null, costUsd: r.costUsd ?? null, model: r.model ?? null, confidence: r.confidence ?? null, downgradedFrom: r.downgradedFrom || null, heldBack: r.heldBack || null, reason: r.ok ? null : r.reason || null };
    fs.appendFileSync(path.join(dir, 'watch-measure.jsonl'), `${JSON.stringify(line)}\n`);
  } catch { /* a measurement that cannot be written must never break the look */ }
}

/** When each client last asked for a look — see /api/watch. */
const watchLooks = new Map();
const WATCH_EVERY_MS = 2000;

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      // Refuse early rather than buffering an unbounded upload into memory.
      if (body.length > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        /*
         * Every route here expects an options object, and `JSON.parse` will happily hand back
         * `null`, `[]`, `7` or `"hi"` — all valid JSON, none of them a request. Three routes
         * answered a body of `null` with an internal JavaScript message, two of them as a 500:
         * "Cannot read properties of null (reading 'model')". That is a crash leaking out of the
         * process to a client that was merely wrong.
         *
         * Normalised once, here, rather than in nineteen tools — a tool's contract is an answer or
         * a refusal, and every one of them now gets something it can refuse.
         */
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        // Not JSON is the caller's mistake: a 400 in words, never the parser's message as a 500.
        reject(Object.assign(new Error('That is not JSON.'), { status: 400 }));
      }
    });
  });

/**
 * The request body as bytes.
 *
 * `readJson` concatenates into a string, which is correct for JSON and destroys a PDF — every byte
 * above 0x7F becomes a replacement character and the document is unreadable before it is parsed.
 * A binary upload needs buffers kept as buffers.
 */
const readBytes = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('that file is larger than this endpoint accepts'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const PORT = Number(process.env.PORT) || 8792;
/*
 * Where the site is served from.
 *
 * `dist/` is the built site. `public/` holds what is not built — the review bench, which is an
 * internal tool for admitting manuals — and is the fallback when nothing has been built yet.
 *
 * The site has its own dependencies in `web/`. The MCP server still has none and needs no build
 * step, because an Alexa+ skill is something somebody else has to run.
 */
const DIST = path.join(__dirname, 'dist');
const PUBLIC = path.join(__dirname, 'public');
const ROOTS = fs.existsSync(DIST) ? [DIST, PUBLIC] : [PUBLIC];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const send = (res, code, body, type) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

/**
 * The request handler, as a function.
 *
 * Separated from the listening so a host can serve exactly this code rather than a second, subtly
 * different copy. It used to be an anonymous callback inside `http.createServer(...).listen()`,
 * which meant the only way to run this project was to run this process — fine on a laptop, and a
 * dead end for anything that wants a URL.
 *
 * Importing this file gives you the handler and starts nothing. `node server.js` still listens.
 */
function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    /*
     * The MCP server — the Alexa+ deliverable — on the same handler as everything else.
     *
     * It was first deployed as its own file, `api/mcp.js`, with a rewrite to it. The deployment
     * built exactly one function, `index`: the host runs this whole app as a single Node backend
     * through this handler, so a per-file route is never built at all, and `/mcp` fell through to
     * "not found" here while every test passed. Routing it inside the one handler every request
     * already reaches is the only version that does not depend on how the host bundles the app.
     */
    if (url.pathname === '/mcp' || url.pathname === '/api/mcp') return serveMcp(req, res);

    /*
     * The live agent — Nova on Bedrock choosing the MCP tools — for the page at /talk.html.
     *
     * GET says whether it can run here, so the page never offers a conversation it cannot have.
     * POST is one turn. It spends money, so it takes requests only from this site's own pages (a
     * page elsewhere cannot make a visitor's browser run up the bill) and every call is metered
     * against the budget ceiling before it is made — see agent/live.js.
     */
    if (url.pathname === '/api/alexa') {
      const live = require('./agent/live');
      if (req.method === 'GET') return send(res, 200, JSON.stringify(live.available()), 'application/json');
      if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'GET or POST' }), 'application/json');
      const origin = req.headers.origin;
      if (!origin || !originAllowed(req)) {
        return send(res, 403, JSON.stringify({ error: 'Only this site\'s own pages may talk to the live agent.' }), 'application/json');
      }
      // One spoken line is a few hundred bytes; the MCP limit is sized for photographs.
      return readBody(req, 8 * 1024)
        .then((raw) => {
          let body;
          try { body = JSON.parse(raw || '{}'); } catch { return { status: 400, body: { error: 'Malformed JSON.' } }; }
          return live.turn(body && typeof body === 'object' ? body : {});
        })
        .then((r) => send(res, r.status, JSON.stringify(r.body), 'application/json'))
        .catch((e) => {
          if (e.status === 413) res.setHeader('connection', 'close');
          send(res, e.status || 500, JSON.stringify({ error: e.status === 413 ? 'Too long — one line at a time.' : 'Internal error.' }), 'application/json');
        });
    }

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
        .catch((e) => send(res, e.status || 500, JSON.stringify({ error: e.status ? e.message : 'The server could not finish that request.' }), 'application/json'));
    }

    /*
     * Watch a repair step: two frames and the manual's words for the step.
     *
     * One look every two seconds per client, whatever the page does. The page already sends a
     * frame only when the scene has settled, but a page is not the only thing that can call a URL,
     * and every look is a Bedrock call against a shared ceiling.
     */
    if (req.method === 'POST' && url.pathname === '/api/watch') {
      const who = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
      const last = watchLooks.get(who) || 0;
      if (Date.now() - last < WATCH_EVERY_MS) {
        return send(res, 429, JSON.stringify({ ok: false, verdict: 'unavailable', reason: 'One look at a time — the last one was under two seconds ago.', say: 'One moment.' }), 'application/json');
      }
      watchLooks.set(who, Date.now());
      if (watchLooks.size > 5000) watchLooks.clear();
      return readJson(req)
        .then((body) => watchStep({ step: body.step, before: body.before, now: body.now, powerConfirmed: Boolean(body.powerConfirmed), sceneChange: body.sceneChange }))
        .then((r) => {
          measureLook(r);
          return send(res, 200, JSON.stringify(r), 'application/json');
        })
        .catch((e) => send(res, e.status || 400, JSON.stringify({ ok: false, verdict: 'unavailable', reason: e.status ? e.message : 'That request could not be handled.', say: 'I can\'t see right now — tell me when it\'s done.' }), 'application/json'));
    }

    // Checkout. The refusal lives here too: a cart cannot be opened for a cause the gate refused.
    if (req.method === 'POST' && url.pathname === '/api/checkout/begin') {
      return readJson(req)
        .then((body) => send(res, 200, JSON.stringify(beginCheckout(body)), 'application/json'))
        .catch((e) => send(res, e.status || 400, JSON.stringify({ error: e.status ? e.message : 'That request could not be handled.' }), 'application/json'));
    }

    if (req.method === 'POST' && url.pathname === '/api/checkout/confirm') {
      return readJson(req)
        .then((body) => send(res, 200, JSON.stringify(confirmCheckout(body)), 'application/json'))
        .catch((e) => send(res, e.status || 400, JSON.stringify({ error: e.status ? e.message : 'That request could not be handled.' }), 'application/json'));
    }

    // Did the repair actually work, and write down what happened.
    if (req.method === 'POST' && url.pathname === '/api/confirm') {
      return readJson(req)
        .then((body) => confirm_fix(body))
        .then((r) => send(res, 200, JSON.stringify(r), 'application/json'))
        .catch((e) => send(res, e.status || 500, JSON.stringify({ error: e.status ? e.message : 'The server could not finish that request.' }), 'application/json'));
    }

    // The repair kit (public/fix.html) records one PII-free outcome at the end of a session — only
    // with the person's consent, and honest about whether this host could keep it. See outcome.js.
    if (req.method === 'POST' && url.pathname === '/api/outcome') {
      return readJson(req)
        .then((body) => send(res, 200, JSON.stringify(recordOutcome(body)), 'application/json'))
        .catch((e) => send(res, e.status || 400, JSON.stringify({ error: e.status ? e.message : 'That request could not be handled.' }), 'application/json'));
    }
    if (req.method === 'GET' && url.pathname === '/api/outcomes') {
      return send(res, 200, JSON.stringify(outcomeSummary()), 'application/json');
    }

    if (req.method === 'POST' && url.pathname === '/api/remember') {
      return readJson(req)
        .then((body) => require('./mcp/server').withHousehold(() => {
          rememberAppliance({ model: body.model, brand: body.brand, kind: body.kind });
          return { ...writeReceipt(body), due: dueNow().due };
        }))
        .then((answer) => send(res, 200, JSON.stringify(answer), 'application/json'))
        .catch((e) => send(res, e.status || 500, JSON.stringify({ error: e.status ? e.message : 'The server could not finish that request.' }), 'application/json'));
    }

    // Teach it a machine it has never seen, from that machine's own service manual.
    // Learn a machine from a PHOTOGRAPH of its manual page. Same destination as /api/learn, a
    // different way of getting the characters there.
    if (req.method === 'POST' && url.pathname === '/api/learn-from-photo') {
      return readJson(req)
        .then((body) => read_manual(body))
        .then((r) => send(res, 200, JSON.stringify(r), 'application/json'))
        .catch((e) => send(res, e.status || 500, JSON.stringify({ error: e.status ? e.message : 'The server could not finish that request.' }), 'application/json'));
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
        .catch((e) => send(res, e.status || 400, JSON.stringify({ error: e.status ? e.message : 'That request could not be handled.' }), 'application/json'));
    }

    // ── the diagnosis loop: the device holds the state, the server holds the reasoning ──
    if (req.method === 'POST' && url.pathname.startsWith('/api/diagnosis/')) {
      return readJson(req)
        .then((body) => {
          const step = url.pathname.split('/').pop();

          if (step === 'start') {
            const built = buildSpace({ model: body.model, code: body.code });
            /*
             * Every tier, through one door. `MODELS[model]` skipped ADMITTED, and the optional
             * chaining meant no crash — just a hypothesis space with no tests attached, silently,
             * for every machine reviewed at the bench. A quiet wrong answer beats a loud one only
             * for whoever wrote it.
             */
            // `buildSpace` carries its own tests now, so the web and MCP doors cannot disagree.
            return send(res, 200, JSON.stringify(built), 'application/json');
          }

          if (step === 'next') {
            return send(res, 200, JSON.stringify(nextTest(body)), 'application/json');
          }

          if (step === 'observe') {
            return send(res, 200, JSON.stringify(prune(body)), 'application/json');
          }

          return send(res, 404, JSON.stringify({ error: `no diagnosis step "${step}"` }), 'application/json');
        })
        .catch((e) => send(res, e.status || 400, JSON.stringify({ error: e.status ? e.message : 'That request could not be handled.' }), 'application/json'));
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

    /*
     * "Tell me what it is doing" — the door for machines with no code to read.
     *
     * Current manuals print no fault codes, so for most machines sold now this is the only way in.
     * It returns every candidate rather than one, because a sentence is ambiguous where a code is
     * not — see data/service-data.js.
     */
    if (url.pathname === '/api/describe') {
      const model = url.searchParams.get('model');
      const said = url.searchParams.get('said');
      if (!model || !said) {
        return send(res, 400, JSON.stringify({ error: 'needs a model and what was said' }), 'application/json');
      }
      return send(res, 200, JSON.stringify(lib.lookupSymptom(model, said)), 'application/json');
    }

    /*
     * ── Read a manual, here, now, and admit nothing ──────────────────────────
     *
     * The one capability this project is for, made available to somebody who has only the URL.
     *
     * Until now reading a manual needed `pdftotext`, which is a binary, which is on the machine
     * this was written on and is not on the host. So the hosted review bench has always been
     * empty — a visitor is told "Nothing is waiting" and never sees the thing the whole repository
     * is built around. `manual/pdf-read.js` reads the format itself with no dependencies, which is
     * what makes this route possible at all.
     *
     * It takes the PDF as bytes from the browser rather than a URL to fetch. A server that fetches
     * a URL somebody hands it is a server that can be pointed at the inside of its own network, and
     * a demo is not worth that. The reader supplies the document; nothing here reaches out.
     *
     * And it admits NOTHING. It returns what it read and what it parsed, and the library is
     * untouched — the review bench exists because a machine-read table is a candidate, not a fact,
     * and a route that quietly skipped that step would be removing the only part of this worth
     * copying.
     */
    /*
     * What this endpoint will accept, asked before anything is sent.
     *
     * The host refuses a request body over about four and a half megabytes BEFORE the function
     * runs, so it answers `413 FUNCTION_PAYLOAD_TOO_LARGE` as a plain-text platform page. Half the
     * manuals in this project's own corpus are bigger than that, and dropping one produced a raw
     * platform error with no relation to anything on the page — the worst failure available, since
     * it looks like the feature is broken rather than bounded.
     *
     * So the page asks first and says so itself. The limit lives here, next to the endpoint it
     * describes, rather than being a number typed into a script that drifts from it.
     */
    if (req.method === 'GET' && url.pathname === '/api/read-manual') {
      return send(res, 200, JSON.stringify({
        maxBytes: UPLOAD_LIMIT,
        why:
          'The host refuses a request body larger than this before this function runs, so a bigger ' +
          'manual has to be read where it already is: `node scripts/learn-manual.js <file.pdf>` ' +
          'reads any size, and needs nothing installed either.',
      }), 'application/json');
    }

    /*
     * Read a fault table that was pasted rather than dropped as a PDF.
     *
     * Manufacturers publish their error-code tables as web pages too, and a table copied out of a
     * browser arrives as tab-separated rows — which the reader now understands. Same rule as the
     * PDF path: it is read, shown, and thrown away. Nothing reaches the library from here.
     */
    if (req.method === 'POST' && url.pathname === '/api/read-text') {
      return readJson(req)
        .then((body) => {
          const text = typeof body?.text === 'string' ? body.text : '';
          if (!text.trim()) return send(res, 400, JSON.stringify({ error: 'Paste the fault table as text — nothing was sent.' }), 'application/json');
          if (text.length > 64 * 1024) return send(res, 413, JSON.stringify({ error: `That is ${Math.round(text.length / 1024)} kB of text; paste one fault table, up to 64 kB.` }), 'application/json');
          const started = Date.now();
          const graph = parseManual({ model: 'unknown', text, sourceName: 'what you pasted' });
          const codes = Object.entries(graph.codes || {}).slice(0, 40).map(([code, c]) => ({
            code,
            meaning: c.meaning || '',
            causes: (c.causes || []).slice(0, 8).map((x) => ({
              label: x.label,
              remedy: x.remedy,
              line: x.source?.line ?? null,
              mains: Boolean(x.mains),
            })),
          }));
          return send(res, 200, JSON.stringify({
            ok: true,
            coverage: graph.coverage,
            codes,
            // Codes on the page with nothing an owner can do beneath them — usually "call a technician".
            seen: (graph.orphans || []).slice(0, 40),
            ms: Date.now() - started,
            note: 'Read here and thrown away; nothing was added to the library.',
          }), 'application/json');
        })
        .catch((e) => send(res, e.status || 400, JSON.stringify({ error: e.status ? e.message : 'That request could not be handled.' }), 'application/json'));
    }

    if (req.method === 'POST' && url.pathname === '/api/read-manual') {
      return readBytes(req)
        .then((buf) => {
          // The local server has no platform in front of it, so the same limit is applied here —
          // otherwise a manual that works on a laptop fails on the URL, which is the worst way to
          // find out about a limit.
          if (buf.length > UPLOAD_LIMIT) {
            return send(res, 413, JSON.stringify({
              error: `That manual is ${(buf.length / 1024 / 1024).toFixed(1)} MB, and this endpoint accepts ${(UPLOAD_LIMIT / 1024 / 1024).toFixed(0)} MB.`,
              maxBytes: UPLOAD_LIMIT,
              instead: 'node scripts/learn-manual.js <file.pdf> reads any size, and needs nothing installed either.',
            }), 'application/json');
          }
          if (buf.length < 5 || buf.toString('latin1', 0, 5) !== '%PDF-') {
            return send(res, 400, JSON.stringify({
              error: 'that is not a PDF',
              read: `${buf.length} bytes, beginning ${JSON.stringify(buf.toString('latin1', 0, 8))}`,
            }), 'application/json');
          }

          const started = Date.now();
          let pages;
          let reader;
          let capped = 0;
          try {
            ({ pages, reader, capped = 0 } = pdf.read(buf));
          } catch (e) {
            return send(res, 200, JSON.stringify({
              ok: false,
              reader: pdf.reader(),
              refused: e.code === 'ENCRYPTED'
                ? 'the document is encrypted, so the text in it cannot be read without the password'
                : `the document could not be parsed: ${e.message}`,
            }), 'application/json');
          }

          const withText = pages.filter((p) => p.trim().length > 40).length;
          if (!withText) {
            /*
             * A scan. Every page is a picture of a page, and there is nothing here to read — which
             * is a different answer from "no fault table", and the two need opposite things from
             * whoever is holding the manual.
             */
            return send(res, 200, JSON.stringify({
              ok: false,
              reader,
              pages: pages.length,
              capped,
              /*
               * Two refusals, and they need opposite things from whoever is holding the manual.
               *
               * A scan has no text in it and the answer is a camera. A document whose streams were
               * refused for decompressing to more than this reader will allocate is not a scan, and
               * photographing it would find nothing — it was reported as one until a 0.88 MB file
               * that inflates to 900 MB came back as "this is a scan, use the camera".
               */
              refused: capped
                ? `${capped} stream${capped === 1 ? '' : 's'} in this document ` +
                  `decompress${capped === 1 ? 'es' : ''} to more ` +
                  'than this reader will allocate, so they were not read. That is a guard against a ' +
                  'small file costing a server a gigabyte, not a judgement about the manual — ' +
                  '`node scripts/learn-manual.js <file.pdf>` has the whole machine to work in.'
                : 'this document has no text layer — it is a scan. Reading it needs the ' +
                  'camera path (read_manual), which photographs the page and asks a vision model.',
            }), 'application/json');
          }

          const { candidates } = pdf.faultTablePages(buf);
          const found = candidates.map((c) => {
            const symptoms = readSymptoms({ text: c.text, sourceName: 'the manual you supplied', page: c.page });
            const codes = parseManual({ model: 'unknown', text: c.text, sourceName: 'the manual you supplied' });
            return {
              page: c.page,
              score: c.score,
              text: c.text.slice(0, 6000),
              symptoms: (symptoms.symptoms || []).slice(0, 12).map((s) => ({
                symptom: s.symptom,
                causes: (s.causes || []).slice(0, 4).map((x) => ({
                  label: x.label,
                  page: x.source?.page ?? c.page,
                  remedies: (x.remedies || []).slice(0, 3),
                })),
              })),
              coverage: symptoms.coverage,
              codes: Object.keys(codes.codes || {}).slice(0, 20),
              refused: codes.refused || null,
            };
          });

          /*
           * Best first, where "best" is how much of it actually came out.
           *
           * Candidates are ranked by how much a page LOOKS like a fault table, which is the right
           * way to choose what to read and the wrong way to choose what to show. One oven manual's
           * page of default settings scored higher than its real fault table, so the page a reader
           * was shown parsed to nothing and the bench reported "no column header on this page" —
           * true of the page it picked, false of the manual, which has a fault table on the next
           * two.
           */
          found.sort((a, b) => b.symptoms.length - a.symptoms.length || b.score - a.score);

          return send(res, 200, JSON.stringify({
            ok: true,
            reader,
            pages: pages.length,
            withText,
            ms: Date.now() - started,
            found: found.slice(0, 4),
            /*
             * Why nothing came out, when nothing came out. A page that scored as a table and parsed
             * to nothing is a different answer from a manual with no table in it, and the parser
             * already says which — it just had nowhere to say it.
             */
            why: found.some((f) => f.symptoms.length) ? null : (found[0]?.coverage ?? 'no page in this manual scored as a fault table'),
            // Said plainly, because it is the part people assume is not true.
            admitted: false,
            note: 'Nothing here has been added to the library. A machine-read table is a candidate; '
              + 'the review bench is where a person turns one into a fact.',
          }), 'application/json');
        })
        .catch((e) => send(res, e.status || 400, JSON.stringify({ error: e.status ? e.message : 'That request could not be handled.' }), 'application/json'));
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

    /*
     * What the library actually holds, by how it came to hold it.
     *
     * The three tiers are reported separately rather than summed. A machine somebody wrote out by
     * hand, one a model read and a person checked, and one a model read that nobody has looked at
     * are three different kinds of fact, and a single "5 machines known" would be the most
     * flattering way to say it and the least true.
     *
     * `codes` and `codesWithCauses` are also kept apart. Several models here carry a fault code for
     * breadth with its causes deliberately not filled in — the library knows the code exists and
     * what it means, and has nothing to say about why. Counting those as coverage would be exactly
     * the overclaim this product is built to avoid.
     */
    /*
     * What this household remembers.
     *
     * `data/home.json` is somebody's home — which machines they own, what has broken, what they
     * paid — so it is gitignored and kept out of every deploy. A hosted page therefore has nothing
     * of its own to show, and falls back to a household built by `scripts/make-home-demo.js`,
     * which carries `demo: true` in the file itself so nothing downstream has to remember to
     * label it.
     *
     * The arithmetic is done live either way: what is overdue and what has come back are computed
     * from the receipts by `home.js`, not stored.
     */
    if (url.pathname === '/api/household') return (async () => {
      const home = require('./mcp/tools/home');
      let state = null;
      let demo = false;

      // The shared store first, where a deployment has one — the same house the tools read and
      // write — then the file, then the demo household.
      const store = require('./mcp/server').activeHouseholdStore();
      if (store) {
        try { state = await store.load(); } catch { state = null; }
      }
      if (!state) {
        try {
          state = JSON.parse(fs.readFileSync(home.STORE, 'utf8'));
        } catch {
          state = null;
        }
      }

      // The demo only when there is nothing at all: a house with repairs and no appliance recorded
      // is still a real house (remember_repair records the repair, not the machine).
      if (!state || (!Object.keys(state.appliances || {}).length && !(state.receipts || []).length)) {
        try {
          state = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'home-demo.json'), 'utf8'));
          demo = true;
        } catch {
          return send(res, 200, JSON.stringify({ known: false, demo: false,
            reason: 'Nothing has been remembered on this machine yet.' }), 'application/json');
        }
      }

      // The arithmetic runs over whichever household this is — `due` takes the state rather than
      // reading the file, so the demo and the real one go through the same code.
      const attention = home.due({ state });

      return send(res, 200, JSON.stringify({
        known: true,
        // `demo` is what the reader is told: this house is made up. `fallback` is narrower — the
        // made-up house is being SHOWN because nothing is recorded here, so the tools do not have
        // it, and a screen that offered its rows as things to ask about would be promising a
        // history the agent cannot find. A seeded demo (npm run home:demo) is demo but not fallback.
        demo: demo || state.demo === true,
        fallback: demo,
        describes: state.describes || null,
        appliances: Object.values(state.appliances || {}),
        receipts: state.receipts || [],
        due: attention.due,
        recurring: attention.recurring,
        // A repair left half-way whose part was due by now — the first thing the screen should say.
        resumable: attention.resumable,
      }), 'application/json');
    })();

    if (url.pathname === '/api/library') {
      const lib = require('./data/service-data');
      const HAND = lib.MODELS;
      const CHECKED = lib.admittedNow();
      const UNCHECKED = lib.LEARNED;

      const describe = (model, rec, tier) => {
        const codes = Object.values(rec.codes || {});
        const symptoms = rec.symptoms || [];
        return {
          model,
          brand: rec.brand || 'Unknown',
          kind: rec.kind || null,
          tier,
          /*
           * Codes and symptoms counted separately, because they are answered by different
           * questions — one by reading a panel, the other by describing what is happening. Summing
           * them into "10 things known" would hide which question a machine can answer.
           */
          codes: codes.length,
          symptoms: symptoms.length,
          // Named for what it counts. It was `codesWithCauses` and then started counting symptoms
          // too, which made it larger than the number of codes — a field whose name had quietly
          // stopped being true.
          withCauses:
            codes.filter((c) => (c.causes || []).length).length +
            symptoms.filter((s) => (s.causes || []).length).length,
          causes:
            codes.reduce((n, c) => n + (c.causes || []).length, 0) +
            symptoms.reduce((n, s) => n + (s.causes || []).length, 0),
          source: rec.source || null,
          rejected: rec.rejected || [],
          reviewedBy: rec.reviewedBy || null,
        };
      };

      const machines = [
        ...Object.entries(HAND).map(([m, r]) => describe(m, r, 'hand')),
        ...Object.entries(CHECKED).map(([m, r]) => describe(m, r, 'checked')),
        ...Object.entries(UNCHECKED).map(([m, r]) => describe(m, r, 'unchecked')),
      ].sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));

      return send(res, 200, JSON.stringify({
        machines,
        totals: {
          machines: machines.length,
          hand: machines.filter((m) => m.tier === 'hand').length,
          checked: machines.filter((m) => m.tier === 'checked').length,
          unchecked: machines.filter((m) => m.tier === 'unchecked').length,
          codes: machines.reduce((n, m) => n + m.codes, 0),
          symptoms: machines.reduce((n, m) => n + m.symptoms, 0),
          withCauses: machines.reduce((n, m) => n + m.withCauses, 0),
          causes: machines.reduce((n, m) => n + m.causes, 0),
          rejected: machines.reduce((n, m) => n + m.rejected.length, 0),
        },
      }), 'application/json');
    }

    if (req.method === 'POST' && url.pathname === '/api/review/admit') {
      return readJson(req)
        .then((body) => {
          const accept = Array.isArray(body.accept) ? body.accept : [];
          const result = review.admit(body.model, accept, body.by || 'unattributed');
          // The library is read once at startup. Something just added to it, so read it again —
          // otherwise the screen that admits machines and the screen that lists them disagree.
          if (result.admitted) require('./data/service-data').reload();
          return send(res, result.admitted ? 200 : 400, JSON.stringify(result), 'application/json');
        })
        .catch((e) => send(res, e.status || 400, JSON.stringify({ error: e.status ? e.message : 'That request could not be handled.' }), 'application/json'));
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));

    /*
     * Each root in turn. A path that climbs out of the root it was resolved against is refused
     * rather than tried against the next one — `../server.js` must not become a miss that falls
     * through to somewhere it does happen to exist.
     */
    const tryRoot = (i) => {
      if (i >= ROOTS.length) return send(res, 404, 'not found', 'text/plain');
      const root = ROOTS[i];
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) return send(res, 403, 'no', 'text/plain');
      fs.readFile(file, (err, buf) => {
        if (err) return tryRoot(i + 1);
        send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
      });
    };
    tryRoot(0);
}

module.exports = handler;
module.exports.handler = handler;

// Only listen when run directly. Imported — by a host, or by a test — this is just a function.
if (require.main === module) {
  http.createServer(handler).listen(PORT, () => console.log(`owl  http://localhost:${PORT}`));
}
