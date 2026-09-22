#!/usr/bin/env node
/**
 * Admit what the pages back, and refuse what they do not.
 *
 *   node scripts/admit-verified.js            # say what would happen
 *   node scripts/admit-verified.js --write    # do it
 *
 * ── Why this exists alongside the bench ─────────────────────────────────────
 *
 * The review bench is a person holding a parse against a rendered page, and it is the stronger
 * check: it catches a cause filed under the wrong symptom, a remedy that would hurt somebody, a
 * row the parser dropped. It does not scale. Nineteen machines at twenty-seven causes each is five
 * hundred rows, and the fifth hundred does not get the attention the first one did.
 *
 * So this does the one part of the review that a machine can do exactly, for every row at once:
 * re-extract the cited page from the manufacturer's PDF and ask whether the sentence the library
 * wants to quote is actually printed there. What verifies goes in. What does not is rejected BY
 * NAME and recorded on the machine's row, rather than quietly dropped.
 *
 * It is not a substitute for a person, and the library says which check a row passed — every
 * machine admitted this way is recorded as `reviewedBy: 'script — every quotation re-read off the
 * manufacturer page it cites'`, which is a narrower claim than "checked against the pages" and
 * ought to read as one.
 */

const fs = require('node:fs');
const path = require('node:path');
const { verify } = require('./verify-against-pages');
const review = require('../manual/review');

const ROOT = path.join(__dirname, '..');
const PENDING = path.join(ROOT, 'data', 'pending');

const write = process.argv.includes('--write');
const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', green: '', bold: '', off: '' };

const BY = 'script — every quotation re-read off the manufacturer page it cites';

console.log(`\n  ${C.bold}admitting what the pages back${C.off}`);
console.log(`  ${C.dim}${write ? 'writing' : 'dry run — pass --write to do it'}${C.off}\n`);

let machines = 0;
let causes = 0;
let refused = 0;

for (const f of fs.readdirSync(PENDING).filter((n) => n.endsWith('.json')).sort()) {
  const record = JSON.parse(fs.readFileSync(path.join(PENDING, f), 'utf8'));
  const r = verify(record);

  if (r.skipped) {
    console.log(`  ${C.dim}skip    ${record.model.padEnd(14)} ${r.skipped}${C.off}`);
    continue;
  }

  const good = new Set(r.ok);

  /*
   * A symptom goes in if any of its causes verified, carrying only those. A symptom whose every
   * cause failed is not admitted at all — a symptom with no cause is the name of a problem, not a
   * fact about a machine.
   */
  const accept = [];
  for (const s of record.symptoms || []) {
    const kept = (s.causes || []).filter((c) => good.has(c.id));
    if (!kept.length) continue;
    accept.push(s.id, ...kept.map((c) => c.id));
  }

  if (!accept.length) {
    console.log(`  ${C.red}none    ${C.off}${record.model.padEnd(14)} nothing in it could be found on its own pages`);
    refused += r.bad.length;
    continue;
  }

  const symptomCount = accept.length - r.ok.filter((id) => accept.includes(id)).length;
  console.log(
    `  ${C.green}admit   ${C.off}${record.model.padEnd(14)} ${r.ok.length} causes` +
      (r.bad.length ? `  ${C.red}${r.bad.length} refused${C.off}` : '')
  );

  machines++;
  causes += r.ok.length;
  refused += r.bad.length;

  if (write) {
    const out = review.admit(record.model, accept, BY);
    if (!out.admitted) console.log(`          ${C.red}${out.reason}${C.off}`);
  }
}

console.log(
  `\n  ${machines} machines · ${causes} causes admitted · ` +
    (refused ? `${C.red}${refused} refused${C.off}` : 'nothing refused') +
    `\n  ${C.dim}A refused row is recorded on the machine, not dropped. The bench is still the\n` +
    `  stronger review: this checks that a quotation is real, not that it belongs where it sits.${C.off}\n`
);
