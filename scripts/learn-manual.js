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
const { readSymptoms } = require('../manual/symptoms');

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

/**
 * A model number, from the filename.
 *
 * The whole basename wins when it already looks like a model number, because `source-manuals.js`
 * names every file after the model it fetched. Searching inside it was for filenames a person typed
 * — and it mangled the real ones: `B24CB50ESS` came out as `CB50ESS`, because the pattern wanted
 * two to four letters before the digits and `B24` is one letter and two. A machine filed under the
 * wrong model number is a machine nobody can look up.
 */
const MODEL_SHAPED = /^[A-Z0-9][A-Z0-9-]{3,31}$/i;

function modelFromName(file) {
  const base = path.basename(file, path.extname(file));
  if (MODEL_SHAPED.test(base)) return base.toUpperCase();
  const m = /([A-Z]{2,4}[0-9]{2,}[A-Z0-9]*)/i.exec(base);
  return m ? m[1].toUpperCase() : base.toUpperCase().slice(0, 32);
}

async function learnOne(file, flags) {
  const model = flags.model || modelFromName(file);
  const brand = flags.brand || 'Unknown';
  // No default. A manual does not say what kind of machine it is in any parseable way, and
  // "Appliance" is a non-answer dressed as an answer — it reads as a fact and carries none.
  const kind = flags.kind || null;
  const report = { file, model, brand, kind, steps: [] };

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

  /*
   * Judged on the pages actually chosen, not on every page that scored.
   *
   * The first version asked whether ALL candidates were symptom tables, and candidates include
   * pages that merely scored well and were never used — an unrelated page 12 and page 20 were
   * enough to make it false for a manual whose entire troubleshooting section is symptom-keyed.
   */
  report.symptomsOnly = candidates
    .filter((c) => c.page >= best.from && c.page <= best.to)
    .every((c) => c.symptomsOnly);
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
  if (graph.found === 0 && report.symptomsOnly && !flags['force-vision']) {
    /*
     * A troubleshooting table with no codes in it — so read it as what it is.
     *
     * Rendering it and asking a vision model to transcribe fault codes would produce, correctly,
     * nothing, for money. The table is perfectly readable; it is simply keyed on a described
     * symptom instead of a code, and the text layer is enough because the symptom is set in an
     * ordinary typeface rather than the seven-segment display font that mangles codes.
     */
    report.steps.push('keyed on described symptoms, not codes — reading it as a symptom table');
    const found = readSymptoms({ text: best.text, sourceName: `${brand} manual`, page: best.from });
    report.symptoms = found.symptoms;
    report.steps.push(`symptom table: ${found.coverage}`);

    /*
     * Keep the page anyway.
     *
     * No vision model was called, but the review bench still needs the evidence — its entire value
     * is a person holding the parse against the page, and a reviewer with nothing to check against
     * ticks boxes. Rendering is `pdftoppm` on this machine: free, offline, and about two hundred
     * kilobytes.
     */
    let png = null;
    try {
      png = pdf.renderPage(file, best.from);
      if (png) {
        fs.copyFileSync(png, path.join(PENDING, `${model}.png`));
        report.pageImage = `${model}.png`;
      }
    } catch { /* the entry is still reviewable from the manual itself */ }

    /*
     * The expensive step, on the rows that earned it.
     *
     * The text layer is free, offline and right about most of this table. It fails on rows where
     * the two columns collided — the left column ran long and the gap between them became a single
     * space — and it SAYS SO rather than guessing. A picture of the page does not have that
     * problem: columns are plainly columns to anything that can see.
     *
     * So this runs only when the free path reported a collision, and only on the page that had
     * one. Cheapest step first; the expensive one earns its place by fixing a named failure instead
     * of being the default.
     */
    if (found.collided && png && !flags['text-only']) {
      const { read_symptom_table } = require('../mcp/tools/read_symptoms');
      report.steps.push(`${found.collided} row${found.collided === 1 ? '' : 's'} had their columns run together — asking the model to read the page`);
      try {
        /*
         * Merged, not picked between.
         *
         * Whichever read MORE is the wrong question. The text layer is right about the rows it
         * could split and the model is the only one that can read the rows it could not, so taking
         * a winner throws away whichever half the loser was better at. The collided rows are
         * precisely the ones missing from the text layer's reading, so anything the model saw that
         * the text layer did not is the recovery — and anything they both saw stays as the text
         * layer had it, because that reading is deterministic and free.
         */
        const have = new Set(found.symptoms.map((x) => x.id));
        const added = [];

        for (let pg = best.from; pg <= best.to; pg++) {
          const shot = pg === best.from ? png : pdf.renderPage(file, pg);
          if (!shot) continue;
          const seen = await read_symptom_table({ imagePath: shot, sourceName: `${brand} manual`, page: pg });
          report.steps.push(`page ${pg} via Bedrock: ${seen.coverage || seen.reason}`);
          for (const sym of seen.symptoms || []) {
            if (have.has(sym.id)) continue;
            have.add(sym.id);
            added.push(sym);
          }
        }

        if (added.length) {
          report.symptoms = [...found.symptoms, ...added];
          report.readWith = 'text layer, with the collided rows read from the page';
          report.steps.push(
            `recovered ${added.length} symptom${added.length === 1 ? '' : 's'} the columns had swallowed: ` +
            added.map((x) => `"${x.symptom.slice(0, 40)}"`).join(', ')
          );
        } else {
          report.steps.push('the model found nothing the text layer had missed');
        }
      } catch (e) {
        report.steps.push(`the model could not be reached: ${e.message.slice(0, 60)}`);
      }
    }
  } else if (graph.found === 0 && report.english === false && !flags['force-vision']) {
    report.steps.push('skipped the vision model: the parser cannot read this language either, so the call would cost money and change nothing');
  } else if (graph.found === 0 && !flags['text-only']) {
    const { read_manual } = require('../mcp/tools/read_manual');
    for (let page = best.from; page <= best.to; page++) {
      const png = pdf.renderPage(file, page);
      if (!png) { report.steps.push('pdftoppm unavailable — cannot render'); break; }

      const read = await read_manual({ imagePath: png, model, brand });
      report.steps.push(`page ${page} via Bedrock: ${read.coverage || read.reason}`);
      if (read.learned) {
        /*
         * Keep the page.
         *
         * Review means holding what was parsed against what the page actually says, and a reviewer
         * who has to go and find the PDF, then the right page, will approve on trust instead —
         * which would make the review step theatre. The image is the evidence; it belongs next to
         * the claim.
         */
        try {
          fs.copyFileSync(png, path.join(PENDING, `${model}.png`));
          report.pageImage = `${model}.png`;
        } catch { /* the entry is still reviewable from its transcript */ }
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
    : report.symptoms?.length
      ? 'symptoms'
      : report.symptomsOnly
        ? 'symptoms-only'
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
    console.log(`    node scripts/learn-manual.js <pdf...> [--brand Bosch] [--kind Dishwasher] [--model SMS46] [--text-only]\n`);
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
      report.outcome === 'symptoms' ? `${C.green}symptom${C.off}` :
      report.outcome === 'symptoms-only' ? `${C.amber}symptom${C.off}` :
      `${C.red}empty  ${C.off}`;

    const note =
      report.outcome === 'not-english'
        ? `fault table found on ${report.bestPages}, but this manual is not in English`
      : report.outcome === 'symptoms'
        ? `${report.symptoms.length} symptoms from ${report.bestPages} — this manual prints no fault codes`
      : report.outcome === 'symptoms-only'
        ? `troubleshooting table on ${report.bestPages}, keyed on symptoms, and nothing readable under it`
        : report.coverage || report.error || '';
    console.log(`  ${tag} ${path.basename(file).padEnd(30)} ${C.dim}${note}${C.off}`);
    for (const s of report.steps) console.log(`          ${C.dim}· ${s}${C.off}`);

    if (report.outcome === 'learned' || report.outcome === 'symptoms') {
      learned++;
      // Pending, not admitted. Every entry is reviewed by a person before it reaches the library.
      const out = path.join(PENDING, `${report.model}.json`);
      fs.writeFileSync(out, JSON.stringify({
        model: report.model,
        brand: report.brand,
        kind: report.kind,
        source: path.basename(file),
        pages: report.bestPages,
        readWith: report.readWith || 'text-layer',
        codes: report.graph.codes,
        // Symptoms sit beside codes rather than replacing them. A manual can have both, and a
        // machine known only by symptom is still a machine known.
        symptoms: report.symptoms || [],
        coverage: report.coverage,
        transcribed: report.transcribed || null,
        pageImage: report.pageImage || null,
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
