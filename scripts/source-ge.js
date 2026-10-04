#!/usr/bin/env node
/**
 * Where GE's manuals come from.
 *
 *   node scripts/source-ge.js --list                       # what the sitemap offers, download nothing
 *   node scripts/source-ge.js --kind dishwashers --limit 40 --max-manuals 12
 *
 * The library was Bosch and Siemens only, which is one manufacturer's family and not what is in
 * most North American kitchens. GE prints the three-column table (Problem | Possible Cause | What
 * To Do) that manual/symptoms.js now reads, and publishes a route that needs no guessing:
 *
 *   sitemap  →  product URL (the model number is its last token)
 *            →  products.geappliances.com/appliance/gea-specs/<MODEL>/support
 *            →  the link whose text is "<MODEL> Owner's Manual"
 *
 * Many models list the SAME document. It is downloaded once, under the first model that asked,
 * and every other model is recorded against that file in manuals/manifest.json — the same shape
 * scripts/source-manuals.js writes, so scripts/cover-families.js links them without knowing which
 * manufacturer it is looking at.
 *
 * ── Being a good guest ──────────────────────────────────────────────────────
 *
 * www.geappliances.com's robots.txt asks named crawlers to wait ten seconds between requests. This
 * is not one of the named ones; it waits ten seconds there anyway, because the request was plainly
 * meant for anything automated. Nothing under a Disallow line is fetched — the route uses the
 * sitemap, the support page and the document host, none of which is listed. The support and
 * document hosts publish no robots.txt; they get two seconds. Nothing over --max-mb (default 30) is
 * downloaded and the run stops at --budget-mb (default 300).
 */

const fs = require('node:fs');
const path = require('node:path');

const UA = 'second-set-of-hands/0.1 (appliance fault-table research; contact via repo)';
const ROOT = path.join(__dirname, '..');
const MANUALS = path.join(ROOT, 'manuals');
const CACHE = path.join(MANUALS, '.ge');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What a product URL says the machine is. Order matters: "washer-dryer" before "washer".
const KINDS = [
  ['dishwashers', /dishwasher/i, 'Dishwasher'],
  ['dryers', /\bdryer\b(?!.*washer)|(?:gas|electric)-dryer/i, 'Dryer'],
  ['washers', /washer/i, 'Washer'],
  ['refrigerators', /refrigerator|freezer/i, 'Refrigerator'],
  ['ranges', /\brange\b|wall-oven|cooktop/i, 'Range'],
  ['microwaves', /microwave/i, 'Microwave'],
];
const kindOf = (url) => KINDS.find(([, re]) => re.test(url)) || null;

