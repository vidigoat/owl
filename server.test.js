/**
 * The server, as something a host can run.
 *
 *   node server.test.js
 *
 * This project needs a URL. The Alexa+ track wants a self-hosted MCP server reachable over
 * Streamable HTTP, and the demo everybody actually clicks is a web page — and until now neither was
 * possible, because the whole server was an anonymous callback inside
 * `http.createServer(...).listen()`. The only way to run this project was to run this process.
 *
 * Three failures worth a test each, all of them invisible on a laptop and total once hosted:
 *
 *   the handler must be a function   A host imports the module and calls it. If importing binds a
 *                                    port instead, the deployment hangs or the port fight kills it.
 *   the hosted copy must be THE copy `api/index.js` re-exports `server.js`. A second copy adapted
 *                                    for a host is how a demo URL quietly stops showing what the
 *                                    repository does, and nobody decides that it should.
 *   what it reads must ship          Vercel traces what a function requires. It cannot see
 *                                    `fs.readFile(path.join(PUBLIC, rel))`, so every directory read
 *                                    at runtime has to be named in `includeFiles` or it is simply
 *                                    absent, and the page 404s on its own stylesheet.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const zlib = require('node:zlib');

const PORT = 8795;
const BASE = `http://localhost:${PORT}`;

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

const get = (p) => fetch(`${BASE}${p}`);

/**
 * A one-page manual with a real fault table in it.
 *
 * Built here rather than read from `manuals/`, which is gitignored: a check that only runs on the
 * machine that happens to have the PDFs is a check that does not run. The page is laid out at real
 * coordinates because the thing being tested is whether the columns survive the round trip.
 */
function faultTablePdf({ rows } = {}) {
  const zlib = require('node:zlib');
  /*
   * Long enough to actually score as a fault table.
   *
   * `scorePage` wants eighteen points and gets them from SHAPE — columnar lines and remedy verbs —
   * rather than from the word "troubleshooting", which is the whole reason it can find a table in a
   * manual that never uses the word. A four-row fixture scored eleven and was correctly ignored,
   * which is the page-finder working and the fixture being unrealistic.
   */
  const table = rows || [
    [72, 740, 'Troubleshooting'],
    [72, 720, 'Fault'], [270, 720, 'Cause and troubleshooting'],
    [72, 700, 'Water is left in the'], [270, 700, 'Filter system or area under the filters'],
    [72, 688, 'appliance.'], [270, 688, 'is blocked.'],
    [286, 674, 'Clean the filters.'],
    [270, 660, 'The drain pump is blocked.'],
    [286, 646, 'Clean the drain pump.'],
    [72, 628, 'Appliance does not'], [270, 628, 'The breaker has tripped.'],
    [72, 616, 'start.'], [286, 602, 'Switch on the circuit breaker.'],
    [270, 588, 'The door is not closed.'],
    [286, 574, 'Close the door firmly.'],
    [72, 556, 'The dishes are not'], [270, 556, 'The rinse aid is empty.'],
    [72, 544, 'drying.'], [286, 530, 'Refill the rinse aid.'],
    [270, 516, 'The wrong programme was selected.'],
    [286, 502, 'Select a programme with drying.'],
    [72, 484, 'Excessive foam in the'], [270, 484, 'Washing-up liquid was used.'],
    [72, 472, 'appliance.'], [286, 458, 'Clean the interior with a cloth.'],
    [270, 444, 'Too much rinse aid was dispensed.'],
    [286, 430, 'Reduce the rinse aid setting.'],
    [72, 412, 'The appliance stops'], [270, 412, 'The power supply was interrupted.'],
    [72, 400, 'during a programme.'], [286, 386, 'Check the fuse box.'],
    [270, 372, 'The water supply is turned off.'],
    [286, 358, 'Turn on the tap and check the hose.'],
  ];
  const content = table
    .map(([x, y, t]) => `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${t.replace(/([()\\])/g, '\\$1')}) Tj ET`)
    .join('\n');
  return buildPdf(zlib.deflateSync(Buffer.from(content, 'latin1')), true);
}

