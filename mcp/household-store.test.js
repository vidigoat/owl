/**
 * The household across sessions, on a deployment — against a fake DynamoDB that enforces the same
 * version condition the real one does. Nothing here reaches AWS.
 *
 *   node mcp/household-store.test.js
 */
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.HOME_STORE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hh-')), 'home.json');

const { HouseholdStore, merge } = require('./household-store');
const { handle, setHouseholdStore } = require('./server');

const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
let passed = 0;
const it = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; }
};

/** One item, versioned; UpdateItem refuses a stale version exactly as the ConditionExpression asks. */
function fakeTable({ failWrites = false } = {}) {
  const item = { state: null, version: null };
  const fetchImpl = async (_url, { headers, body }) => {
    const b = JSON.parse(body);
    await new Promise((r) => setImmediate(r));
    if (headers['x-amz-target'].endsWith('GetItem')) {
      return Response.json(item.version === null ? {} : { Item: { id: { S: 'household' }, state: { S: item.state }, version: { N: String(item.version) } } });
    }
    if (failWrites) return new Response(JSON.stringify({ __type: 'x#AccessDeniedException', message: 'User: arn:aws:iam::1:user/x is not authorized' }), { status: 400 });
    const want = Number(b.ExpressionAttributeValues[':v'].N);
    if (item.version !== null && item.version !== want) {
      return new Response(JSON.stringify({ __type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException' }), { status: 400 });
    }
    item.state = b.ExpressionAttributeValues[':s'].S;
    item.version = Number(b.ExpressionAttributeValues[':next'].N);
    return Response.json({});
  };
  return { item, fetchImpl };
}
const call = (name, args) => handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).then((r) => r.result.structuredContent);
const repair = { model: 'SHE3AR75UC', code: 'E24', cause: 'Blocked filter', action: 'Cleaned the filter' };

(async () => {
  console.log('household across sessions');

  await it('a repair remembered on one instance is there on the next — read from the table, not from memory', async () => {
    const t = fakeTable();
    setHouseholdStore(new HouseholdStore({ table: 't', creds: CREDS, fetchImpl: t.fetchImpl }));
    const r = await call('remember_repair', repair);
    assert.equal(r.saved, true);
    assert.equal(r.kept, undefined);
    // A different instance: its own store object, the same table.
    setHouseholdStore(new HouseholdStore({ table: 't', creds: CREDS, fetchImpl: t.fetchImpl }));
    const h = await call('repair_history', { model: 'SHE3AR75UC' });
    assert.equal(h.receipts.length, 1);
    // And it is the table answering: take the item away and the history goes with it.
    t.item.state = JSON.stringify({ appliances: {}, receipts: [] });
    const gone = await call('repair_history', { model: 'SHE3AR75UC' });
    assert.equal(gone.receipts.length, 0, 'history was served from this process, not the store');
  });

  await it('two instances saving at once are merged — neither repair is lost', async () => {
    const t = fakeTable();
    const a = new HouseholdStore({ table: 't', creds: CREDS, fetchImpl: t.fetchImpl });
    const b = new HouseholdStore({ table: 't', creds: CREDS, fetchImpl: t.fetchImpl });
    const sa = await a.load();
    const sb = await b.load();
    sa.receipts.push({ ...repair, at: '2026-09-24T01:00:00Z' });
    sb.receipts.push({ ...repair, action: 'Replaced the pump', at: '2026-09-24T01:00:01Z' });
    await b.save(sb);
    await a.save(sa); // stale version: refused, merged, saved again
    const final = await new HouseholdStore({ table: 't', creds: CREDS, fetchImpl: t.fetchImpl }).load();
    assert.deepEqual(final.receipts.map((x) => x.action).sort(), ['Cleaned the filter', 'Replaced the pump']);
    assert.equal(merge(final, final).receipts.length, 2, 'a merge with itself duplicated receipts');
  });

  await it('two repairs remembered at the same moment in one instance both survive', async () => {
    const t = fakeTable();
    setHouseholdStore(new HouseholdStore({ table: 't', creds: CREDS, fetchImpl: t.fetchImpl }));
    const [a, b] = await Promise.all([
      call('remember_repair', { ...repair, action: 'Cleaned the filter' }),
      call('remember_repair', { ...repair, action: 'Checked the drain hose' }),
    ]);
    assert.equal(a.saved && b.saved, true);
    const stored = JSON.parse(t.item.state);
    assert.deepEqual(stored.receipts.map((r) => r.action).sort(), ['Checked the drain hose', 'Cleaned the filter'], 'a concurrent repair was lost');
  });

  await it('the device page\'s household is the one in the table', async () => {
    const t = fakeTable();
    setHouseholdStore(new HouseholdStore({ table: 't', creds: CREDS, fetchImpl: t.fetchImpl }));
    await call('remember_repair', { ...repair, action: 'Replaced the door seal' });
    const http = require('node:http');
    const srv = http.createServer(require('../server'));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const j = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/household`)).json();
      assert.equal(j.demo, false, 'the page showed the demo household while the table held a real one');
      assert.ok(j.receipts.some((r) => r.action === 'Replaced the door seal'));
    } finally { srv.close(); setHouseholdStore(undefined); }
  });

  await it('a table that refuses the save leaves the answer saying "not kept", never "saved"', async () => {
    const t = fakeTable({ failWrites: true });
    const err = console.error; console.error = () => {};
    try {
      setHouseholdStore(new HouseholdStore({ table: 't', creds: CREDS, fetchImpl: t.fetchImpl }));
      const r = await call('remember_repair', repair);
      assert.equal(r.saved, false);
      assert.equal(r.kept, 'session');
      assert.match(r.keptFor, /^Not kept/);
    } finally { console.error = err; setHouseholdStore(undefined); }
  });

  console.log(`\n${passed} passed`);
})();
