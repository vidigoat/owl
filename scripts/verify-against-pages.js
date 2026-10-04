#!/usr/bin/env node
/**
 * Hold every claim in the library against the page it says it came from.
 *
 *   node scripts/verify-against-pages.js               # everything admitted
 *   node scripts/verify-against-pages.js SGE53C55UC    # one machine
 *   node scripts/verify-against-pages.js --pending     # the review queue instead
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * Every cause in `data/admitted/` carries a citation — "Bosch manual, page 45" — and the whole
 * product rests on that being true. Until now the only thing standing behind it was a person
 * reading the parse against a rendered page on the review bench, which is a good check and does
 * not scale: fourteen machines with nineteen symptoms each is several hundred rows, and attention
 * is the first thing to go.
 *
 * This is the mechanical half of that review, and it is strictly stronger than eyeballing on the
 * one thing it covers: it re-extracts the cited page from the manufacturer's own PDF and asks
 * whether the sentence the library is quoting is actually printed there. Not similar to. Printed.
 *
 * ── What it cannot tell you ─────────────────────────────────────────────────
 *
 * That the cause belongs to the symptom it was filed under, that a remedy is safe, or that a row
 * the parser silently dropped mattered. Those still need a person and a page. This answers exactly
 * one question — "is this quotation real?" — and answers it for every row at once.
 */

const fs = require('node:fs');
const path = require('node:path');
const pdf = require('../manual/pdf');
const { causeColumn } = require('../manual/symptoms');

const ROOT = path.join(__dirname, '..');
const MANUALS = path.join(ROOT, 'manuals');

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', green: '', amber: '', bold: '', off: '' };

/**
 * Compare the way a typesetter does, not the way a byte comparison does.
 *
 * A manual breaks words across lines with a hyphen, sets two spaces where a column gap was, and
 * uses a typographic quote where the parser recorded a straight one. None of that changes what the
 * page says, and treating it as a mismatch would bury the real ones under noise.
 */
const flatten = (s) =>
  String(s)
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/-\s+/g, '')       // the typesetter's line-break hyphen
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * A page, read the way the parser read it: column two only.
 *
 * Flattening the whole page interleaves the two columns, so a cause that wraps over three lines
 * comes back with the symptom's own continuation spliced into the middle of it —
 *
 *     Dishware is not   Lid of the detergent dispenser is
 *     dry.              blocked by items of dishware and will
 *                       not open.
 *
 * reads as "Dishware is not Lid of the detergent dispenser is dry. blocked by…", and a perfectly
 * correct quotation is reported as missing. The first version of this script did exactly that and
 * accused 133 real citations of being invented. Take the same column the parser took, from the
 * page's own header, and the comparison is like for like.
 */
function pagesOf(file) {
  const cache = new Map();
  return (n) => {
    if (!cache.has(n)) {
      for (const [i, text] of pdf.pages(file).entries()) {

        /*
         * Both readings of the page, because neither alone covers it.
         *
         *   column two   what a wrapped cause looks like, uninterrupted by the symptom beside it
         *   whole page   what a COLLIDED row looks like: the left column ran long, the typesetter
         *                squeezed the gap to one space, and slicing at the boundary cuts the
         *                sentence in half. The parser repairs those; slicing cannot.
         *
         * A quotation is real if it is printed in either reading. Requiring column two alone
         * accused 51 correctly-recovered collided rows of being invented.
         */
        cache.set(i + 1, [
          // The cause column as the reader took it: right of the boundary on a two-column page,
          // the middle column on a three-column one.
          causeColumn(text),
          text,
        ]);
      }
    }
    return cache.get(n) || ['', ''];
  };
}