/** A PDF whose page has no text at all: a scan, as far as any text reader can tell. */
function emptyPdf() {
  return buildPdf(Buffer.from('q 1 0 0 1 0 0 cm Q', 'latin1'), false);
}

function buildPdf(stream, compressed) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    { dict: `<< /Length ${stream.length}${compressed ? ' /Filter /FlateDecode' : ''} >>`, stream },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 ' +
      `/Widths [${Array.from({ length: 95 }, (_, i) => (i === 0 ? 278 : 556)).join(' ')}] >>`,
  ];

  let out = '%PDF-1.4\n';
  const at = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n`;
    out += typeof o === 'string'
      ? `${o}\nendobj\n`
      : `${o.dict}\nstream\n${o.stream.toString('latin1')}\nendstream\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const a of at) out += `${String(a).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}



(async () => {
  console.log('the server, as something a host can run');

  /* ── shape ──────────────────────────────────────────────────────────────── */

  await it('importing the server gives you a handler and starts nothing', () => {
    const mod = require('./server');
    assert.equal(typeof mod, 'function', 'server.js no longer exports a request handler');
    assert.equal(typeof mod.handler, 'function');
    assert.equal(mod.length, 2, 'a request handler takes (req, res)');

    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.match(src, /require\.main === module/, 'server.js listens unconditionally on import');
  });

  await it('the hosted entry point is the same handler, not a copy of it', () => {
    // If these ever diverge, the demo URL stops being evidence about this repository.
    assert.equal(require('./api/index'), require('./server'));
  });

  await it('everything the server reads at runtime is in the deployed bundle', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    const included = cfg.functions?.['api/index.js']?.includeFiles || '';
    for (const dir of ['public', 'data']) {
      assert.ok(included.includes(dir), `the server reads ${dir}/ at runtime but vercel.json does not ship it`);
    }
  });

  /* ── it actually answers ────────────────────────────────────────────────── */

  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const stop = () => server.kill();
  process.on('exit', stop);

  for (let i = 0; i < 80; i++) {
    try { if ((await get('/api/library')).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }

  await it('both surfaces are served', async () => {
    // The bench shipped once with nothing linking to it. This is the cheaper version of that
    // lesson: a page that 404s is a page that does not exist.
    for (const p of ['/', '/review.html', '/review.css', '/review.js']) {
      assert.equal((await get(p)).status, 200, `${p} is not served`);
    }
  });

  await it('the library reports its tiers separately, and the totals add up', async () => {
    /*
     * Hand-written, machine-read-and-checked, and machine-read-and-unchecked are three different
     * kinds of fact. A single count would be the most flattering way to say it.
     */
    const lib = await (await get('/api/library')).json();
    const t = lib.totals;
    assert.equal(t.machines, lib.machines.length);
    assert.equal(t.hand + t.checked + t.unchecked, t.machines, 'the tiers do not add up to the total');
    assert.ok(
      t.withCauses <= t.codes + t.symptoms,
      'more entries carry causes than there are entries'
    );
  });

  await it('the review queue answers even with nothing in it', async () => {
    const r = await get('/api/review/queue');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray((await r.json()).pending));
  });

  await it('a candidate is addressed by model, and a path is not a model', async () => {
    // Model numbers are filenames on disk here, so anything that is not one is not a model.
    for (const bad of ['../../etc/passwd', 'a/b', '.']) {
      assert.equal((await get(`/api/review/candidate?model=${encodeURIComponent(bad)}`)).status, 404);
      assert.equal((await get(`/api/review/page?model=${encodeURIComponent(bad)}`)).status, 404);
    }
  });

  await it('an unknown path is a 404, not a crash', async () => {
    assert.equal((await get('/nope')).status, 404);
    assert.equal((await get('/api/nope')).status, 404);
  });

  await it('a deploy cannot carry somebody\'s home off the machine', () => {
    /*
     * This happened on the other project in this pair, and the shape of it applies here with more
     * at stake. A production deploy published a file that was gitignored — every page looked
     * correct, because the only thing wrong was whose data it was.
     *
     * The cause: the Vercel CLI does not read `.gitignore`. Three things in this repository are
     * deliberately not committed and would otherwise be uploaded to a public URL anyway.
     */
    const ignore = path.join(__dirname, '.vercelignore');
    assert.ok(fs.existsSync(ignore), 'without .vercelignore a deploy uploads what .gitignore keeps out');

    const lines = fs.readFileSync(ignore, 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

    // A household's machines and repairs; rendered manufacturer pages; 143MB of manuals.
    for (const kept of ['data/home.json', 'data/pending/', 'manuals/', '.env']) {
      assert.ok(lines.includes(kept), `${kept} is gitignored but a deploy would still publish it`);
    }
  });

  await it('what ships is the parsed library, not the pages it was read from', () => {
    /*
     * `includeFiles: "{public,data}/**"` would put `data/pending/` inside the function bundle.
     * The committed library — short attributed quotations with a citation each — is a different
     * thing from the manufacturer's pages, and only one of them is ours to serve.
     */
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    for (const [name, fn] of Object.entries(cfg.functions || {})) {
      const pattern = (fn.includeFiles || '').replace(/\/\*\*$/, '');
      const inside = pattern.match(/^\{(.*)\}$/);
      const shipped = (inside ? inside[1].split(',') : [pattern]).map((d) => d.trim());
      assert.ok(
        !shipped.includes('data'),
        `${name} ships all of data/, which includes the pending pages and one household's file`
      );
      assert.ok(
        shipped.includes('data/admitted'),
        `${name} does not ship the library, so the hosted copy knows nothing`
      );
    }
  });

  /* ── reading a manual over the wire, which is the whole reason the reader exists ── */

  await it('a manual can be read by somebody who has only the URL', async () => {
    /*
     * Until this route existed, the hosted review bench was permanently empty: reading a manual
     * needed `pdftotext`, which is a binary, which is not on the host. A visitor was told "Nothing
     * is waiting" and never saw the one capability this repository is built around.
     *
     * The PDF is built here rather than read from `manuals/`, which is gitignored — a check that
     * only runs on the machine that has the manuals is a check that does not run.
     */
    const res = await fetch(`${BASE}/api/read-manual`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: faultTablePdf(),
    });
    assert.equal(res.status, 200);
    const out = await res.json();

    assert.equal(out.ok, true, `the manual was refused: ${out.refused || out.error}`);
    assert.equal(out.pages, 1);
    assert.ok(['poppler', 'built-in'].includes(out.reader));

    const page = (out.found || [])[0];
    assert.ok(page, 'no page scored as a fault table');
    const rows = page.symptoms.map((s) => `${s.symptom} :: ${(s.causes[0] || {}).label}`);
    assert.ok(
      rows.some((r) => /Water is left/.test(r) && /filter/i.test(r)),
      `the table came back as: ${JSON.stringify(rows)}`
    );
    assert.equal(page.symptoms[0].causes[0].page, 1, 'a cause came back without the page it is printed on');
  });

  await it('and reads it the way the DEPLOYED server will, with no poppler at all', async () => {
    /*
     * The check above runs against whatever reader this machine has, which here is poppler. The
     * deployment has none, and that difference is the entire reason `manual/pdf-read.js` was
     * written — so proving it on a laptop that has poppler proves the wrong thing.
     *
     * A second server, with the binary reader switched off, answering the same request. If this
     * passes and the one above passes, both halves are real: the one that runs here, and the one a
     * visitor to the URL gets.
     */
    const PORT2 = PORT + 1;
    const hosted = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, PORT: String(PORT2), MANUAL_READER: 'built-in' },
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 80; i++) {
        try { if ((await fetch(`http://localhost:${PORT2}/api/library`)).ok) break; } catch { /* not up */ }
        await new Promise((r) => setTimeout(r, 50));
      }

      const res = await fetch(`http://localhost:${PORT2}/api/read-manual`, {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: faultTablePdf(),
      });
      const out = await res.json();

      assert.equal(out.reader, 'built-in', 'poppler answered on a server told not to use it');
      assert.equal(out.ok, true, `the hosted path refused the manual: ${out.refused}`);
      const rows = (out.found[0]?.symptoms || []).map((s) => `${s.symptom} :: ${(s.causes[0] || {}).label}`);
      assert.ok(
        rows.some((r) => /Water is left/.test(r) && /filter/i.test(r)),
        `with no poppler the table came back as: ${JSON.stringify(rows)}`
      );
    } finally {
      hosted.kill();
    }
  });

  await it('reading a manual adds nothing to the library', async () => {
    /*
     * The review step is the part of this project worth copying, and a route that quietly skipped
     * it would be removing it. So: the library before, the library after, and they are the same.
     */
    const before = await (await get('/api/library')).json();
    const res = await fetch(`${BASE}/api/read-manual`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: faultTablePdf(),
    });
    const out = await res.json();
    const after = await (await get('/api/library')).json();

    assert.equal(out.admitted, false);
    assert.match(out.note, /candidate/i);
    assert.deepEqual(
      (after.machines || []).map((m) => m.model).sort(),
      (before.machines || []).map((m) => m.model).sort(),
      'reading a manual changed the library'
    );
  });

  await it('the upload limit is something the page can ask for, not something it guesses', async () => {
    /*
     * The host refuses a request body over about four and a half megabytes BEFORE this function
     * runs, and answers with a plain-text platform page. Half the manuals in this project's own
     * corpus are bigger than that, so dropping one produced a raw `FUNCTION_PAYLOAD_TOO_LARGE`
     * with no relation to anything on the page — which reads as the feature being broken rather
     * than bounded, and is the worst refusal available.
     *
     * The page asks first. The number has to come from the endpoint it describes, or it drifts.
     */
    const limits = await (await get('/api/read-manual')).json();
    assert.ok(Number.isFinite(limits.maxBytes) && limits.maxBytes > 0);
    assert.match(limits.why, /learn-manual/, 'it does not say what to do with a bigger manual');

    const bench = fs.readFileSync(path.join(__dirname, 'public', 'review.js'), 'utf8');
    assert.match(bench, /\/api\/read-manual/, 'the bench does not ask the endpoint anything');
    assert.doesNotMatch(
      bench.replace(/\/\*[\s\S]*?\*\//g, ''),
      /4\s*\*\s*1024\s*\*\s*1024|4194304/,
      'the bench has the limit typed into it, so it will drift from the endpoint'
    );
  });

  await it('a manual over the limit is refused with the size and what to do instead', async () => {
    const big = Buffer.concat([faultTablePdf(), Buffer.alloc(5 * 1024 * 1024, 0x20)]);
    const res = await fetch(`${BASE}/api/read-manual`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: big,
    });
    assert.equal(res.status, 413);
    const out = await res.json();
    assert.match(out.error, /MB/, 'the refusal does not say how big it was');
    assert.match(out.instead, /learn-manual/, 'the refusal does not say what to do instead');
  });

  await it('something that is not a PDF is told so, rather than parsed', async () => {
    const res = await fetch(`${BASE}/api/read-manual`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('<html><body>not a manual</body></html>'),
    });
    assert.equal(res.status, 400);
    const out = await res.json();
    assert.match(out.error, /not a PDF/i);
  });

  await it('a scan is refused as a scan, not as "no fault table"', async () => {
    /*
     * Two different answers that need opposite things from whoever is holding the manual: one needs
     * a camera, the other needs a different document. Collapsing them into "could not read this" is
     * the failure this project keeps writing tests against.
     */
    const res = await fetch(`${BASE}/api/read-manual`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: emptyPdf(),
    });
    const out = await res.json();
    assert.equal(out.ok, false);
    assert.match(out.refused, /no text layer|scan/i);
    assert.match(out.refused, /read_manual|camera/i, 'it does not say what to do instead');
  });

  await it('a document refused for decompressing too far is not called a scan', async () => {
    /*
     * Two refusals that need opposite things from whoever is holding the manual. A scan has no text
     * in it and the answer is a camera. A document whose streams were refused for decompressing to
     * more than the reader will allocate is not a scan, and photographing it would find nothing.
     *
     * It was reported as one: a 0.88 MB file that inflates to 900 MB came back as "this document
     * has no text layer — it is a scan", which is false and is advice that wastes somebody's time.
     */
    const payload = zlib.deflateSync(Buffer.alloc(100 * 1024 * 1024, 0x20));
    const bomb = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
        `4 0 obj\n<< /Length ${payload.length} /Filter /FlateDecode >>\nstream\n${payload.toString('latin1')}\nendstream\nendobj\n` +
        'trailer\n<< /Root 1 0 R >>\n',
      'latin1'
    );

    const started = Date.now();
    const out = await (await fetch(`${BASE}/api/read-manual`, {
      method: 'POST', headers: { 'content-type': 'application/pdf' }, body: bomb,
    })).json();

    assert.equal(out.ok, false);
    assert.ok(Date.now() - started < 10000, 'the endpoint spent real time on it');
    assert.equal(out.capped, 1, 'the refused stream was not counted');
    assert.match(out.refused, /decompress/i);
    assert.doesNotMatch(out.refused, /scan/i, 'a refused stream was reported as a scan');
    assert.match(out.refused, /learn-manual/, 'it does not say what would read it');

    // And a document that really has no text still gets the camera.
    const scan = await (await fetch(`${BASE}/api/read-manual`, {
      method: 'POST', headers: { 'content-type': 'application/pdf' }, body: emptyPdf(),
    })).json();
    assert.equal(scan.capped, 0);
    assert.match(scan.refused, /scan/i);
  });

  await it('a request body that is valid JSON but is not a request cannot crash a route', async () => {
    /*
     * `JSON.parse` accepts `null`, `[]`, `7` and `"hi"`. Three routes answered a body of `null`
     * with an internal JavaScript message — two of them as a 500 — including
     * `Cannot read properties of null (reading 'model')`, which is a crash leaking out of the
     * process to a client that was merely wrong.
     *
     * Worse: one malformed POST to `/api/remember` wrote a receipt with a non-string part, and
     * every later call to `due()` threw over it. A single bad request permanently broke the
     * household view for a household that had done nothing.
     */
    const routes = ['/api/diagnose', '/api/verify', '/api/checkout/begin', '/api/remember', '/api/confirm'];
    for (const route of routes) {
      for (const body of ['null', '[]', '7', '"hi"', '{"part":{}}', '{"model":[]}']) {
        const res = await fetch(`${BASE}${route}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
        });
        assert.ok(res.status < 500, `${route} answered ${res.status} to a body of ${body}`);
        const text = await res.text();
        assert.doesNotMatch(
          text,
          /Cannot read propert|Cannot destructure|is not a function|undefined is not/,
          `${route} leaked a JavaScript error for a body of ${body}`
        );
      }
      // And the household view still answers afterwards, rather than having been poisoned.
      assert.equal((await get('/api/household')).status, 200, `${route} broke /api/household`);
    }
  });

  await it('the hosted routes keep their own path', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    for (const r of cfg.rewrites || []) {
      assert.ok(
        !/^\/api\/?$/.test(r.destination),
        `the rewrite ${r.source} -> ${r.destination} throws the pathname away before the server sees it`
      );
    }
    assert.ok(
      fs.existsSync(path.join(__dirname, 'api', '[...path].js')),
      'nothing serves /api/<anything> on the deployment'
    );
  });

  stop();
  console.log(`\n${passed} passed`);
})();
