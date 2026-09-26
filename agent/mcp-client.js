/**
 * An MCP client, over Streamable HTTP — the side Alexa+ plays.
 *
 * ── Why the agent talks MCP to its own server ───────────────────────────────
 *
 * The simulated Alexa+ in this repository could call the tool functions directly; they are in the
 * same process. It deliberately does not. It connects to the MCP server at a URL, does the
 * handshake, lists the tools, and calls them over HTTP, exactly as a real Alexa+ connector would —
 * which means the thing a judge watches is the thing that ships: swap this simulator for the real
 * Alexa+ and the server does not change by a line.
 *
 * It is also the only honest test of the server. Our own front end calls tools the way its author
 * expected them to be called; a model does not. Driving the server from a model, over the wire, is
 * what found that `next_test` could not be called by anything but this project's front end.
 *
 * Both response shapes the spec allows are accepted — plain JSON and a single SSE event — because a
 * client that only reads one of them works right up until a server chooses the other.
 */

const PROTOCOL = '2025-11-25';

class McpClient {
  constructor(url, { fetchImpl = globalThis.fetch, name = 'simulated-alexa-plus', version = '1.0.0' } = {}) {
    this.url = url;
    this.fetch = fetchImpl;
    this.clientInfo = { name, version };
    this.session = null;
    this.nextId = 1;
    this.tools = [];
  }

  async send(method, params, { notification = false } = {}) {
    const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
    if (!notification) body.id = this.nextId++;

    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
    };
    if (this.session) headers['mcp-session-id'] = this.session;

    const res = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body) });
    const sid = res.headers?.get?.('mcp-session-id');
    if (sid) this.session = sid;

    if (notification) {
      // The spec answers a notification with 202 and nothing else. Anything else is the server's
      // problem to report, not ours to parse.
      if (res.status !== 202 && res.status !== 200) throw new Error(`${method}: HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 160)}`);
    // An event stream is lines that START with "data: ". Testing for the substring anywhere broke
    // the whole client the day a tool's description mentioned "a data: URL" — the tool list is
    // JSON, and JSON may say anything.
    const events = text.split(/\r?\n/).filter((l) => l.startsWith('data: '));
    const payload = events.length ? events.pop().slice(6) : text;
    let out;
    try {
      out = JSON.parse(payload);
    } catch {
      throw new Error(`${method}: the server did not answer with JSON-RPC — ${text.slice(0, 120)}`);
    }
    if (out.error) throw new Error(`${method}: ${out.error.message}`);
    return out.result;
  }

  async connect() {
    const init = await this.send('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: this.clientInfo,
    });
    await this.send('notifications/initialized', null, { notification: true });
    this.server = init.serverInfo;
    this.protocol = init.protocolVersion;
    const { tools } = await this.send('tools/list');
    this.tools = tools;
    return init;
  }

  /** A tool's answer. Tools here answer with one text block that is JSON; anything else is kept as text. */
  async call(name, args) {
    const r = await this.send('tools/call', { name, arguments: args || {} });
    const text = (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
    return { value, isError: Boolean(r?.isError), raw: r };
  }
}

/**
 * The same protocol, without the network: a `fetch` that hands each JSON-RPC message to this
 * project's own MCP handler in-process.
 *
 * For the live agent behind /api/alexa. The alternative was the server making HTTP calls to its
 * own public URL — a round trip across the internet to reach code in the same process, and on a
 * host with more than one instance, possibly a different process. Everything above the transport
 * is identical: the handshake, the session id, tools/list, every tools/call, spoken as JSON-RPC.
 */
function inProcess() {
  const { handle } = require('../mcp/server');
  let session = null;
  return async (_url, init) => {
    const msg = JSON.parse(init.body);
    const out = await handle(msg);
    if (msg.method === 'initialize') session = require('node:crypto').randomUUID();
    const headers = new Headers({ 'content-type': 'application/json', ...(session ? { 'mcp-session-id': session } : {}) });
    return out === null ? new Response(null, { status: 202, headers }) : new Response(JSON.stringify(out), { status: 200, headers });
  };
}

module.exports = { McpClient, PROTOCOL, inProcess };
