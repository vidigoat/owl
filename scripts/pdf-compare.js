#!/usr/bin/env node
/**
 * The built-in PDF reader, against poppler, on every manual on this machine.
 *
 *   npm run pdf:compare            every manual
 *   npm run pdf:compare -- --full  every page, not just the fault tables
 *
 * ── Why this is a script and not an opinion ─────────────────────────────────
 *
 * `manual/pdf-read.js` exists so the hosted URL can read a manual, because `pdftotext` is a binary
 * that is on this laptop and is not on a serverless host. Writing a PDF text extractor is easy.
 * Writing one that is RIGHT is not, and the failure mode is not a crash — it is a page of text that
 * looks fine and has three words missing from the middle of it.
 *
 * So the claim is never "it works". The claim is: on these manuals, on the pages this project
 * actually reads, the built-in reader recovers the same fault-table rows poppler does. Poppler is
 * here, so that is measurable rather than hopeful, and this is the measurement.
 *
 * Three things are compared, in increasing order of how much they matter:
 *
 *   page count      structural. If this is wrong nothing else means anything.
 *   words           did the text come out. Measured as the fraction of poppler's words present.
 *   PARSED ROWS     the only one that decides anything: `readSymptoms` over both texts, and
 *                   whether the symptoms, the causes and the cited pages are the same.
 *
 * A reader that scores 99% on words and loses one column boundary is a failure here, which is the
 * point of scoring the parse rather than the prose.
 */

const fs = require('node:fs');
const path = require('node:path');

const { readPages } = require('../manual/pdf-read');
const { readSymptoms } = require('../manual/symptoms');
const pdf = require('../manual/pdf');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'manuals');

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', amber: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', amber: '', green: '', bold: '', off: '' };

const full = process.argv.includes('--full');
const only = (() => {
  const i = process.argv.indexOf('--manual');
  return i > -1 ? process.argv[i + 1] : null;
})();

const words = (t) => String(t).toLowerCase().match(/[a-z0-9]{2,}/g) || [];

/** How much of poppler's text is present in ours, as a bag of words. */
function wordRecall(mine, theirs) {
  const want = words(theirs);
  if (!want.length) return 1;
  const have = new Map();
  for (const w of words(mine)) have.set(w, (have.get(w) || 0) + 1);
  let found = 0;
  for (const w of want) {
    const n = have.get(w) || 0;
    if (n > 0) { have.set(w, n - 1); found++; }
  }
  return found / want.length;
}

/** The parse, reduced to what a reader of the library would actually see. */
function parsed(text, page) {
  try {
    const r = readSymptoms({ text, sourceName: 'manual', page });
    return (r?.symptoms || []).flatMap((s) =>
      (s.causes || []).map((c) => `${s.symptom} :: ${c.label}`)
    );
  } catch {
    return [];
  }
}

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pdf')).filter((f) => !only || f.includes(only))
  : [];

if (!files.length) {
  console.log('\n  No manuals in manuals/. Fetch some with `npm run source-manuals` first.\n');
  process.exit(0);
}

if (!pdf.available()) {
  console.log('\n  poppler is not installed here, so there is nothing to compare against.');
  console.log('  That is exactly the situation pdf-read.js exists for — but this script needs both.\n');
  process.exit(0);
}

console.log(`\n  ${C.bold}THE BUILT-IN READER, AGAINST POPPLER${C.off}  ${C.dim}${files.length} manuals${C.off}`);
console.log(`  ${C.dim}Pages compared are the ones this project reads: the fault tables.${C.off}\n`);
console.log(`  ${C.dim}${'manual'.padEnd(18)}${'pages'.padStart(7)}${'words'.padStart(9)}${'rows'.padStart(9)}   what${C.off}`);
console.log(`  ${C.dim}${'─'.repeat(74)}${C.off}`);

let worstWords = 1;
let worstRows = 1;
const totals = { pages: 0, pagesMatch: 0, rowsMine: 0, rowsTheirs: 0, hits: 0, manuals: 0, failed: [] };