function verify(record) {
  const source = record.source;
  const file = source && path.join(MANUALS, source);
  if (!file || !fs.existsSync(file)) {
    return { skipped: `no manual on this machine (${source || 'entered by hand'})` };
  }

  const pageText = pagesOf(file);
  // `ok` and `bad` carry the cause ids, so `scripts/admit-verified.js` can admit exactly what this
  // script verified rather than re-deciding it with a second copy of the rules.
  const out = { checked: 0, missing: [], uncited: 0, ok: [], bad: [] };

  for (const s of record.symptoms || []) {
    for (const c of s.causes || []) {
      const page = c.source?.page;
      if (!page) {
        out.uncited++;
        continue;
      }
      out.checked++;

      // A cause with no label is a remedy the parser kept under an unnamed cause — there is no
      // quotation to check, so it is counted and skipped rather than crashing the run.
      if (!c.label) {
        out.unlabelled = (out.unlabelled || 0) + 1;
        continue;
      }

      /*
       * A row the reader itself was unsure of is refused before the page is consulted.
       *
       * Two causes read as one are still "printed on the page" — their words sit one after the
       * other in the same column — so this check would pass them, attached to the wrong remedy.
       * The reader knows when it could not tell, and says so; that is the only place it can be caught.
       */
      if (c.unsure) {
        out.bad.push(c.id);
        out.missing.push({ page, symptom: s.symptom, label: c.label, why: c.unsure });
        continue;
      }

      // The cause label is the manufacturer's sentence; that is the claim being checked.
      const want = flatten(c.label);

      /*
       * The cited page, and the one after it.
       *
       * A cause can begin at the foot of one page and finish at the head of the next — the parser
       * joins it back together and cites where it STARTED, which is the right citation and the one
       * an owner can follow. Neither page on its own contains the whole sentence, so checking only
       * the cited page calls a correct quotation invented.
       */
      const readings = [...pageText(page), ...pageText(page + 1)];
      const joined = flatten(`${pageText(page)[1] || ''} ${pageText(page + 1)[1] || ''}`);
      const found = readings.some((r) => flatten(r).includes(want)) || joined.includes(want);
      if (found) out.ok.push(c.id);
      else {
        out.bad.push(c.id);
        out.missing.push({ page, symptom: s.symptom, label: c.label });
      }
    }
  }
  return out;
}

module.exports = { verify, flatten };

if (require.main !== module) return;

const args = process.argv.slice(2);
const usePending = args.includes('--pending');
const only = args.filter((a) => !a.startsWith('--'));
const dir = path.join(ROOT, 'data', usePending ? 'pending' : 'admitted');

console.log(`\n  ${C.bold}every quotation, against the page it cites${C.off}`);
console.log(`  ${C.dim}${path.relative(ROOT, dir)}${C.off}\n`);

let files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
if (only.length) files = files.filter((f) => only.includes(f.replace(/\.json$/, '')));

let totalChecked = 0;
let totalMissing = 0;
let machines = 0;

for (const f of files.sort()) {
  const record = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const r = verify(record);

  if (r.skipped) {
    console.log(`  ${C.dim}skip    ${record.model.padEnd(14)} ${r.skipped}${C.off}`);
    continue;
  }

  machines++;
  totalChecked += r.checked;
  totalMissing += r.missing.length;

  const ok = r.missing.length === 0;
  const mark = ok ? `${C.green}ok    ${C.off}` : `${C.red}WRONG ${C.off}`;
  const note = r.uncited ? ` ${C.amber}(${r.uncited} with no page)${C.off}` : '';
  console.log(`  ${mark}  ${record.model.padEnd(14)} ${r.checked} quotations on the page${note}`);

  for (const m of r.missing.slice(0, 5)) {
    console.log(`         ${C.dim}page ${m.page}:${C.off} ${String(m.label).slice(0, 92)}`);
  }
  if (r.missing.length > 5) console.log(`         ${C.dim}…and ${r.missing.length - 5} more${C.off}`);
}

console.log(
  `\n  ${machines} machines · ${totalChecked} quotations checked · ` +
    (totalMissing
      ? `${C.red}${totalMissing} not found on the page they cite${C.off}`
      : `${C.green}every one of them is printed where it says it is${C.off}`)
);
console.log(
  `  ${C.dim}This says the quotations are real. It does not say a cause belongs to its symptom,\n` +
    `  that a remedy is safe, or that a dropped row mattered — those still need a person.${C.off}\n`
);

process.exit(totalMissing ? 1 : 0);