const lastAt = new Map();
async function get(url, { wait, binary = false } = {}) {
  const host = new URL(url).host;
  const since = Date.now() - (lastAt.get(host) || 0);
  if (since < wait) await sleep(wait - since);
  lastAt.set(host, Date.now());
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

/** Every product URL in the sitemap, cached for a day — it is eleven slow requests. */
async function productUrls() {
  fs.mkdirSync(CACHE, { recursive: true });
  const cache = path.join(CACHE, 'products.json');
  try {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (Date.now() - Date.parse(c.at) < 86400000 && c.urls.length) return c.urls;
  } catch { /* fetched below */ }
  const index = await get('https://www.geappliances.com/xmlsitemap.php', { wait: 10000 });
  const pages = [...index.matchAll(/<loc>([^<]+type=products[^<]*)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const urls = [];
  for (const p of pages) {
    process.stdout.write(`  sitemap ${p.split('page=')[1]}/${pages.length}\r`);
    const xml = await get(p, { wait: 10000 });
    urls.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  }
  fs.writeFileSync(cache, JSON.stringify({ at: new Date().toISOString(), urls }));
  return urls;
}

/** The model number a product URL ends in: letters and digits, at least one of each, six or more. */
function modelOf(url) {
  const tail = decodeURIComponent(url).replace(/\/+$/, '').split('-').pop();
  return /^[A-Z0-9]{6,16}$/.test(tail) && /\d/.test(tail) && /[A-Z]/.test(tail) ? tail : null;
}

/** The owner's manual a model's support page lists, or null. */
async function manualFor(model) {
  const html = await get(`https://products.geappliances.com/appliance/gea-specs/${encodeURIComponent(model)}/support`, { wait: 2000 });
  // The link whose own text says Owner's Manual — not the installation sheet or the energy guide beside it.
  const m = /<a[^>]+href="(https?:\/\/[^"]+\.pdf)"[^>]*>(?:(?!<\/a>)[\s\S]){0,200}?Owner(?:'|&#39;|’)s Manual/i.exec(html);
  return m ? m[1] : null;
}

async function main() {
  const urls = await productUrls();
  const products = [];
  const seen = new Set();
  for (const u of urls) {
    const model = modelOf(u);
    const kind = kindOf(u);
    if (!model || !kind || seen.has(model)) continue;
    seen.add(model);
    products.push({ model, kind: kind[0], label: kind[2], page: u });
  }

  if (flag('list', false)) {
    const tally = products.reduce((t, p) => ((t[p.kind] = (t[p.kind] || 0) + 1), t), {});
    console.log(`\n  ${urls.length} product pages in GE's sitemap · ${products.length} with a model number and a kind this reads`);
    for (const [k, n] of Object.entries(tally)) console.log(`    ${k.padEnd(14)} ${n}`);
    console.log();
    return;
  }

  const want = String(flag('kind', 'dishwashers'));
  const limit = Number(flag('limit', 30));
  const maxManuals = Number(flag('max-manuals', 12));
  const maxMb = Number(flag('max-mb', 30));
  const budgetMb = Number(flag('budget-mb', 300));

  const manifestFile = path.join(MANUALS, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const byUrl = new Map(Object.values(manifest).filter((r) => r.took?.url && r.file).map((r) => [r.took.url, r.file]));
  const save = () => fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  let spent = 0;
  let fetched = 0;
  let linked = 0;
  const todo = products.filter((p) => p.kind === want && !manifest[p.model]).slice(0, limit);
  console.log(`\n  GE ${want}: ${todo.length} models to look up (${products.filter((p) => p.kind === want).length} in the sitemap)\n`);

  for (const p of todo) {
    let url = null;
    try { url = await manualFor(p.model); } catch (e) { console.log(`  miss    ${p.model.padEnd(14)} ${e.message}`); continue; }
    if (!url) { console.log(`  none    ${p.model.padEnd(14)} its support page lists no owner's manual`); manifest[p.model] = { brand: 'GE', kind: p.label, page: p.page, documents: [] }; save(); continue; }

    if (byUrl.has(url)) {
      manifest[p.model] = { brand: 'GE', kind: p.label, page: p.page, took: { type: 'owner', url }, file: byUrl.get(url), sameDocumentAs: byUrl.get(url).replace(/\.pdf$/, '') };
      linked++;
      console.log(`  same    ${p.model.padEnd(14)} the manual already fetched as ${byUrl.get(url)}`);
      save();
      continue;
    }
    if (fetched >= maxManuals) { console.log(`  later   ${p.model.padEnd(14)} a new manual, and --max-manuals ${maxManuals} is reached`); continue; }
    if (spent >= budgetMb * 1e6) { console.log(`\n  --budget-mb ${budgetMb} reached; stopping.`); break; }

    let buf;
    try { buf = await get(url, { wait: 2000, binary: true }); } catch (e) { console.log(`  miss    ${p.model.padEnd(14)} ${e.message}`); continue; }
    if (buf.length > maxMb * 1e6) { console.log(`  big     ${p.model.padEnd(14)} ${(buf.length / 1e6).toFixed(1)} MB, over --max-mb ${maxMb}`); continue; }
    if (buf.slice(0, 5).toString() !== '%PDF-') { console.log(`  not pdf ${p.model.padEnd(14)} ${url}`); continue; }
    const file = `${p.model}.pdf`;
    fs.writeFileSync(path.join(MANUALS, file), buf);
    spent += buf.length;
    fetched++;
    byUrl.set(url, file);
    manifest[p.model] = { brand: 'GE', kind: p.label, page: p.page, took: { type: 'owner', url, bytes: buf.length, mb: buf.length / 1e6 }, file, bytes: buf.length, fetchedAt: new Date().toISOString() };
    save();
    console.log(`  fetched ${p.model.padEnd(14)} ${(buf.length / 1e6).toFixed(1)} MB`);
  }
  console.log(`\n  ${fetched} manuals fetched (${(spent / 1e6).toFixed(0)} MB) · ${linked} more models share one already here\n  next: node scripts/learn-manual.js manuals/<MODEL>.pdf --brand GE --kind <Kind> --text-only\n`);
}

if (require.main === module) main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });
module.exports = { modelOf, kindOf };
