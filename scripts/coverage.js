#!/usr/bin/env node
/**
 * How much of what the manufacturer sells can this answer for? Per brand and kind, from the
 * manufacturer's own sitemap down to the library.
 *
 *   node scripts/coverage.js            # print, and write docs/coverage.json
 *
 *   listed      product pages the manufacturer's sitemap has under that kind
 *   visited     of those, product pages scripts/source-manuals.js has read
 *   english     visited models whose page lists an English user manual or repair hints
 *   manuals     distinct documents behind those models — one book often covers a whole line
 *   answers     models the library answers for: an admitted machine, or a model the manufacturer
 *               lists that same admitted manual for (alsoCovers)
 *
 * Every figure is counted from files on disk. A kind nobody has visited reads as 0 visited, not as
 * 0 manuals, because the difference is whether anybody looked.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MANUALS = path.join(ROOT, 'manuals');
const manifest = fs.existsSync(path.join(MANUALS, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(MANUALS, 'manifest.json'), 'utf8')) : {};
const admitted = fs.readdirSync(path.join(ROOT, 'data', 'admitted')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'admitted', f), 'utf8')));

const answersFor = new Set();
for (const r of admitted) {
  answersFor.add(r.model);
  for (const m of r.alsoCovers || []) answersFor.add(m);
}

const kindOf = (url) => (/\/product\/([^/]+)\//.exec(url) || [])[1] || 'other';
const brandOf = (url) => (/bosch-home\.com/.test(url) ? 'bosch' : /siemens-home/.test(url) ? 'siemens' : 'other');
const modelOf = (url) => url.split('/').filter(Boolean).pop().toUpperCase();

const rows = {};
const row = (brand, kind) => (rows[`${brand}/${kind}`] ||= { brand, kind, listed: 0, visited: 0, english: 0, manuals: new Set(), answers: 0 });

for (const brand of ['bosch', 'bosch-uk', 'siemens']) {
  const file = path.join(MANUALS, `.sitemap-${brand}.xml`);
  if (!fs.existsSync(file)) continue;
  const xml = fs.readFileSync(file, 'utf8');
  // The same rule scripts/source-manuals.js walks by: a bare numeric last segment is a spare part,
  // not a model — the first version of this report counted 120 "dishwashers" where Bosch lists 57
  // machines and 63 parts.
  const urls = [...new Set([...xml.matchAll(/<loc>([^<]*\/product\/[^<]*)<\/loc>/g)].map((m) => m[1]))]
    .filter((u) => !/accessor|cleaning-and-care|care-and-cleaning/i.test(u) && !/^\d+$/.test(u.split('/').pop()));
  for (const u of urls) {
    const r = row(brand, kindOf(u));
    r.listed++;
    const model = modelOf(u);
    const m = manifest[model];
    if (m) r.visited++;
    if (m?.file) { r.english++; r.manuals.add(m.file); }
    if (answersFor.has(model)) r.answers++;
  }
}

// Only kinds that are appliances with fault tables; accessories and vacuums are listed, not scored.
const MAJOR = /dishwasher|cooking|baking|refrigerat|cooling|fridge|washer|laundry|dryer/i;
const out = Object.values(rows)
  .filter((r) => MAJOR.test(r.kind))
  .map((r) => ({ ...r, manuals: r.manuals.size }))
  .sort((a, b) => a.brand.localeCompare(b.brand) || b.listed - a.listed);
const total = out.reduce((t, r) => ({ listed: t.listed + r.listed, visited: t.visited + r.visited, english: t.english + r.english, manuals: t.manuals + r.manuals, answers: t.answers + r.answers }), { listed: 0, visited: 0, english: 0, manuals: 0, answers: 0 });

console.log('\n  brand    kind                   listed  visited  english  manuals  answers');
for (const r of out) console.log(`  ${r.brand.padEnd(8)} ${r.kind.padEnd(22)} ${String(r.listed).padStart(6)}  ${String(r.visited).padStart(7)}  ${String(r.english).padStart(7)}  ${String(r.manuals).padStart(7)}  ${String(r.answers).padStart(7)}`);
console.log(`  ${'all'.padEnd(8)} ${''.padEnd(22)} ${String(total.listed).padStart(6)}  ${String(total.visited).padStart(7)}  ${String(total.english).padStart(7)}  ${String(total.manuals).padStart(7)}  ${String(total.answers).padStart(7)}\n`);
fs.writeFileSync(path.join(ROOT, 'docs', 'coverage.json'), `${JSON.stringify({ measured: new Date().toISOString(), what: 'Per brand and kind: product pages the manufacturer lists, visited, with an English manual, distinct manuals, and models the library answers for (scripts/coverage.js).', total, rows: out }, null, 2)}\n`);
