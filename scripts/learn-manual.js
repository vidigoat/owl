#!/usr/bin/env node
/**
 * Turn a manufacturer's PDF into a machine this project knows.
 *
 *   AWS_PROFILE=bedrock node scripts/learn-manual.js manuals/*.pdf --brand Bosch
 *   node scripts/learn-manual.js one.pdf --text-only        # no Bedrock, no spend
 *
 * The machine library is the difference between a demo and a product: one dishwasher known
 * properly is a demonstration, two hundred appliances is a thing somebody would use. The
 * bottleneck is not code — `faultgraph` already reads four manufacturers' code schemes — it is
 * getting from a ninety-page PDF to the two pages that carry the fault table, reliably, without
 * paying a vision model to read the other eighty-eight.
 *
 * ── The pipeline, cheapest step first ───────────────────────────────────────
 *
 *   1  extract the text layer            free, local, ~200ms for a 50-page manual
 *   2  score every page for table-shape  free — columns and remedy verbs, not vocabulary
 *   3  parse the winners with faultgraph free
 *   4  if that recovered nothing, RENDER the page and ask Bedrock   ~$0.0002 a page
 *
 * Step 4 is not a fallback in the apologetic sense. It is the step that works on the manuals that
 * matter. Real manuals set fault codes in a seven-segment display face, so `E:24` comes out of the
 * text layer as `“:‹ˆ` — the text is not wrong about the page, it is wrong about the codes, which
 * are the one thing we came for. A rendered image shows what a human sees.
 *
 * ── Nothing is admitted without a human ─────────────────────────────────────
 *
 * Output goes to `data/pending/`, never straight into `data/service-data.js`. A library of
 * confidently wrong fault codes is worse than no library, and this product's entire argument is
 * that it does not guess. Every pending entry carries the page it came from and the text it was
 * parsed out of, so review is reading two things side by side rather than taking it on trust.
 */

const fs = require('node:fs');
const path = require('node:path');
const pdf = require('../manual/pdf');
const { parse } = require('../manual/faultgraph');

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', green: '', amber: '', dim: '', bold: '', off: '' };

const PENDING = path.join(__dirname, '..', 'data', 'pending');

function parseArgs(argv) {
  const flags = {};
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { files.push(a); continue; }
    const [k, inline] = a.slice(2).split('=');
    flags[k] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return { flags, files };
}

/** A model number, guessed from the filename, and clearly marked as a guess. */
function modelFromName(file) {
  const base = path.basename(file, path.extname(file));
  const m = /([A-Z]{2,4}[0-9]{2,}[A-Z0-9]*)/i.exec(base);
  return m ? m[1].toUpperCase() : base.toUpperCase().slice(0, 32);
}

async function learnOne(file, flags) {
  const model = flags.model || modelFromName(file);
  const brand = flags.brand || 'Unknown';
  const report = { file, model, brand, steps: [] };

  if (!pdf.available()) {
    report.error = 'pdftotext is not installed — the cheap path is unavailable';
    return report;
  }

  // 1–2. Find the pages that look like a fault table.
  const { total, candidates } = pdf.faultTablePages(file);
  report.pages = total;
  if (!candidates.length) {
    report.steps.push('no page scored as a fault table');
    report.outcome = 'no-table-found';
    return report;
  }

  const runs = pdf.joinAdjacent(candidates);
  const best = runs[0];
  report.bestPages = `${best.from}–${best.to}`;
  report.garbled = candidates.some((c) => c.garbled);
  report.english = candidates[0].english;
  report.steps.push(`pages ${report.bestPages} scored ${best.score}${report.garbled ? ', codes look font-mangled' : ''}`);

  // 3. The free attempt.
  let graph = parse({ model, text: best.text, sourceName: `${brand} service manual` });
  report.steps.push(`text layer: ${graph.coverage}`);

  // 4. The paid attempt, only if the free one came back empty — and only if it could possibly help.
  //
  // A vision model reads French perfectly well and would transcribe that table faithfully. It would
  // then hand faultgraph French, which faultgraph cannot parse, and we would have paid for the
  // privilege. Not spending is the correct behaviour here, and saying why is the difference between
  // a budget guard and a silent skip.
  if (graph.found === 0 && report.english === false && !flags['force-vision']) {
    report.steps.push('skipped the vision model: the parser cannot read this language either, so the call would cost money and change nothing');
  } else if (graph.found === 0 && !flags['text-only']) {
    const { read_manual } = require('../mcp/tools/read_manual');
    for (let page = best.from; page <= best.to; page++) {
      const png = pdf.renderPage(file, page);
      if (!png) { report.steps.push('pdftoppm unavailable — cannot render'); break; }

      const read = await read_manual({ imagePath: png, model, brand });
      report.steps.push(`page ${page} via Bedrock: ${read.coverage || read.reason}`);
      if (read.learned) {
        graph = parse({ model, text: read.transcribed, sourceName: `${brand} service manual, page ${page}` });
        report.transcribed = read.transcribed;
        report.readWith = 'bedrock';
        if (graph.found) break;
      }
    }
  }

  report.coverage = graph.coverage;
  report.codes = Object.keys(graph.codes);
  /*
   * Failing for a knowable reason is a different fact from failing for an unknown one.
   *
   * Manufacturers publish the same manual once per language, so half of what a scraper collects is
   * not English. The page scorer finds those tables fine — columns are columns — but faultgraph's
   * remedy verbs are English, so the parse comes back empty and the honest report is "this manual
   * is not in a language this library reads", not "no fault table". The first tells you to go find
   * the English edition, which exists; the second tells you to go find a better manual, which does
   * not.
   */
  report.outcome = graph.found
    ? 'learned'
    : report.english === false
      ? 'not-english'
      : 'nothing-recovered';
  report.graph = graph;
  return report;
}

