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
    const payload = text.includes('data: ') ? text.split(/\n/).filter((l) => l.startsWith('data: ')).pop().slice(6) : text;
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

module.exports = { McpClient, PROTOCOL };
