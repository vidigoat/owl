#!/usr/bin/env node
/**
 * Follow every "Page N" a reviewed troubleshooting table points at, and keep what checks out.
 *
 *   npm run procedures
 *
 * For each machine in data/admitted/ whose manual is in manuals/ (gitignored — fetch them with
 * `node scripts/source-manuals.js`), every remedy that ends in a page reference is followed to
 * that page, the procedure under the matching heading is read (manual/procedures.js), and every
 * step is re-found in poppler's own reading of the same pages. A procedure with one step that
 * cannot be re-found is dropped whole.
 *
 * What survives goes to data/procedures/<MODEL>.json, marked for what it is: read and checked by
 * script, NOT reviewed by a person. The admitted library is reviewed; this is not, and nothing
 * downstream is allowed to present it as though it were. The tally goes to docs/procedures.json so
 * the documents can quote it and be checked against it.
 */

const fs = require('node:fs');
const path = require('node:path');

const pdf = require('../manual/pdf');
const P = require('../manual/procedures');

const ROOT = path.join(__dirname, '..');
const ADMITTED = path.join(ROOT, 'data', 'admitted');
const OUT = path.join(ROOT, 'data', 'procedures');
const MANUALS = path.join(ROOT, 'manuals');

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', green: '\x1b[32m', amber: '\x1b[33m', off: '\x1b[0m' }
  : { dim: '', green: '', amber: '', off: '' };

const remediesOf = (rec) => [
  ...(rec.symptoms || []).flatMap((s) => s.causes || []),
  ...Object.values(rec.codes || {}).flatMap((c) => c.causes || []),
].flatMap((c) => (Array.isArray(c.remedies) && c.remedies.length ? c.remedies : [c.remedy])).filter(Boolean);

/** The key a remedy is looked up by: its page and the words of its title. Shared with the library. */
const keyOf = (ref) => `${ref.page}:${P.words(ref.title).join(' ')}`;

function main() {
  if (!fs.existsSync(MANUALS)) {
    console.error('No manuals/ here. Fetch them first: node scripts/source-manuals.js');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const tally = { machines: 0, references: 0, followed: 0, checked: 0, steps: 0, dropped: {} };
  const drop = (why) => { tally.dropped[why] = (tally.dropped[why] || 0) + 1; };

  for (const f of fs.readdirSync(ADMITTED).filter((x) => x.endsWith('.json')).sort()) {
    const rec = JSON.parse(fs.readFileSync(path.join(ADMITTED, f), 'utf8'));
    const file = path.join(MANUALS, rec.source || `${rec.model}.pdf`);
    const refs = new Map();
    for (const r of remediesOf(rec)) {
      const ref = P.reference(r);
      if (ref) refs.set(keyOf(ref), ref);
    }
    if (!refs.size) continue;
    tally.references += refs.size;
    if (!fs.existsSync(file)) { for (const _ of refs) drop('manual not on this machine'); continue; }

    const { pages, reader } = pdf.read(file);
    const kept = {};
    for (const [key, ref] of refs) {
      const found = P.findProcedure(pages, ref);
      if (!found.found) { drop(found.reason.replace(/".*?"|\d+/g, '…')); continue; }
      tally.followed++;
      const at = P.pageIndex(pages, ref.page);
      const checked = P.check(found, P.readingOrder(file, at + 1, Math.min(pages.length, at + 2)));
      if (!checked.found) { drop(checked.reason.replace(/\d+/g, '…')); continue; }
      tally.checked++;
      tally.steps += checked.steps.length;
      kept[key] = {
        reference: `${ref.title}, Page ${ref.page}`,
        heading: checked.heading,
        pages: checked.pages,
        steps: checked.steps.map(({ n, text, notes, page, see }) => ({ n, text, ...(notes.length ? { notes } : {}), ...(see ? { see } : {}), page })),
      };
    }

    const n = Object.keys(kept).length;
    console.log(`  ${n ? C.green : C.dim}${rec.model.padEnd(12)}${C.off} ${n} of ${refs.size} followed and checked`);
    const out = path.join(OUT, `${rec.model}.json`);
    if (!n) { fs.rmSync(out, { force: true }); continue; }
    tally.machines++;
    fs.writeFileSync(out, `${JSON.stringify({
      model: rec.model,
      source: rec.source,
      readWith: reader,
      readBy: 'manual/procedures.js',
      checkedBy: 'script — every step re-found in poppler\'s own reading of the page',
      reviewed: false,
      readAt: new Date().toISOString().slice(0, 10),
      procedures: kept,
    }, null, 2)}\n`);
  }

  const record = { measured: new Date().toISOString().slice(0, 10), ...tally };
  fs.writeFileSync(path.join(ROOT, 'docs', 'procedures.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\n  ${tally.references} page references · ${tally.followed} procedures found · ${C.green}${tally.checked} checked${C.off} (${tally.steps} steps) on ${tally.machines} machines`);
  for (const [why, n] of Object.entries(tally.dropped).sort((a, b) => b[1] - a[1])) console.log(`  ${C.amber}${String(n).padStart(3)}${C.off} ${C.dim}${why}${C.off}`);
  console.log(`\n  ${C.dim}recorded in docs/procedures.json${C.off}\n`);
}

if (require.main === module) main();
module.exports = { keyOf };