(async () => {
  const { flags, files } = parseArgs(process.argv.slice(2));

  if (!files.length) {
    console.log(`\n  ${C.bold}learn-manual${C.off} ${C.dim}— a manufacturer PDF becomes a machine this project knows${C.off}\n`);
    console.log(`    node scripts/learn-manual.js <pdf...> [--brand Bosch] [--model SMS46] [--text-only]\n`);
    console.log(`  ${C.dim}--text-only   never call Bedrock. Free, and fails on manuals whose codes are`);
    console.log(`                set in a display font — which is most of the good ones.${C.off}\n`);
    process.exit(3);
  }

  fs.mkdirSync(PENDING, { recursive: true });
  console.log(`\n  ${C.bold}learning ${files.length} manual${files.length === 1 ? '' : 's'}${C.off}\n`);

  let learned = 0;
  let empty = 0;

  for (const file of files) {
    let report;
    try {
      report = await learnOne(file, flags);
    } catch (e) {
      console.log(`  ${C.red}fail ${C.off} ${path.basename(file)} ${C.dim}${e.message.slice(0, 60)}${C.off}`);
      continue;
    }

    const tag =
      report.outcome === 'learned' ? `${C.green}learned${C.off}` :
      report.outcome === 'no-table-found' ? `${C.amber}no table${C.off}` :
      report.outcome === 'not-english' ? `${C.amber}lang   ${C.off}` :
      `${C.red}empty  ${C.off}`;

    const note = report.outcome === 'not-english'
      ? `fault table found on ${report.bestPages}, but this manual is not in English`
      : report.coverage || report.error || '';
    console.log(`  ${tag} ${path.basename(file).padEnd(30)} ${C.dim}${note}${C.off}`);
    for (const s of report.steps) console.log(`          ${C.dim}· ${s}${C.off}`);

    if (report.outcome === 'learned') {
      learned++;
      // Pending, not admitted. Every entry is reviewed by a person before it reaches the library.
      const out = path.join(PENDING, `${report.model}.json`);
      fs.writeFileSync(out, JSON.stringify({
        model: report.model,
        brand: report.brand,
        source: path.basename(file),
        pages: report.bestPages,
        readWith: report.readWith || 'text-layer',
        codes: report.graph.codes,
        coverage: report.coverage,
        transcribed: report.transcribed || null,
        reviewed: false,
        learnedAt: new Date().toISOString(),
      }, null, 2));
      console.log(`          ${C.dim}→ ${path.relative(process.cwd(), out)} (unreviewed)${C.off}`);
    } else {
      empty++;
    }
  }

  console.log(`\n  ${C.green}${learned} learned${C.off}${empty ? `, ${C.dim}${empty} recovered nothing${C.off}` : ''}`);
  console.log(`  ${C.dim}Nothing is in the library yet. Review data/pending/ and admit what is right —`);
  console.log(`  a library of confidently wrong fault codes is worse than no library.${C.off}\n`);
})();
