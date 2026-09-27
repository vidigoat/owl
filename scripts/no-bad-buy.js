#!/usr/bin/env node
/**
 * The one number this product must be able to say: it never sold a part for a fault it had not
 * established.
 *
 *   node scripts/no-bad-buy.js
 *
 * A repair copilot that guesses is worse than none, because its guess costs the owner money and a
 * dismantled machine. So the gate (mcp/tools/verify_diagnosis.js) refuses to open a cart unless one
 * cause is clearly ahead of the cheaper alternatives, is owner-fixable rather than behind mains
 * wiring, and has a known price. This sweeps EVERY cause of EVERY machine in the library and checks
 * that promise held — not by asking the gate (which would be circular), but by re-deriving, for each
 * cart the gate opened, whether a cheaper or comparably-likely cause was still on the table.
 *
 * A "bad buy" is a cart opened when it should not have been: while a cheaper cause was un-ruled-out,
 * while a comparably-likely cause was un-ruled-out, or for a cause behind mains voltage. The number
 * that has to be zero is the count of those.
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../data/service-data');
const { beginCheckout } = require('../mcp/tools/order_part');
const { SEPARATION } = require('../mcp/tools/verify_diagnosis');

const ROOT = path.join(__dirname, '..');
const all = { ...lib.MODELS, ...lib.ADMITTED };

// Every (model, fault, cause) in the library — codes and described symptoms alike.
function* everyCause() {
  for (const [model, rec] of Object.entries(all)) {
    for (const [code, c] of Object.entries(rec.codes || {})) {
      for (const cause of c.causes || []) yield { model, code, cause, siblings: c.causes };
    }
    for (const s of rec.symptoms || []) {
      for (const cause of s.causes || []) yield { model, code: s.id, cause, siblings: s.causes };
    }
  }
}

/** Independently: with nothing ruled out, was a cheaper or comparably-likely cause still live? */
function shouldHaveRefused(cause, siblings) {
  if (cause.mains) return 'behind mains voltage';
  const others = siblings.filter((c) => c.id !== cause.id);
  const cheaper = others.find((c) => (c.cost ?? Infinity) < (cause.cost ?? Infinity) && (c.cost ?? 0) >= 0);
  if (cheaper) return `cheaper cause still live: ${cheaper.id}`;
  const close = others.find((c) => (c.likelihood || 0) >= (cause.likelihood || 0) - SEPARATION);
  if (close) return `comparably-likely cause still live: ${close.id}`;
  return null;
}

function main() {
let swept = 0;
let priced = 0;
let cartsOpened = 0;
const badBuys = [];
const openedFor = [];

for (const { model, code, cause, siblings } of everyCause()) {
  swept++;
  if (typeof cause.cost === 'number' && cause.cost > 0) priced++;
  // Nothing ruled out: the hardest case for the gate — the owner has established nothing yet.
  const r = beginCheckout({ model, code, causeId: cause.id, ruledOut: [] });
  const opened = r.ok === true && r.refused !== true;
  if (!opened) continue;
  cartsOpened++;
  openedFor.push(`${model} ${code} ${cause.id} ($${cause.cost})`);
  const why = shouldHaveRefused(cause, siblings);
  if (why) badBuys.push({ model, code, causeId: cause.id, cost: cause.cost, why });
}

// Positive control: after ruling out the cheaper causes, a legitimately-priced cause DOES open a
// cart — so "zero bad buys" is not just "the gate refuses everything".
let legitOpens = 0;
for (const { model, code, cause, siblings } of everyCause()) {
  if (!(typeof cause.cost === 'number' && cause.cost > 0) || cause.mains) continue;
  const ruledOut = siblings.filter((c) => c.id !== cause.id).map((c) => c.id);
  const r = beginCheckout({ model, code, causeId: cause.id, ruledOut });
  if (r.ok === true && r.refused !== true) legitOpens++;
}

const out = {
  measured: new Date().toISOString(),
  machines: Object.keys(all).length,
  causesSwept: swept,
  purchaseCapable: priced,
  cartsOpenedWithNothingRuledOut: cartsOpened,
  badBuys: badBuys.length,
  badBuyDetail: badBuys,
  legitimateOpensAfterRulingOut: legitOpens,
  note: 'A bad buy = a cart opened while a cheaper or comparably-likely cause was un-ruled-out, or for a mains cause. Checked independently of the gate.',
};
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'no-bad-buy.json'), `${JSON.stringify(out, null, 2)}\n`);

const C = process.stdout.isTTY ? { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', o: '\x1b[0m' } : { g: '', r: '', d: '', b: '', o: '' };
console.log(`\n  ${C.b}zero bad buys${C.o}  ${C.d}${out.machines} machines · ${swept} causes swept · ${priced} can be bought at all${C.o}\n`);
console.log(`  carts opened with nothing ruled out: ${cartsOpened}`);
console.log(`  ${badBuys.length === 0 ? C.g : C.r}bad buys (sold for an unestablished or mains fault): ${badBuys.length}${C.o}`);
console.log(`  ${C.g}legitimate carts once the cheaper causes were ruled out: ${legitOpens}${C.o}   ${C.d}(so the gate is not just refusing everything)${C.o}`);
for (const b of badBuys) console.log(`    ${C.r}BAD${C.o} ${b.model} ${b.code} ${b.causeId} — ${b.why}`);
console.log(`\n  ${C.d}→ docs/no-bad-buy.json${C.o}\n`);
process.exitCode = badBuys.length ? 1 : 0;
}

module.exports = { shouldHaveRefused };
if (require.main === module) main();
