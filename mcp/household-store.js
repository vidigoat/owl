/**
 * The household, kept where every instance of a deployment can see it.
 *
 * mcp/tools/home.js keeps the house in a file, which is right on a laptop and impossible on the
 * hosted server: its bundle is read-only, so a repair was held for one conversation and gone after
 * it. Alexa+ is meant to remember across sessions — "this E24 is back; last time it was the pump" —
 * so on a deployment the house lives in the same DynamoDB table as the spend ledger
 * (mcp/shared-budget.js), as a second item, written with the same signed UpdateItem the setup script
 * already permits. Nothing new to provision.
 *
 * One house for the whole deployment: this server has no accounts to tell visitors apart, so on the
 * public demo everyone shares it, and the privacy page says so. Per-customer households need the
 * identity Alexa+ supplies; the item id is the one place that would change.
 *
 * Two instances can both hold the house. A save carries the version it was loaded at, and DynamoDB
 * refuses it if another instance saved in between; then the other side is loaded, the two are
 * merged — receipts are append-only, so a merge is a union — and the save is tried again.
 */

const { sign } = require('../agent/sigv4');

const ID = 'household';
const MAX_RECEIPTS = 500; // an item is capped at 400 KB; a house with more repairs than this is a shop

class HouseholdStore {
  constructor({ table, creds, region = 'us-east-1', fetchImpl = globalThis.fetch }) {
    if (!table) throw new Error('A household store needs a table.');
    Object.assign(this, { table, creds, region, fetchImpl, version: 0 });
  }

  async call(action, body) {
    const url = `https://dynamodb.${this.region}.amazonaws.com/`;
    const payload = JSON.stringify({ TableName: this.table, Key: { id: { S: ID } }, ...body });
    const { headers } = sign(
      { method: 'POST', url, headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': `DynamoDB_20120810.${action}` }, body: payload },
      this.creds,
      { region: this.region, service: 'dynamodb' }
    );
    const res = await this.fetchImpl(url, { method: 'POST', headers, body: payload });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text || '{}'); } catch { /* reported below */ }
    if (res.ok) return json;
    if (String(json.__type || '').endsWith('ConditionalCheckFailedException')) return { conflict: true };
    // What AWS says goes to the log; it names the account.
    console.error(`household-store: dynamodb ${res.status}: ${String(json.message || text).slice(0, 200)}`);
    throw new Error('The household could not be read or written.');
  }

  /** The house as last saved, or an empty one. */
  async load() {
    const r = await this.call('GetItem', { ConsistentRead: true });
    this.version = Number(r.Item?.version?.N ?? 0);
    try {
      const state = JSON.parse(r.Item?.state?.S || 'null');
      if (state && typeof state === 'object' && state.appliances && Array.isArray(state.receipts)) return state;
    } catch { /* an unreadable item is treated as empty, and the next save replaces it */ }
    return { appliances: {}, receipts: [] };
  }

  /** Save, or merge with whoever saved first and save that. Returns the state that was stored. */
  async save(state, attempts = 3) {
    let mine = state;
    for (let i = 0; i < attempts; i++) {
      const trimmed = { ...mine, receipts: mine.receipts.slice(-MAX_RECEIPTS) };
      const r = await this.call('UpdateItem', {
        UpdateExpression: 'SET #s = :s, version = :next',
        ConditionExpression: 'attribute_not_exists(version) OR version = :v',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':s': { S: JSON.stringify(trimmed) }, ':v': { N: String(this.version) }, ':next': { N: String(this.version + 1) } },
      });
      if (!r.conflict) { this.version += 1; return trimmed; }
      mine = merge(await this.load(), mine);
    }
    throw new Error('The household changed under every attempt to save it.');
  }
}

const receiptKey = (r) => `${r.model}|${r.code}|${r.at}|${r.action}|${r.cause}`;

/** Theirs and mine: every appliance, every receipt once, in time order. */
function merge(theirs, mine) {
  const seen = new Set();
  const receipts = [...theirs.receipts, ...mine.receipts]
    .filter((r) => { const k = receiptKey(r); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { ...theirs, ...mine, appliances: { ...theirs.appliances, ...mine.appliances }, receipts };
}

module.exports = { HouseholdStore, merge };
