/**
 * The shared spend ceiling — one ledger for every instance of a deployment.
 *
 *   node mcp/shared-budget.test.js
 *
 * Against a fake DynamoDB that keeps the one item and applies the same conditional rule the real
 * one does, so nothing here reaches AWS. What is tested is the thing the file ledger could not do on
 * a serverless host: two instances racing for the last of the money cannot both get it, a ledger
 * that cannot be reached stops the call, and a deployment with credentials but no shared ledger
 * will not talk at all.
 */

const assert = require('node:assert');
const { SharedBudget } = require('./shared-budget');
const { converse } = require('../agent/bedrock');
const { available, ledger } = require('../agent/live');

const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };

let passed = 0;
const it = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; }
};

/** One DynamoDB item, with ADD and the one ConditionExpression shape shared-budget.js sends. */
function fakeDynamo({ fail } = {}) {
  const state = { spent: null, calls: 0, requests: [] };
  const fetchImpl = async (url, { headers, body }) => {
    state.requests.push({ url, headers, body: JSON.parse(body) });
    if (fail) return new Response(JSON.stringify({ __type: 'com.amazonaws.dynamodb.v20120810#InternalServerError', message: 'down' }), { status: 500 });
    await new Promise((r) => setImmediate(r)); // let racing requests interleave, as they would
    const b = JSON.parse(body);
    const target = headers['x-amz-target'];
    const v = (k) => Number(b.ExpressionAttributeValues[k].N);
    if (target.endsWith('GetItem')) {
      return Response.json(state.spent === null ? {} : { Item: { id: { S: 'ledger' }, spent: { N: String(state.spent) }, calls: { N: String(state.calls) } } });
    }
    if (b.ConditionExpression && state.spent !== null && !(state.spent <= v(':room'))) {
      return new Response(JSON.stringify({ __type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException', message: 'The conditional request failed' }), { status: 400 });
    }
    if (b.ExpressionAttributeValues[':could']) { state.spent = (state.spent || 0) + v(':could'); state.calls += 1; }
    if (b.ExpressionAttributeValues[':d']) state.spent = (state.spent || 0) + v(':d');
    return Response.json({ Attributes: { spent: { N: String(state.spent) } } });
  };
  return { state, fetchImpl };
}

const bedrockOk = (usage = { inputTokens: 1000, outputTokens: 100 }) => async () =>
  Response.json({ output: { message: { role: 'assistant', content: [{ text: 'ok' }] } }, stopReason: 'end_turn', usage });

(async () => {
  console.log('shared spend ceiling');

  await it('a reservation is one conditional write, signed for DynamoDB, on the one item', async () => {
    const d = fakeDynamo();
    await new SharedBudget({ table: 'hands-spend', ceiling: 5, creds: CREDS, fetchImpl: d.fetchImpl }).reserve(0.01);
    const r = d.state.requests[0];
    assert.equal(r.url, 'https://dynamodb.us-east-1.amazonaws.com/');
    assert.equal(r.headers['x-amz-target'], 'DynamoDB_20120810.UpdateItem');
    assert.match(r.headers.authorization, /\/us-east-1\/dynamodb\/aws4_request/);
    assert.equal(r.body.TableName, 'hands-spend');
    assert.deepEqual(r.body.Key, { id: { S: 'ledger' } });
    assert.match(r.body.ConditionExpression, /spent <= :room/);
    assert.equal(d.state.spent, 0.01);
  });

  await it('two instances racing for the last of the money: exactly one gets it', async () => {
    const d = fakeDynamo();
    const a = new SharedBudget({ table: 't', ceiling: 0.02, creds: CREDS, fetchImpl: d.fetchImpl });
    const b = new SharedBudget({ table: 't', ceiling: 0.02, creds: CREDS, fetchImpl: d.fetchImpl });
    await a.reserve(0.015);
    const results = await Promise.allSettled([a.reserve(0.004), b.reserve(0.004)]);
    const won = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(won, 1, `${won} reservations went through past a ceiling that had room for one`);
    const lost = results.find((r) => r.status === 'rejected').reason;
    assert.equal(lost.code, 'BUDGET');
    assert.match(lost.message, /every instance/);
    assert.ok(d.state.spent <= 0.02, `ledger went to ${d.state.spent}`);
  });

  await it('a ledger that cannot be reached stops the call — it never assumes zero', async () => {
    const d = fakeDynamo({ fail: true });
    let called = false;
    const budget = new SharedBudget({ table: 't', ceiling: 5, creds: CREDS, fetchImpl: d.fetchImpl });
    await assert.rejects(
      () => converse({ messages: [{ role: 'user', content: [{ text: 'hi' }] }] }, { creds: CREDS, budget, fetchImpl: async () => { called = true; return bedrockOk()(); } }),
      (e) => e.code === 'BUDGET' && /could not be read or written/.test(e.message)
    );
    assert.equal(called, false, 'Bedrock was called with no ledger behind it');
  });

  await it('what AWS said about the ledger never reaches the person — it names the account', async () => {
    const denied = async () => new Response(JSON.stringify({ __type: 'com.amazon.coral.service#AccessDeniedException', message: 'User: arn:aws:iam::123456789012:user/x is not authorized to perform: dynamodb:UpdateItem' }), { status: 400 });
    const budget = new SharedBudget({ table: 't', ceiling: 5, creds: CREDS, fetchImpl: denied });
    const err = console.error; console.error = () => {};
    let caught;
    try { await budget.reserve(0.001); } catch (e) { caught = e; } finally { console.error = err; }
    assert.equal(caught.code, 'BUDGET');
    assert.doesNotMatch(caught.message, /arn:|123456789012|user\//);
    assert.match(caught.detail, /AccessDenied|not authorized/);
  });

  await it('a turn reserves its worst case, then settles to what Bedrock says it cost', async () => {
    const d = fakeDynamo();
    const budget = new SharedBudget({ table: 't', ceiling: 5, creds: CREDS, fetchImpl: d.fetchImpl });
    const r = await converse({ messages: [{ role: 'user', content: [{ text: 'E24 on my dishwasher' }] }] }, { creds: CREDS, budget, fetchImpl: bedrockOk() });
    const expected = (1000 * 0.33 + 100 * 2.75) / 1e6;
    assert.ok(Math.abs(r.cost - expected) < 1e-12);
    assert.ok(Math.abs(d.state.spent - expected) < 1e-8, `ledger holds ${d.state.spent}, the call cost ${expected}`);
  });

  await it('a call AWS refused gives its reservation back; the ledger is where it started', async () => {
    const d = fakeDynamo();
    const budget = new SharedBudget({ table: 't', ceiling: 5, creds: CREDS, fetchImpl: d.fetchImpl });
    const refused = async () => new Response('{"message":"throttled"}', { status: 429 });
    await assert.rejects(() => converse({ messages: [{ role: 'user', content: [{ text: 'x' }] }] }, { creds: CREDS, budget, fetchImpl: refused }), /bedrock 429/);
    assert.ok(Math.abs(d.state.spent) < 1e-8, `ledger holds ${d.state.spent} for a call nobody was billed for`);
  });

  await it('a deployment with credentials and no shared ledger will not talk', () => {
    assert.equal(available(CREDS, { VERCEL: '1' }).available, false);
    assert.match(available(CREDS, { VERCEL: '1' }).reason, /HANDS_LEDGER_TABLE/);
    assert.equal(available(CREDS, { VERCEL: '1', HANDS_LEDGER_TABLE: 't' }).available, true);
    assert.equal(available(CREDS, {}).available, true, 'a laptop keeps the file ledger');
    assert.equal(available(null, { VERCEL: '1', HANDS_LEDGER_TABLE: 't' }).available, false);
    const shared = ledger(CREDS, { HANDS_LEDGER_TABLE: 't', HANDS_BUDGET_USD: '5' });
    assert.ok(shared instanceof SharedBudget);
    assert.equal(shared.ceiling, 5);
  });

  console.log(`\n${passed} passed`);
})();
