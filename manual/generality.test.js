/**
 * Four manufacturers, four ways of writing a fault table, none of them coded for.
 *
 * This is the test behind the claim that matters most: "point it at any appliance". If it only
 * works on the one manual the demo uses, the claim is marketing. Each block below is shaped the way
 * that manufacturer actually writes them — Bosch letter-and-number, LG letter pairs, Samsung
 * digit-first, Whirlpool F-codes — and each has to end in a usable diagnosis.
 *
 * Run: node manual/generality.test.js
 */

const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
process.env.HOME_STORE = path.join(os.tmpdir(), `ssoh-gen-${Date.now()}.json`);

const { parse } = require('./faultgraph');
const { learn } = require('../data/service-data');
const { buildSpace, prune } = require('../mcp/tools/hypotheses');
const { nextTest } = require('../mcp/tools/next_test');
const { guide } = require('../mcp/tools/guide');

let passed = 0;
const it = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n       ', e.message);
    process.exitCode = 1;
  }
};

const MANUALS = [
  {
    brand: 'Bosch',
    model: 'GEN-BOSCH-1',
    code: 'E24',
    text: `Fault codes
E24   Water is not draining from the machine
      Check the filter for food debris
      Clean the drain pump of obstructions
      Replace the drain pump if it does not run
`,
  },
  {
    brand: 'LG',
    model: 'GEN-LG-1',
    code: 'OE',
    text: `Error codes
OE   The machine cannot drain
     Check the drain filter for blockages
     Straighten the drain hose behind the machine
     Replace the drain pump if it does not turn
`,
  },
  {
    brand: 'Samsung',
    model: 'GEN-SAMSUNG-1',
    code: '4C',
    text: `Information codes
4C   Water is not being supplied
     Check the water supply taps are open
     Clean the inlet filter of debris
     Replace the inlet valve if no water enters
`,
  },
  {
    brand: 'Whirlpool',
    model: 'GEN-WHIRLPOOL-1',
    code: 'F21',
    text: `Fault codes
F21   Draining is taking too long
      Check the drain filter for debris
      Clean the pump impeller of obstructions
      Replace the drain pump if it does not turn
`,
  },
];

console.log('four manufacturers, none of them coded for');

MANUALS.forEach((m) => {
  it(`${m.brand}: recovers ${m.code} from a manual it has never seen`, () => {
    const g = parse({ model: m.model, text: m.text, sourceName: `${m.brand} service manual` });
    assert.ok(g.codes[m.code], `${m.code} not recovered from the ${m.brand} manual`);
    assert.ok(g.codes[m.code].causes.length >= 2, 'needs at least two causes to be worth diagnosing');
    learn({ model: m.model, brand: m.brand, codes: g.codes, source: `${m.brand} service manual` });
  });
});

MANUALS.forEach((m) => {
  it(`${m.brand}: narrows ${m.code} down to a single cause`, () => {
    let { space, tests } = buildSpace({ model: m.model, code: m.code });
    tests = require('../data/service-data').LEARNED[m.model].codes[m.code].tests;
    const performed = [];

    for (let turn = 0; turn < 6 && space.length > 1; turn++) {
      const choice = nextTest({ space, tests, performed });
      if (!choice.test) break;
      // answer "no, still faulty" every time — the hardest path, eliminating one at a time
      const outcome = choice.test.outcomes[1];
      const after = prune({ space, outcome });
      if (after.contradiction) break;
      space = after.space;
      performed.push(choice.test.id);
    }

    assert.equal(space.length, 1, `${m.brand} did not resolve: ${space.length} causes left`);
    assert.ok(performed.length >= 1, 'should have asked at least one question');
  });
});

MANUALS.forEach((m) => {
  it(`${m.brand}: can talk someone through the repair it settled on`, () => {
    const { space } = buildSpace({ model: m.model, code: m.code });
    const proc = guide({ model: m.model, code: m.code, causeId: space[0].id });
    assert.equal(proc.known, true, `no procedure for ${m.brand}`);
    assert.ok(proc.steps.length >= 2);
    assert.ok(proc.citation.includes(m.brand), 'the procedure must cite the manual it came from');
  });
});

it('every cause across every manufacturer cites a real source line', () => {
  MANUALS.forEach((m) => {
    const { space } = buildSpace({ model: m.model, code: m.code });
    space.forEach((c) => {
      assert.ok(c.evidence && c.evidence.length > 10, `${m.brand}: cause without evidence`);
    });
  });
});

it('a code on its own line still parses', () => {
  // How printed tables are laid out — the code in its own narrow column — and therefore how a
  // vision model transcribes one honestly. Bedrock read a manual page perfectly and the whole
  // table was thrown away over a line break.
  const g = parse({ model: 'X', sourceName: 'manual', text: `Fault codes
H20
The machine is not filling with water
  Check the water supply tap is fully open
  Clean the inlet filter at the hose connection
F05
The machine is not draining
  Check the drain filter for debris
` });
  assert.deepEqual(Object.keys(g.codes).sort(), ['F05', 'H20']);
  assert.match(g.codes.H20.meaning, /not filling/);
  assert.ok(g.codes.F05.causes.length >= 1);
});

it('joining a code to the next line does not invent codes out of prose', () => {
  const { joinOrphanCodes } = require('./faultgraph');
  // A short word alone on a line is not a fault code, and the line under it is not its meaning.
  const joined = joinOrphanCodes(['NOTE', 'Disconnect the machine from the mains first.', '']);
  assert.equal(joined[0], 'NOTE', 'NOTE was treated as a fault code');
  // Nor is an empty line, nor a code with nothing underneath it.
  assert.deepEqual(joinOrphanCodes(['', 'x']), ['', 'x']);
  assert.deepEqual(joinOrphanCodes(['E24', '']), ['E24', '']);
});

console.log(`\n${passed} passed`);
