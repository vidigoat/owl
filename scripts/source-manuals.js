#!/usr/bin/env node
/**
 * Where the manuals come from.
 *
 *   node scripts/source-manuals.js --kind dishwashers --limit 20
 *   node scripts/source-manuals.js --list            # what is available, download nothing
 *
 * The machine library has been the bottleneck since the first day, and it was never a code problem:
 * `faultgraph` reads four manufacturers' code schemes and the reader finds the fault table in a
 * fifty-three page PDF. The problem was that getting from "a manufacturer publishes manuals" to
 * "here are two hundred PDFs" had no route.
 *
 * ── Why the obvious approach failed ─────────────────────────────────────────
 *
 * Bosch document IDs look enumerable — `9001234567_A.pdf` resolves, so `9001234568_A.pdf` should
 * too. It does, and it is the French edition of the same dishwasher. Walking the ID space yields
 * language duplicates of machines you already have, not new machines, and there is nothing in a
 * document ID that tells you which is which until you have downloaded and read it.
 *
 * ── The route that works ────────────────────────────────────────────────────
 *
 *   sitemap.xml  →  product page  →  a typed list of that product's documents
 *
 * The product page carries its documents as JSON, and every entry has a TYPE:
 *
 *   {"titleKey":"user-manuals","type":"IU","filename":"9002099076_A.pdf",
 *    "url":"https://media3.bsh-group.com/Documents/9002099076_A.pdf","locale":"en-US"}
 *
 * `IU` is the user manual and `RH` is repair hints — between them, the fault tables. That is the
 * part that works, and it is what the ID space could never tell you.
 *
 * `locale` is a trap, and it cost twenty downloads to find out. It reads `en-US` on every entry
 * because it is the locale of the PAGE, not of the document. A model lists three `IU` files all
 * marked en-US and they are the Spanish, English and French-Canadian editions of the same book —
 * with the Spanish one first, consistently. Filtering on `locale` looks like it works and selects
 * at random; the first twenty manuals this fetched were every one of them in Spanish.
 *
 * So language is decided by reading the file, and a rejected edition is deleted and the next
 * candidate tried. In practice that is two downloads a model, not three.
 *
 * ── Being a good guest ──────────────────────────────────────────────────────
 *
 * One request a second, a user agent that says who this is, and nothing fetched from a path the
 * site's robots.txt disallows — `/manual/`, `/*ajax/`, `/spareparts/media/pdf/` and `/*​/search/`
 * are excluded, and the route above uses none of them. There IS a faster search endpoint; it lives
 * under `/*ajax/` and is disallowed, so this takes the slower allowed road instead. The document
 * hosts serve no robots.txt at all.
 *
 * Caps, because a scraper with no ceiling is how somebody's bandwidth bill becomes a surprise:
 * nothing over `--max-mb` (default 60) is downloaded, and the run stops at `--budget-mb`
 * (default 250) however many manuals are left.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const UA = 'owl/0.1 (appliance fault-table research; contact via repo)';
const POLITE_MS = 1000;

/*
 * Thermador and Gaggenau (BSH too) were tried on 26 Sep and are not here: their sitemaps list only
 * accessories and spare parts, never a model page, and the route that would find models is the
 * `/*ajax/` search their robots.txt disallows. Bosch UK sells European model numbers — different
 * machines from Bosch US, with English manuals — on the same platform.
 */
const SITEMAPS = {
  bosch: 'https://www.bosch-home.com/us/sitemap.xml',
  'bosch-uk': 'https://www.bosch-home.co.uk/sitemap.xml',
  siemens: 'https://www.siemens-home.bsh-group.com/uk/sitemap.xml',
};

/*
 * Paths this must not touch, from each site's robots.txt. The pipeline above uses none of them;
 * they are listed so that a future change which starts using one fails here rather than quietly
 * becoming a robots violation.
 */
