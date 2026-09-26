/**
 * One manual, many model numbers: a model the manufacturer lists the same manual for is answered
 * from it, and says so. Nothing near a listed model is.
 *
 * Run: node data/families.test.js
 */
const assert = require('node:assert');
const lib = require('./service-data');

let passed = 0;
const it = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; }
};

(async () => {
console.log('families');
const rec = lib.ADMITTED.SGE53C55UC;
const before = rec.alsoCovers;
rec.alsoCovers = ['SGE53C56UC'];

await it('a model listed for the same manual is answered from it, and the provenance says whose manual it is', () => {
  assert.equal(lib.resolveModel('SGE53C56UC'), 'SGE53C55UC');
  assert.equal(lib.resolveModel('Bosch sge53c56uc'), 'SGE53C55UC', 'a brand said first, or lower case, broke the family');
  assert.equal(lib.sameManualAs('SGE53C56UC'), 'SGE53C55UC');
  assert.match(lib.provenance('SGE53C56UC'), /the manual Bosch lists for both SGE53C56UC and SGE53C55UC/);
});

await it('a model one character off a listed one is not in the family — a guess between two machines is the worst answer', () => {
  assert.equal(lib.resolveModel('SGE53C57UC'), 'SGE53C57UC');
  assert.equal(lib.known('SGE53C57UC'), false);
  assert.equal(lib.sameManualAs('SGE53C55UC'), null, 'a model is not its own family member');
});

await it('over MCP, a model answered from its family\'s manual is named in the answer, not swapped for the other model', async () => {
  const { handle } = require('../mcp/server');
  const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe_problem', arguments: { model: 'SGE53C56UC', said: 'there is water in the bottom of the machine' } } });
  const v = r.result.structuredContent;
  assert.equal(v.askedFor, 'SGE53C56UC');
  assert.equal(v.sameManualAs, 'SGE53C55UC');
  if (v.provenance) assert.match(v.provenance, /lists for both SGE53C56UC and SGE53C55UC/);
});

rec.alsoCovers = before;
console.log(`\n${passed} passed`);
})();
