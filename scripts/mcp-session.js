#!/usr/bin/env node
/**
 * A real MCP session, end to end, in one command.
 *
 *   npm run mcp:session
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The Alexa+ track asks for a self-hosted MCP server over Streamable HTTP, and until now the only
 * way to check that claim was to start the server and hand-write JSON-RPC at it with curl. A
 * reviewer should not have to do that to find out whether the thing works.
 *
 * So this starts `mcp/server.js`, speaks the protocol to it properly — initialize, the initialized
 * notification, tools/list, resources/list, then a sequence of real tool calls that walks one
 * repair from a sentence somebody said out loud to a decision about spending money — and prints
 * what came back. Nothing is mocked. It is the same server an Alexa+ skill would connect to, on
 * the same transport, answering the same calls.
 *
 * It ends on the refusal, deliberately. The interesting thing about this server is not that it can
 * answer; it is what it does when it cannot.
 */

const { spawn } = require('node:child_process');

const PORT = Number(process.env.MCP_SESSION_PORT) || 8795;
const URL = `http://127.0.0.1:${PORT}/mcp`;
const PROTOCOL = '2025-11-25';

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', amber: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', amber: '', green: '', bold: '', off: '' };

const rule = () => console.log(`${C.dim}${'─'.repeat(78)}${C.off}`);

let id = 0;
let sessionId = null;

async function rpc(method, params) {
  const headers = {
    'content-type': 'application/json',
    // Both, because the spec allows a server to answer either way and a client that only accepts
    // one of them is a client that works until the day the server streams.
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
  const notification = method.startsWith('notifications/');
  if (!notification) body.id = ++id;

  const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const got = res.headers.get('mcp-session-id');
  if (got) sessionId = got;

  if (notification || res.status === 202) return null;

  const text = await res.text();
  // Streamable HTTP may answer as an SSE frame or as plain JSON. Accept either.
  const payload = text.includes('data: ') ? text.split('data: ').pop().trim() : text;

  let out;
  try {
    out = JSON.parse(payload);
  } catch {
    throw new Error(`${method}: could not read the reply — ${text.slice(0, 120)}`);
  }
  if (out.error) throw new Error(`${method}: ${out.error.message}`);
  return out.result;
}

/** A tool's answer, which arrives as text that happens to be JSON. */
async function call(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r?.content?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const say = (label, value) => console.log(`  ${C.dim}${label.padEnd(13)}${C.off}${value}`);

(async () => {
  const server = spawn(process.execPath, [require.resolve('../mcp/server.js')], {
    env: { ...process.env, MCP_PORT: String(PORT) },
    stdio: 'ignore',
  });
  const stop = () => server.kill();
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });

  // Wait for it to answer rather than sleeping a guess.
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  rule();
  console.log(`${C.bold}A REAL MCP SESSION${C.off}  ${C.dim}Streamable HTTP · spec ${PROTOCOL} · nothing mocked${C.off}`);
  rule();

  const init = await rpc('initialize', {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'mcp-session', version: '1' },
  });
  await rpc('notifications/initialized');

  console.log(`\n${C.bold}1 · the handshake${C.off}\n`);
  say('server', `${init.serverInfo?.name} ${init.serverInfo?.version || ''}`);
  say('protocol', init.protocolVersion);
  say('capabilities', Object.keys(init.capabilities || {}).join(', ') || 'none');

  const { tools } = await rpc('tools/list');
  const resources = await rpc('resources/list').catch(() => ({ resources: [] }));
  say('tools', `${tools.length} registered`);
  say('resources', `${(resources.resources || []).length} cards`);

  /* ── the sentence somebody actually says ─────────────────────────────── */

  rule();
  console.log(`${C.bold}2 · what the machine is doing, in their words${C.off}`);
  console.log(`${C.dim}   Most manuals sold now print no fault codes — the way in is a sentence.${C.off}\n`);

  const said = 'there is water left in the bottom at the end of the program';
  say('asked', `"${said}"`);
  const described = await call('describe_problem', { model: 'SGE53C55UC', said });

  if (described.known) {
    const m = described.matches[0];
    say('the manual', `"${m.symptom}"`);
    for (const c of m.causes.slice(0, 2)) {
      console.log(`  ${C.dim}${String(Math.round(c.likelihood * 100) + '%').padStart(13)}${C.off} ${c.label}`);
      console.log(`  ${' '.repeat(13)}${C.amber}${(c.source?.manual || '')}, page ${c.source?.page}${C.off}`);
    }
  }

  /* ── and the one it has never heard of ───────────────────────────────── */

  console.log();
  const absent = 'there is a burning smell';
  say('asked', `"${absent}"`);
  const refused = await call('describe_problem', { model: 'SGE53C55UC', said: absent });
  console.log(`  ${C.red}${' '.repeat(13)}${refused.reason}${C.off}`);

  /* ── a code, narrowed, and the gate ──────────────────────────────────── */

  rule();
  console.log(`${C.bold}3 · a fault code, narrowed${C.off}\n`);

  const diagnosis = await call('diagnose', { model: 'SHE3AR75UC', code: 'E24' });
  say('E24 means', diagnosis.meaning || diagnosis.code);
  for (const c of (diagnosis.causes || []).slice(0, 3)) {
    console.log(`  ${C.dim}${String(Math.round(c.likelihood * 100) + '%').padStart(13)}${C.off} ${c.label}`);
  }

  console.log();
  const upheld = await call('verify_diagnosis', { model: 'SHE3AR75UC', code: 'E24' });
  say('verdict', upheld.upheld ? `${C.green}upheld${C.off}` : `${C.amber}abstain${C.off}`);
  say('may spend', String(upheld.maySpend ?? false));
  if (upheld.reason) say('because', upheld.reason);

  /* ── the refusal, which is the point ─────────────────────────────────── */

  rule();
  console.log(`${C.bold}4 · the one function allowed to spend money${C.off}`);
  console.log(`${C.dim}   Asked to open a cart for a cause the gate did not uphold.${C.off}\n`);

  const cart = await call('begin_checkout', {
    model: 'SHE3AR75UC',
    code: 'E24',
    causeId: 'pump',
  });
  const refusedCart = cart?.opened === false || cart?.error || cart?.refused;
  say('cart', refusedCart ? `${C.red}refused${C.off}` : `${C.green}opened${C.off}`);
  say('said', cart?.reason || cart?.error || JSON.stringify(cart).slice(0, 90));

  rule();
  console.log(
    `${C.dim}Every line above came back from a tool call over Streamable HTTP. The server is\n` +
      `mcp/server.js; \`npm test\` runs every check behind it.${C.off}`
  );
  rule();

  stop();
  setTimeout(() => process.exit(0), 100);
})().catch((e) => {
  console.error(`\n  ${C.red}${e.message}${C.off}\n`);
  process.exit(1);
});
