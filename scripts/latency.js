#!/usr/bin/env node
/**
 * How fast is a tool call? Measured, and split into the part this server owns and the part it does not.
 *
 *   npm run latency                                   against a local server
 *   npm run latency -- --url https://owl-repair.vercel.app/mcp --from "Pune, India"
 *
 * Alexa+ asks for a round trip under 500 ms. The orchestrator cannot be called by entrants, so
 * that exact figure cannot be taken (docs/FRICTION-LOG.md). Two can:
 *
 *   server   the time the tool took, from the `Server-Timing` header /mcp sends with every answer
 *   round    the whole HTTP round trip from wherever this runs — which is not where Alexa+ runs,
 *            so it is reported with where it was measured from, and never as the requirement
 *
 * Each tool the agent uses is called 20 times after a warm-up call, over one MCP session. The run
 * records itself in docs/latency.json.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const at = args.indexOf('--url');
const N = 20;

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main() {
  let url = at > -1 ? args[at + 1] : null;
  let server = null;
  if (!url) {
    const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'latency-')), 'home.json');
    server = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], { env: { ...process.env, MCP_PORT: '8796', HOME_STORE: home }, stdio: 'ignore' });
    process.on('exit', () => server.kill());
    url = 'http://127.0.0.1:8796/mcp';
    for (let i = 0; i < 60; i++) { try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  }

  let session = null;
  let id = 0;
  const rpc = async (method, params) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (session) headers['mcp-session-id'] = session;
    const t0 = performance.now();
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const body = await res.json();
    const round = performance.now() - t0;
    session = res.headers.get('mcp-session-id') || session;
    const st = /dur=([\d.]+)/.exec(res.headers.get('server-timing') || '');
    return { body, round, server: st ? Number(st[1]) : null };
  };

  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'latency', version: '1' } });
  const h = (await rpc('tools/call', { name: 'hypotheses', arguments: { model: 'SHE3AR75UC', code: 'E24' } })).body.result.structuredContent;
  const CALLS = [
    ['hypotheses', { model: 'SHE3AR75UC', code: 'E24' }],
    ['next_test', { model: 'SHE3AR75UC', code: 'E24', space: h.space, tests: h.tests }],
    ['observe', { model: 'SHE3AR75UC', code: 'E24', space: h.space, tests: h.tests, testId: 'pump-hum', value: 'silent' }],
    ['verify_diagnosis', { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: ['filter', 'hose'] }],
    ['describe_problem', { model: 'SGE53C55UC', said: 'water is left at the end of the program' }],
    ['guide', { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump' }],
    ['find_part', { model: 'SHE3AR75UC', causeId: 'pump' }],
    ['begin_checkout', { model: 'SHE3AR75UC', code: 'E24', causeId: 'pump', ruledOut: ['filter', 'hose'] }],
  ];

  console.log(`\n  tool latency · ${url}\n  ${N} calls each after a warm-up · server = Server-Timing, round = HTTP from this machine\n`);
  const rows = [];
  for (const [name, a] of CALLS) {
    await rpc('tools/call', { name, arguments: a });
    const s = [];
    const r = [];
    for (let i = 0; i < N; i++) {
      const x = await rpc('tools/call', { name, arguments: a });
      if (x.body.error) throw new Error(`${name}: ${x.body.error.message}`);
      if (x.server != null) s.push(x.server);
      r.push(x.round);
    }
    const row = { tool: name, serverP50: s.length ? pct(s, 50) : null, serverP95: s.length ? pct(s, 95) : null, roundP50: pct(r, 50), roundP95: pct(r, 95) };
    rows.push(row);
    const f = (v) => (v == null ? '   —' : `${v.toFixed(1).padStart(6)}`);
    console.log(`  ${name.padEnd(18)} server p50 ${f(row.serverP50)} ms  p95 ${f(row.serverP95)} ms   round p50 ${f(row.roundP50)} ms  p95 ${f(row.roundP95)} ms`);
  }

  const worstServer = Math.max(...rows.map((x) => x.serverP95 ?? 0));
  const worstRound = Math.max(...rows.map((x) => x.roundP95));
  console.log(`\n  slowest tool, p95: ${worstServer.toFixed(1)} ms on the server · ${worstRound.toFixed(0)} ms round trip from here\n`);

  if (at > -1) {
    // Where it was measured from is said by whoever ran it (--from), never looked up: unknown stays null.
    const fi = args.indexOf('--from');
    const from = fi > -1 ? args[fi + 1] : null;
    fs.writeFileSync(path.join(ROOT, 'docs', 'latency.json'), `${JSON.stringify({
      measured: new Date().toISOString().slice(0, 10), url, calls: N, measuredFrom: from,
      worstServerP95Ms: Number(worstServer.toFixed(1)), worstRoundP95Ms: Math.round(worstRound), tools: rows,
    }, null, 2)}\n`);
    console.log('  recorded in docs/latency.json\n');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