const DISALLOWED = [/\/manual\//, /ajax/, /\/spareparts\/media\/pdf\//, /\/search\//];

/** The documents worth having. IU is the user manual; RH is repair hints. */
const WANTED_TYPES = new Set(['IU', 'RH']);

const C = process.stdout.isTTY
  ? { green: '\x1b[32m', amber: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { green: '', amber: '', red: '', dim: '', bold: '', off: '' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const [k, inline] = argv[i].slice(2).split('=');
    flags[k] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return flags;
}

function allowed(url) {
  return !DISALLOWED.some((re) => re.test(url));
}

/** Fetch text, politely, with the identity of whoever is doing it attached. */
function get(url, { binary = false, out } = {}) {
  if (!allowed(url)) throw new Error(`refusing ${url} — robots.txt disallows that path`);
  const args = ['-sL', '--max-time', '60', '-A', UA];
  if (binary) args.push('-o', out, '-w', '%{http_code} %{size_download} %{content_type}');
  return execFileSync('curl', [...args, url], {
    encoding: binary ? 'utf8' : 'utf8',
    maxBuffer: 96 * 1024 * 1024,
  });
}

/**
 * The product pages in a sitemap, minus the accessories.
 *
 * Roughly three quarters of a manufacturer's product URLs are cutlery baskets, water filters and
 * baking stones. They have manuals too, and none of them has a fault table.
 */
function productPages(sitemapXml, { kind } = {}) {
  const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return urls.filter((u) => {
    if (!/\/product\//.test(u)) return false;
    if (/accessor|cleaning-and-care|care-and-cleaning/i.test(u)) return false;
    // A bare numeric last segment is a part number; a model number has letters in it.
    const last = u.split('/').pop();
    if (/^\d+$/.test(last)) return false;
    if (kind && !u.includes(`/${kind}/`)) return false;
    return true;
  });
}

/**
 * The documents a product page lists, with their type and language.
 *
 * Pulled with a regex rather than a DOM parse because the page embeds this as escaped JSON inside a
 * script payload — there is no element to query, and a whole HTML parser to reach a string that is
 * already a string would be a dependency for nothing.
 */
function documentsOn(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/\{\\?"id\\?":.{0,600}?\.pdf\\?"[^{}]{0,200}?\}/g)) {
    let raw = m[0].replace(/\\"/g, '"');
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      continue; // a fragment that looked like an object and is not one
    }
    if (!doc.url || !doc.type || seen.has(doc.url)) continue;
    seen.add(doc.url);
    out.push({ type: doc.type, title: doc.titleKey, url: doc.url, locale: doc.locale || null });
  }
  return out;
}

/**
 * The document types that carry fault tables.
 *
 * `locale` is NOT a filter, and finding that out cost twenty downloads. Every entry on a US product
 * page says `"locale":"en-US"` — that is the locale of the PAGE, not of the document. A model lists
 * four `IU` files, all marked en-US, and they are the English, Spanish and French-Canadian editions
 * of the same book. Filtering on it looks like it works and selects at random.
 *
 * So language is decided after downloading, by reading the thing. See `isEnglish` below.
 */
const worthHaving = (docs) => docs.filter((d) => WANTED_TYPES.has(d.type));

/**
 * Is this PDF in English?
 *
 * Counted from function words in the first few pages, which needs no dictionary and no model. Used
 * to reject a Spanish edition and move to the next candidate for the same model — the English one
 * is almost always in the list, just not first and not distinguishable beforehand.
 */
const EN = /\b(the|and|with|from|for|is|are|not|this|water|check|clean|your)\b/gi;
const NOT_EN = /\b(el|la|los|las|para|con|del|une|des|les|pour|avec|dans|sur)\b/gi;

function isEnglish(file) {
  let text;
  try {
    text = execFileSync('pdftotext', ['-l', '6', file, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null; // no text layer: cannot tell, so do not reject it on a guess
  }
  const en = (text.match(EN) || []).length;
  const other = (text.match(NOT_EN) || []).length;
  if (en + other < 20) return null; // too little text to judge
  return en > other;
}

/** The model number, which is the last path segment of a product URL. */
const modelFrom = (url) => url.split('/').filter(Boolean).pop().toUpperCase();

(async () => {
  const flags = parseArgs(process.argv.slice(2));
  const brand = String(flags.brand || 'bosch').toLowerCase();
  const sitemapUrl = SITEMAPS[brand];
  if (!sitemapUrl) {
    console.error(`\n  No sitemap known for "${brand}". Known: ${Object.keys(SITEMAPS).join(', ')}\n`);
    process.exit(3);
  }

  const outDir = path.resolve(flags.out || path.join(__dirname, '..', 'manuals'));
  const limit = Number(flags.limit) || 20;
  const maxMb = Number(flags['max-mb']) || 60;
  // Never a gigabyte in one run, whatever is asked: the permission these downloads run under says
  // "under 100 MB each, never GB-sized", and a flag is not a way around it.
  const budgetMb = Math.min(Number(flags['budget-mb']) || 250, 950);
  if (maxMb > 100) { console.error('\n  --max-mb cannot exceed 100: no single manual over 100 MB is fetched.\n'); process.exit(3); }
  const listOnly = Boolean(flags.list);

  console.log(`\n  ${C.bold}sourcing ${brand} manuals${C.off}`);
  console.log(`  ${C.dim}sitemap → product page → typed document list. One request a second.${C.off}\n`);

  // 1. The sitemap, cached — it is three megabytes and does not change hourly.
  const cache = path.join(outDir, `.sitemap-${brand}.xml`);
  fs.mkdirSync(outDir, { recursive: true });
  let xml;
  if (fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 86400000) {
    xml = fs.readFileSync(cache, 'utf8');
    console.log(`  ${C.dim}sitemap from cache${C.off}`);
  } else {
    xml = get(sitemapUrl);
    fs.writeFileSync(cache, xml);
    await sleep(POLITE_MS);
  }

  const pages = productPages(xml, { kind: flags.kind });
  console.log(`  ${pages.length} product pages${flags.kind ? ` under "${flags.kind}"` : ''}\n`);
  if (!pages.length) process.exit(0);

  // 2. Walk them, collecting documents.
  const manifestFile = path.join(outDir, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  /*
   * One manual, many models. Bosch lists the same user manual on the product page of every model
   * in a family — a dishwasher line is often a dozen model numbers and one book — and fetching it
   * once per model is ten downloads of the same file from somebody else's server. So a document
   * already fetched for one model is linked to the next (`sameDocumentAs`), and a document already
   * found not to be English is never fetched again. `documents.json` is what was learned per URL.
   */
  const docsFile = path.join(outDir, 'documents.json');
  const known = fs.existsSync(docsFile) ? JSON.parse(fs.readFileSync(docsFile, 'utf8')) : {};
  for (const [m, rec] of Object.entries(manifest)) {
    if (rec.took?.url && rec.file && !known[rec.took.url]) known[rec.took.url] = { english: true, model: m, file: rec.file };
  }
  const saveDocs = () => fs.writeFileSync(docsFile, JSON.stringify(known, null, 2));
  let linked = 0;
  let downloaded = 0;
  let bytes = 0;

  for (const page of pages.slice(0, limit)) {
    const model = modelFrom(page);
    if (manifest[model] && !flags.force) {
      console.log(`  ${C.dim}have  ${model}${C.off}`);
      continue;
    }

    let html;
    try {
      html = get(page);
    } catch (e) {
      console.log(`  ${C.red}fail  ${C.off}${model} ${C.dim}${e.message.slice(0, 50)}${C.off}`);
      await sleep(POLITE_MS);
      continue;
    }

    const docs = worthHaving(documentsOn(html));
    if (!docs.length) {
      console.log(`  ${C.amber}none  ${C.off}${model} ${C.dim}no English user manual or repair hints listed${C.off}`);
      manifest[model] = { page, documents: [], checkedAt: new Date().toISOString() };
      await sleep(POLITE_MS);
      continue;
    }

    // Repair hints first where a model has them; otherwise the user manuals, in the order listed.
    const ordered = [...docs.filter((d) => d.type === 'RH'), ...docs.filter((d) => d.type !== 'RH')];
    const file = path.join(outDir, `${model}.pdf`);

    if (listOnly) {
      console.log(`  ${C.dim}would  ${model}  ${ordered[0].type}  ${ordered.length} candidate${ordered.length === 1 ? '' : 's'}${C.off}`);
      manifest[model] = { page, documents: docs, checkedAt: new Date().toISOString() };
      await sleep(POLITE_MS);
      continue;
    }

    // Already have this model's manual under another model number: link it, fetch nothing.
    const have = ordered.find((d) => known[d.url]?.english && fs.existsSync(path.join(outDir, known[d.url].file)));
    if (have) {
      const k = known[have.url];
      manifest[model] = { page, documents: docs, took: { ...have }, file: k.file, sameDocumentAs: k.model, linkedAt: new Date().toISOString() };
      linked++;
      console.log(`  ${C.dim}same  ${model}  the manual already fetched for ${k.model}${C.off}`);
      fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
      await sleep(POLITE_MS);
      continue;
    }

    if (bytes / 1e6 > budgetMb) {
      console.log(`\n  ${C.amber}stopping: ${Math.round(bytes / 1e6)} MB downloaded, budget is ${budgetMb} MB${C.off}`);
      break;
    }

    /*
     * Try each candidate until one is in English.
     *
     * A model lists several `IU` documents and they are the English, Spanish and French-Canadian
     * editions of the same book — all tagged `en-US`, because that is the page's locale rather than
     * the document's. The only way to tell is to read one. A rejected edition is deleted rather
     * than kept, so a wrong guess costs bandwidth and no disk.
     */
    let took = null;
    let rejected = 0;
    for (const doc of ordered) {
      if (known[doc.url]?.english === false) { rejected++; continue; } // read once, not English
      let status;
      try {
        status = get(doc.url, { binary: true, out: file });
      } catch (e) {
        console.log(`  ${C.red}fail  ${C.off}${model} ${C.dim}${e.message.slice(0, 50)}${C.off}`);
        await sleep(POLITE_MS);
        continue;
      }

      const [code, size, type] = status.trim().split(/\s+/);
      const mb = Number(size) / 1e6;

      if (code !== '200' || !/pdf/i.test(type || '')) {
        fs.rmSync(file, { force: true });
        console.log(`  ${C.red}fail  ${C.off}${model} ${C.dim}HTTP ${code}, ${type}${C.off}`);
        await sleep(POLITE_MS);
        continue;
      }
      if (mb > maxMb) {
        fs.rmSync(file, { force: true });
        console.log(`  ${C.amber}big   ${C.off}${model} ${C.dim}${mb.toFixed(1)} MB, over the ${maxMb} MB ceiling${C.off}`);
        await sleep(POLITE_MS);
        continue;
      }

      bytes += Number(size);
      // null means "could not tell", which is not a reason to reject a document.
      if (isEnglish(file) === false) {
        rejected++;
        known[doc.url] = { english: false, checkedAt: new Date().toISOString() };
        saveDocs();
        fs.rmSync(file, { force: true });
        await sleep(POLITE_MS);
        continue;
      }

      took = { ...doc, bytes: Number(size), mb };
      break;
    }

    if (!took) {
      console.log(`  ${C.amber}none  ${C.off}${model} ${C.dim}${rejected} edition${rejected === 1 ? '' : 's'} downloaded, none in English${C.off}`);
      manifest[model] = { page, documents: docs, checkedAt: new Date().toISOString(), noEnglish: true };
    } else {
      downloaded++;
      console.log(
        `  ${C.green}got   ${C.off}${model} ${C.dim}${took.type} · ${took.mb.toFixed(1)} MB` +
        `${rejected ? ` · skipped ${rejected} non-English edition${rejected === 1 ? '' : 's'}` : ''}${C.off}`
      );
      manifest[model] = {
        page, documents: docs, took, file: path.basename(file),
        bytes: took.bytes, fetchedAt: new Date().toISOString(),
      };
      known[took.url] = { english: true, model, file: path.basename(file) };
      saveDocs();
    }

    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    await sleep(POLITE_MS);
  }

  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  saveDocs();
  console.log(`\n  ${C.green}${downloaded} manuals${C.off}, ${(bytes / 1e6).toFixed(1)} MB → ${path.relative(process.cwd(), outDir)}${linked ? ` · ${linked} more model${linked === 1 ? '' : 's'} covered by a manual already here` : ''}`);
  console.log(`  ${C.dim}Next: node scripts/learn-manual.js ${path.relative(process.cwd(), outDir)}/*.pdf --brand Bosch --kind Dishwasher${C.off}\n`);
})();
