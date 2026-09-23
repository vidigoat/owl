/**
 * The cards.
 *
 * One rule matters more than everything else in this file, and it is easy to break by accident
 * while making a screen nicer: **nothing may appear only on a card.**
 *
 * The person is kneeling in front of a machine with their hands inside it and their eyes nowhere
 * near a display. Anything they must know has to survive being heard. A card is for what eyes are
 * better at — a probability bar, a struck-through cause, an itemised total — and a card that is
 * load-bearing has quietly turned a voice product into a screen product.
 *
 * Run: node mcp/cards.test.js
 */

const assert = require('node:assert');
const { RESOURCES, spaceCard, stepCard, refusalCard, checkoutCard, bar } = require('./cards');

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

const SPACE = [
  { id: 'filter', label: 'Blocked filter or drain path', prior: 0.62 },
  { id: 'hose', label: 'Kinked or blocked drain hose', prior: 0.38 },
];

console.log('cards');

it('a bar is a bar at both ends of the range', () => {
  assert.equal(bar(0, 10), '░░░░░░░░░░');
  assert.equal(bar(1, 10), '██████████');
  assert.equal(bar(0.5, 10).length, 10);
  // Nonsense in should not produce a ragged card.
  assert.equal(bar(-1, 10).length, 10);
  assert.equal(bar(2, 10).length, 10);
});

it('the hypothesis space shows what is out as well as what is in', () => {
  const card = spaceCard({
    model: 'SHE3AR75UC', code: 'E24', meaning: 'Water cannot leave the machine',
    space: SPACE, eliminated: [{ id: 'pump', label: 'Failed drain pump' }], bits: 0.43,
  });
  assert.match(card, /E24/);
  assert.match(card, /62%/);
  assert.match(card, /~~Failed drain pump~~/, 'an eliminated cause should read as eliminated');
  assert.match(card, /ruled out/);
  assert.match(card, /0\.43 bits/);
});

it('a settled space says so instead of claiming a fraction of a bit', () => {
  const card = spaceCard({ model: 'M', code: 'E24', meaning: 'x', space: [SPACE[0]], bits: 0 });
  assert.match(card, /No uncertainty left/);
  assert.doesNotMatch(card, /0\.00 bits/);
});

it('a step card shows one step, not the whole procedure', () => {
  const card = stepCard({ step: 'Twist the filter out and rinse it', index: 0, total: 4, seconds: 25 });
  assert.match(card, /Step 1 of 4/);
  assert.match(card, /Twist the filter out/);
  assert.match(card, /about 25s/);
  assert.match(card, /Say "next"/, 'the person has to know how to move on without looking');
  // A list of nine steps on a screen is a list nobody reads.
  assert.ok(!/Step 2 of 4/.test(card));
});

it('the last step does not ask for a next one', () => {
  const card = stepCard({ step: 'Run a rinse cycle', index: 3, total: 4 });
  assert.match(card, /last step/);
  assert.doesNotMatch(card, /Say "next"/);
});

it('the refusal card refuses in the words a person would use', () => {
  const card = refusalCard({
    reason: 'This cause sits behind mains wiring. It is not an owner repair.',
    alternative: '$179',
  });
  assert.match(card, /NOT UPHELD/);
  assert.match(card, /not going to guess with your money/i);
  assert.match(card, /mains wiring/);
  assert.match(card, /\$179/, 'a refusal without the alternative leaves somebody stuck');
});

it('the checkout card is itemised, with the comparison that justifies it', () => {
  const card = checkoutCard({ part: 'Drain pump 00631200', price: '$42.90', tax: '$3.65', total: '$46.55', alternative: '$179' });
  assert.match(card, /00631200/);
  assert.match(card, /\$46\.55/);
  assert.match(card, /\$179/, 'the comparison IS the argument; a total on its own is just a price');
  assert.match(card, /order it/i);
});

/* ── the rule ─────────────────────────────────────────────────────────── */

it('nothing appears only on a card', () => {
  // Every card here is built from values the tools already return and the device already speaks.
  // A card that invented a fact would make the screen load-bearing, and the person is not looking
  // at the screen. This checks the shape of that: no card holds a number nobody passed in.
  const card = spaceCard({ model: 'M', code: 'E24', meaning: 'Water cannot leave', space: SPACE, bits: 0.43 });
  const numbers = (card.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const supplied = new Set([24, 62, 38, 0.43, 18]); // code, priors, bits, bar width
  numbers.forEach((n) => assert.ok(supplied.has(n), `card shows ${n}, which nobody passed in`));
});

it('every listed resource can actually be read, and says something', () => {
  assert.ok(RESOURCES.length > 0);
  // The Markdown cards; the MCP App (ui://) is a page, not a card, and has its own tests.
  RESOURCES.filter((r) => !r.uri.startsWith('ui://')).forEach((r) => {
    assert.match(r.uri, /^card:\/\//);
    assert.equal(r.mimeType, 'text/markdown');
    assert.ok(r.name && r.description, `${r.uri} is listed without saying what it is`);
    const text = r.read();
    assert.ok(text.length > 120, `${r.uri} renders to almost nothing`);
    assert.match(text, /^###/, 'a card should start with its own heading');
  });
});

it('the refusals resource lists refusals the code actually makes', () => {
  // A card describing behaviour the product does not have is the worst kind of documentation.
  const text = RESOURCES.find((r) => /will-not-do/.test(r.uri)).read();
  const { SEPARATION } = require('./tools/verify_diagnosis');
  assert.match(text, /mains/i);
  assert.match(text, new RegExp(`${Math.round(SEPARATION * 100)}%`),
    'the card quotes a separation threshold the gate does not use');
  assert.match(text, /NOT VERIFIED/);
});

console.log(`\n${passed} passed`);
