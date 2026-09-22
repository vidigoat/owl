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
