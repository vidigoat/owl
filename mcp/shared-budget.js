/**
 * The same ceiling as mcp/budget.js, held somewhere every instance of a deployment can see.
 *
 * mcp/budget.js keeps its ledger in a file, which is right on one machine and wrong on a serverless
 * host: each instance gets its own disk, so ten warm instances each believe they have the whole
 * ceiling to spend. A ceiling that multiplies with traffic is not a ceiling.
 *
 * This keeps the ledger as one DynamoDB item, in the same AWS account the Bedrock calls are billed
 * to, signed by agent/sigv4.js like everything else here — nothing installed, no other vendor. The
 * three properties of the file ledger hold, and a fourth is added:
 *
 *   PERSISTENT    one item, outside every instance
 *   PRE-FLIGHT    a call's worst case is RESERVED before it is made, by a conditional update that
 *                 DynamoDB refuses if it would take the total past the ceiling
 *   FAILS CLOSED  a ledger it cannot reach means no call, never "assume nothing has been spent"
 *   ATOMIC        two instances racing for the last cent cannot both win — the check and the add
 *                 are one write, so there is no window between reading the total and raising it
 *
 * After the call the reservation is settled to what Bedrock reports it cost. A call that failed
 * with an answer from AWS is released (AWS does not bill a refused request); a call that failed
 * with no answer keeps its reservation, because nobody can say it was not billed.
 */

const { sign } = require('../agent/sigv4');

const ID = 'ledger';

class SharedBudget {
  /**
   * @param {object} o
   * @param {string} o.table     DynamoDB table with a string partition key `id`
   * @param {number} o.ceiling   dollars, for every instance together
   * @param {object} o.creds     AWS credentials (agent/sigv4.js credentials())
   */
  constructor({ table, ceiling, creds, region = 'us-east-1', fetchImpl = globalThis.fetch }) {
    if (!table) throw new Error('A shared budget needs a table.');
    if (!(ceiling > 0)) throw new Error('A shared budget needs a ceiling above zero.');
    Object.assign(this, { table, ceiling, creds, region, fetchImpl });
  }

  async call(action, body) {
    const url = `https://dynamodb.${this.region}.amazonaws.com/`;
    const payload = JSON.stringify({ TableName: this.table, Key: { id: { S: ID } }, ...body });
    const { headers } = sign(
      { method: 'POST', url, headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': `DynamoDB_20120810.${action}` }, body: payload },
      this.creds,
      { region: this.region, service: 'dynamodb' }
    );
    let res;
    try {
      res = await this.fetchImpl(url, { method: 'POST', headers, body: payload });
    } catch (e) {
      throw unreachable(e.message);
    }
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text || '{}'); } catch { /* reported below */ }
    if (res.ok) return json;
    if (String(json.__type || '').endsWith('ConditionalCheckFailedException')) return { refused: true };
    throw unreachable(`dynamodb ${res.status}: ${String(json.message || json.Message || text).slice(0, 200)}`);
  }

  async read() {
    const r = await this.call('GetItem', { ConsistentRead: true });
    const spent = Number(r.Item?.spent?.N ?? 0);
    if (!Number.isFinite(spent) || spent < 0) throw unreachable('the ledger item is not a number');
    return { spent, calls: Number(r.Item?.calls?.N ?? 0) };
  }

  /** Hold `could` dollars against the ceiling, or refuse — in one write. */
  async reserve(could, { label = 'this turn' } = {}) {
    // The condition below lets the first write through whatever it holds, so a single call larger
    // than the whole ceiling is refused here instead.
    if (!(could <= this.ceiling)) {
      const e = new Error(`Budget stop: ${label} could cost up to $${could.toFixed(5)}, more than the whole $${this.ceiling.toFixed(2)} ceiling. Nothing was called.`);
      e.code = 'BUDGET';
      throw e;
    }
    const r = await this.call('UpdateItem', {
      UpdateExpression: 'ADD spent :could, calls :one',
      ConditionExpression: 'attribute_not_exists(spent) OR spent <= :room',
      ExpressionAttributeValues: { ':could': num(could), ':one': num(1), ':room': num(this.ceiling - could) },
      ReturnValues: 'UPDATED_NEW',
    });
    if (r.refused) {
      const { spent } = await this.read().catch(() => ({ spent: NaN }));
      const e = new Error(
        `Budget stop: ${label} could cost up to $${could.toFixed(5)}` +
          `${Number.isFinite(spent) ? ` and $${spent.toFixed(4)} of the $${this.ceiling.toFixed(2)} ceiling is spent` : ''}` +
          ' — across every instance of this deployment. Nothing was called.'
      );
      e.code = 'BUDGET';
      throw e;
    }
    return { spent: Number(r.Attributes?.spent?.N), could };
  }

  /** Replace a reservation with what the call actually cost. */
  async settle(reserved, actual) {
    const delta = (Number(actual) || 0) - reserved;
    if (Math.abs(delta) < 1e-12) return;
    await this.call('UpdateItem', {
      UpdateExpression: 'ADD spent :d',
      ExpressionAttributeValues: { ':d': num(delta) },
    });
  }
}

const num = (n) => ({ N: String(Number(n.toFixed(8))) });

/**
 * The message goes to whoever is talking — agent/live.js answers a budget stop in words — and what
 * AWS says goes to the log only: an AccessDenied from DynamoDB names the account and the IAM user.
 */
function unreachable(why) {
  const e = new Error('The shared spend ledger could not be read or written, so nothing was called rather than assume nothing has been spent.');
  e.code = 'BUDGET';
  e.detail = why;
  console.error(`shared-budget: ${why}`);
  return e;
}

module.exports = { SharedBudget };
