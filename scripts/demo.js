#!/usr/bin/env node
/**
 * The whole thing, in one command, in a terminal.
 *
 *   npm run demo
 *
 * Judges are not required to click through an interface, and some of them will not. This runs the
 * complete loop against a machine the project has never seen, printing what each tool actually
 * returned — no server, no browser, no credentials.
 */

const { parse } = require('../manual/faultgraph');
const { learn, LEARNED } = require('../data/service-data');
const { buildSpace, prune } = require('../mcp/tools/hypotheses');
const { nextTest } = require('../mcp/tools/next_test');
const { verify_diagnosis } = require('../mcp/tools/verify_diagnosis');
const { guide } = require('../mcp/tools/guide');
const { beginCheckout, confirmCheckout } = require('../mcp/tools/order_part');
const { read_error } = require('../mcp/tools/read_error');
const fs = require('node:fs');
const path = require('node:path');

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const amber = (s) => `\x1b[33m${s}\x1b[0m`;
const line = () => console.log(dim('  ' + '─'.repeat(66)));

/* A real LG fault table. LG writes codes as letter pairs — no digits anywhere. */
const MANUAL = {
  model: 'LG-WM3900HWA',
  brand: 'LG',
  code: 'OE',
  source: 'LG service manual',
  text: `Error codes
OE   The machine cannot drain
     Check the drain filter for blockages
     Straighten the drain hose behind the machine
     Replace the drain pump if it does not turn
`,
};

console.log(`\n  ${b('OWL')}  ${dim('— the whole loop, on a machine nobody coded for')}\n`);
line();

/* 0 — see it, if there is anything to see with.
 *
 * The rest of this runs with no credentials and no network, which is why it is the command judges
 * are pointed at. This step is the exception: with AWS configured it sends a real panel to Bedrock
 * and prints what came back. Without it, it says so and moves on — a demo that cannot tell a real
 * read from a canned one is a magic trick. */
async function look() {
  const panel = path.join(__dirname, '..', 'eval', 'rendered', 'bosch-dishwasher-panel-e24.png');
  if (!fs.existsSync(panel)) {
    console.log(`  ${b('0. looks at a panel')}   ${dim('skipped — run `npm run panels` to draw one')}`);
    return;
  }

  const started = Date.now();
  const r = await read_error({ imagePath: panel, model: 'SHE3AR75UC' });

  if (r.simulated) {
    console.log(`  ${b('0. looks at a panel')}   ${amber('SIMULATED')} ${dim('— no Bedrock credentials')}`);
    console.log(dim(`     ${r.reason}`));
    console.log(dim('     Everything below still runs. Nothing below needed a camera.'));
    return;
  }

  console.log(`  ${b('0. looks at a panel')}   ${green(r.code || 'no code')}   ${dim(`${Date.now() - started} ms · Bedrock`)}`);
  console.log(dim(`     ${r.meaning || r.reason}`));
  console.log(dim(`     read off an image, not passed in as a string`));
}

look().then(() => {
/* 1 — learn it */
const graph = parse({ model: MANUAL.model, text: MANUAL.text, sourceName: MANUAL.source });
learn({ model: MANUAL.model, brand: MANUAL.brand, codes: graph.codes, source: MANUAL.source });
console.log(`  ${b('1. reads the manual')}   ${MANUAL.brand} ${MANUAL.model} — ${graph.coverage}`);
console.log(dim(`     nothing in this repository mentions this machine`));

/* 2 — the space */
let { space, bits, meaning } = buildSpace({ model: MANUAL.model, code: MANUAL.code });
const tests = LEARNED[MANUAL.model].codes[MANUAL.code].tests;
console.log(`\n  ${b(`2. ${MANUAL.code}`)}   ${meaning}   ${dim(`${bits.toFixed(2)} bits of uncertainty`)}`);
space.forEach((c) => console.log(`     ${String(Math.round(c.prior * 100)).padStart(3)}%  ${c.label}`));

/* 3 — narrow it down */
const performed = [];
const ruledOut = [];
let turn = 0;
while (space.length > 1 && turn < 6) {
  const choice = nextTest({ space, tests, performed });
  if (!choice.test) {
    console.log(`\n  ${amber('stuck')} — ${choice.reason}`);
    break;
  }
  turn++;
  console.log(`\n  ${b(`3.${turn} asks`)}   ${choice.test.question}`);
  console.log(dim(`     ${choice.bits} bits · effort: ${choice.test.effort} · ${choice.why}`));

  const outcome = choice.test.outcomes[1]; // "no, still faulty" — the long path
  const after = prune({ space, outcome });
  if (after.contradiction) {
    console.log(`     ${amber(after.reason)}`);
    break;
  }
  console.log(`     you: "${outcome.say}"`);
  after.eliminated.forEach((e) => console.log(`     ${amber('✗')} ruled out: ${e.label}`));
  space = after.space;
  after.eliminated.forEach((e) => ruledOut.push(e.id));
  performed.push(choice.test.id);
}

/* 4 — the gate */
const cause = space[0];
console.log(`\n  ${b('4. one cause left')}   ${cause.label}`);
const verdict = verify_diagnosis({ model: MANUAL.model, code: MANUAL.code, causeId: cause.id, ruledOut });
console.log(
  verdict.abstain
    ? `     ${amber('REFUSED')} — ${verdict.reason}`
    // Deliberately not called "confidence". The gate re-derives this from service data rather than
    // trusting the caller's arithmetic, so it is the source prior for this cause — not a posterior
    // that has absorbed the eliminations. Printing 0.278 as "confidence" reads as "28% sure",
    // which is both wrong and an understatement of what the run actually established.
    : `     ${green('UPHELD')} · prior from service data ${verdict.confidence} · may spend: ${verdict.maySpend}`
);
if (verdict.citation) console.log(dim(`     cites: ${verdict.citation}`));

/* 5 — the repair */
const proc = guide({ model: MANUAL.model, code: MANUAL.code, causeId: cause.id, ruledOut });
console.log(`\n  ${b('5. talks you through it')}   ${proc.known ? `${proc.steps.length} steps, ~${proc.totalSeconds}s, hands free` : 'refused — no verified procedure'}`);
if (proc.known) proc.steps.forEach((s) => console.log(`     ${s.n}. ${s.say}  ${dim(`(${s.pace}s)`)}`));

/* 6 — the money */
const cart = beginCheckout({ model: MANUAL.model, code: MANUAL.code, causeId: cause.id, ruledOut });
console.log(`\n  ${b('6. the part')}`);
if (!cart.ok) {
  console.log(`     ${amber('NO CART')} — ${cart.reason}`);
} else {
  console.log(`     ${cart.lineItems[0].title} · $${cart.totals.subtotal} + $${cart.totals.tax} tax = ${b('$' + cart.totals.total)}`);
  console.log(`     instead of $${cart.insteadOf.price} for a ${cart.insteadOf.label.toLowerCase()} — saves $${cart.saving}`);
  const placed = confirmCheckout({ sessionId: cart.sessionId });
  console.log(`     ${green(placed.say)}`);
}

line();
console.log(`\n  ${dim('Everything above came from a tool call. `npm test` runs every check behind it.')}\n`);
});
