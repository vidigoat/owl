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
const lib = require('./data/service-data');
const { learn } = lib;
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
            /*
             * Every tier, through one door. `MODELS[model]` skipped ADMITTED, and the optional
             * chaining meant no crash — just a hypothesis space with no tests attached, silently,
             * for every machine reviewed at the bench. A quiet wrong answer beats a loud one only
             * for whoever wrote it.
             */
            const fault = lib.machine(body.model)?.codes?.[body.code];
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
    if (url.pathname === '/api/household') {
      const home = require('./mcp/tools/home');
      let state = null;
      let demo = false;

      try {
        state = JSON.parse(fs.readFileSync(home.STORE, 'utf8'));
      } catch {
        state = null;
      }

      if (!state || !Object.keys(state.appliances || {}).length) {
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
        demo,
        describes: state.describes || null,
        appliances: Object.values(state.appliances || {}),
        receipts: state.receipts || [],
        due: attention.due,
        recurring: attention.recurring,
      }), 'application/json');
    }

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
        .catch((e) => send(res, 400, JSON.stringify({ error: e.message }), 'application/json'));
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
  http.createServer(handler).listen(PORT, () => console.log(`second-set-of-hands  http://localhost:${PORT}`));
}