for (const file of files.sort()) {
  const p = path.join(DIR, file);
  const name = file.replace(/\.pdf$/, '');

  let theirs;
  let mine;
  try {
    theirs = pdf.pages(p);
    // `pdftotext` writes a form feed AFTER the last page, so splitting on it leaves one empty
    // trailing entry. That is a separator, not a page, and counting it would make every manual here
    // look one page short.
    if (theirs.length && !theirs[theirs.length - 1].trim()) theirs.pop();
    mine = readPages(p);
  } catch (e) {
    console.log(`  ${name.padEnd(18)}${C.red}${'—'.padStart(7)}${C.off}   ${C.red}${e.message.slice(0, 44)}${C.off}`);
    totals.failed.push(name);
    continue;
  }

  totals.manuals++;
  totals.pages += theirs.length;
  const samePages = mine.length === theirs.length;
  if (samePages) totals.pagesMatch += theirs.length;

  /*
   * Which pages to compare.
   *
   * By default, the ones `manual/pdf.js` would actually hand to the parser — scoring a reader on a
   * title page it never reads would be flattering and useless. `--full` compares everything, which
   * is the honest wide number and much slower.
   */
  let indices;
  if (full) {
    indices = theirs.map((_, i) => i).filter((i) => (theirs[i] || '').trim().length > 40);
  } else {
    const found = pdf.faultTablePages(p);
    indices = (found?.candidates || []).map((c) => c.page - 1).sort((a, b) => a - b);
    if (!indices.length) {
      indices = theirs.map((_, i) => i).filter((i) => (theirs[i] || '').trim().length > 400).slice(0, 4);
    }
  }

  let wsum = 0;
  let wn = 0;
  let rowsMine = 0;
  let rowsTheirs = 0;
  let rowHits = 0;

  for (const i of indices) {
    const t = theirs[i] || '';
    const m = mine[i] || '';
    if (t.trim().length < 40) continue;
    wsum += wordRecall(m, t);
    wn++;

    const pm = parsed(m, i + 1);
    const pt = parsed(t, i + 1);
    rowsMine += pm.length;
    rowsTheirs += pt.length;
    rowHits += pt.filter((x) => pm.includes(x)).length;
  }

  totals.rowsMine += rowsMine;
  totals.rowsTheirs += rowsTheirs;
  totals.hits += rowHits;

  const w = wn ? wsum / wn : 1;
  const r = rowsTheirs ? rowHits / rowsTheirs : rowsMine ? 1 : 1;
  worstWords = Math.min(worstWords, w);
  worstRows = Math.min(worstRows, r);

  const tone = (v) => (v >= 0.98 ? C.green : v >= 0.9 ? C.amber : C.red);
  const note = !samePages
    ? `${C.red}page count differs: ${mine.length} vs ${theirs.length}${C.off}`
    : rowsTheirs === 0 && rowsMine === 0
      ? `${C.dim}no table on the pages compared${C.off}`
      : `${C.dim}${rowsMine} rows here, ${rowsTheirs} from poppler${C.off}`;

  console.log(
    `  ${name.padEnd(18)}` +
      `${(samePages ? C.green : C.red) + String(theirs.length).padStart(7) + C.off}` +
      `${tone(w) + (w * 100).toFixed(1).padStart(8) + '%' + C.off}` +
      `${tone(r) + (r * 100).toFixed(1).padStart(8) + '%' + C.off}   ${note}`
  );
}

console.log(`  ${C.dim}${'─'.repeat(74)}${C.off}`);
console.log(
  `\n  ${totals.manuals} manuals · ${totals.pages} pages · page count matched on ` +
    `${totals.pagesMatch === totals.pages ? `${C.green}every one${C.off}` : `${C.red}${totals.pagesMatch} of ${totals.pages}${C.off}`}`
);
console.log(`  worst manual: ${(worstWords * 100).toFixed(1)}% of poppler's words, ${(worstRows * 100).toFixed(1)}% of its parsed rows`);
console.log(
  `  rows: ${totals.rowsMine} here, ${totals.rowsTheirs} from poppler — ` +
    `${((totals.hits / (totals.rowsTheirs || 1)) * 100).toFixed(1)}% of poppler's rows recovered ` +
    `word for word, and ${totals.rowsMine - totals.hits} rows poppler did not produce\n`
);

if (totals.failed.length) {
  console.log(`  ${C.red}unreadable: ${totals.failed.join(', ')}${C.off}\n`);
}

/*
 * The result, written down.
 *
 * This comparison needs both readers and a folder of manuals, and `manuals/` is gitignored — so it
 * cannot run in the suite, on a fresh clone, or in anybody else's checkout. The README quotes these
 * figures anyway, which is exactly how a number goes stale.
 *
 * So the run records itself, and `scripts/check-readme.js` checks the README against THIS FILE
 * rather than against nothing. Re-running the comparison is what updates it; the documents cannot
 * drift from a measurement that has been taken, and it is dated so a reader can see how old it is.
 */
if (!only && !full) {
  const record = {
    measured: new Date().toISOString().slice(0, 10),
    against: 'poppler (pdftotext -layout)',
    manuals: totals.manuals,
    pages: totals.pages,
    pageCountIdentical: totals.pagesMatch === totals.pages,
    worstWordRecall: Number((worstWords * 100).toFixed(1)),
    rowsHere: totals.rowsMine,
    rowsFromPoppler: totals.rowsTheirs,
    rowsRecoveredExactly: Number(((totals.hits / (totals.rowsTheirs || 1)) * 100).toFixed(1)),
    rowsPopplerDidNotProduce: totals.rowsMine - totals.hits,
  };
  const at = path.join(ROOT, 'docs', 'pdf-compare.json');
  fs.writeFileSync(at, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`  ${C.dim}recorded in docs/pdf-compare.json — the README is checked against it${C.off}\n`);
}
