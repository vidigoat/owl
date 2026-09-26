#!/usr/bin/env node
/**
 * Which other model numbers an admitted manual covers — from what the manufacturer's own pages say.
 *
 *   node scripts/cover-families.js            # say what would change
 *   node scripts/cover-families.js --write    # write alsoCovers into data/admitted/*.json
 *
 * scripts/source-manuals.js records, for every product page it visits, which manual that page lists;
 * when a second model lists a document already fetched for the first, it is linked rather than
 * downloaded again (`sameDocumentAs`). So `manuals/manifest.json` knows, per manual, every model
 * number Bosch published it for. An admitted machine read from that manual answers for all of them.
 *
 * Only exact links count: same document URL on the manufacturer's page. A model that merely looks
 * like one in the family is not added — near model numbers can mean different parts.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADMITTED = path.join(ROOT, 'data', 'admitted');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manuals', 'manifest.json'), 'utf8'));
const write = process.argv.includes('--write');

// file → every model whose product page lists that document
const byFile = new Map();
for (const [model, rec] of Object.entries(manifest)) {
  if (!rec.file) continue;
  if (!byFile.has(rec.file)) byFile.set(rec.file, new Set());
  byFile.get(rec.file).add(model);
}

const admittedModels = new Set(fs.readdirSync(ADMITTED).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));
let changed = 0;
let covered = 0;
for (const f of [...admittedModels].sort()) {
  const file = path.join(ADMITTED, `${f}.json`);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const family = [...(byFile.get(rec.source) || [])]
    // A model with its own admitted record answers for itself.
    .filter((m) => m !== rec.model && !admittedModels.has(m))
    .sort();
  covered += family.length;
  const was = JSON.stringify(rec.alsoCovers || []);
  if (was === JSON.stringify(family)) continue;
  changed++;
  console.log(`  ${rec.model.padEnd(12)} ${rec.source}  covers ${family.length ? family.join(', ') : 'no other model'}`);
  if (write) {
    if (family.length) rec.alsoCovers = family; else delete rec.alsoCovers;
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  }
}
console.log(`\n  ${admittedModels.size} admitted machines answer for ${covered} more model number${covered === 1 ? '' : 's'} · ${changed} record${changed === 1 ? '' : 's'} ${write ? 'updated' : 'would change (--write)'}\n`);
