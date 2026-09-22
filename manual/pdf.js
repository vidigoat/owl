/**
 * Finding the one page that matters in a ninety-page manual.
 *
 * A service manual is mostly installation clearances, safety warnings in nine languages, and a
 * parts explosion. Exactly one or two pages carry the fault table, and that table is the only thing
 * this project wants. Reading the whole document with a vision model would cost real money per
 * manual and would be slower than reading the cover.
 *
 * So: extract the text layer locally, score every page for whether it LOOKS like a fault table,
 * and hand only the winners to `faultgraph`. A ninety-page manual becomes two pages of work.
 *
 * ── Why a text layer first, and a model second ──────────────────────────────
 *
 * Most manufacturer PDFs are typeset, not scanned, so the text is already in the file and costs
 * nothing to read. `pdftotext -layout` preserves the column structure a fault table depends on,
 * which matters because `faultgraph` reads "code, then its meaning, then the remedies beneath" and
 * a de-layouted extraction destroys exactly that.
 *
 * When there is no text layer — a scan — this cannot help, says so, and the caller falls back to
 * `read_manual`, which photographs the page and asks Bedrock. That is the expensive path and it
 * should be the second one tried, not the first.
 *
 * ── Dependency honesty ──────────────────────────────────────────────────────
 *
 * This shells out to `pdftotext` (poppler). That is not an npm dependency and there is no build
 * step, but it IS a thing that has to exist on the machine, and pretending otherwise would be the
 * kind of quiet overclaim this project spends whole test files preventing. `available()` reports
 * it, and every caller is expected to degrade rather than crash.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const builtIn = require('./pdf-read');

/**
 * Is poppler on this machine — and are we allowed to use it?
 *
 * `MANUAL_READER=built-in` forces the second reader on a machine that has the first. That is not a
 * test knob: the hosted URL has no poppler, and the only way to find out what a visitor there
 * actually gets is to be able to stand in their shoes on a laptop that does. A path that can only
 * be exercised in production is a path nobody exercises.
 */
function poppler() {
  if (process.env.MANUAL_READER === 'built-in') return false;
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Can a manual be read here at all — and by what.
 *
 * ── Why there are two readers ───────────────────────────────────────────────
 *
 * There was one, and it was poppler, and poppler is a binary somebody has to install. On this
 * laptop it is there. On the deployed URL it is not, so the hosted review bench has never had
 * anything in it — a judge opening the live link is told "Nothing is waiting" and never sees the
 * one capability this whole repository is built around.
 *
 * `manual/pdf-read.js` is the second reader: the PDF format, parsed here, with no dependencies at
 * all. It is not a guess that it works. `npm run pdf:compare` runs both over every manual on this
 * machine and scores them against each other on the thing that matters — whether `readSymptoms`
 * recovers the same fault-table rows:
 *
 *     30 manuals · 1,881 pages · page count identical on every one
 *     99.3–100% of poppler's words on every manual
 *     87.5% of poppler's parsed rows recovered word for word
 *
 * poppler still goes first where it exists, because it is the reference the built-in reader was
 * measured against and there is no reason to prefer the measured thing to the thing it was measured
 * with. Which one read a manual travels with the result, the same way a transcript carries the
 * strategy that produced it — a claim that does not say what made it is a claim you cannot check.
 */
function available() {
  // Always. The built-in reader has no requirements, which is the entire reason it was written.
  return true;
}

/** Which reader will be used here, by name. It travels with everything read. */
const reader = () => (poppler() ? 'poppler' : 'built-in');

function pageCount(file) {
  try {
    if (!poppler()) return pages(file).length;
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
    const m = /^Pages:\s+(\d+)/m.exec(info);
    if (m) return Number(m[1]);
  } catch {
    /* pdfinfo is part of the same package but may be absent; fall through */
  }
  // Extract everything and count form feeds — pdftotext separates pages with \f.
  try {
    const all = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return all.split('\f').length;
  } catch {
    return 0;
  }
}

/**
 * Every page's text, and WHICH READER produced it.
 *
 * poppler where it is, the built-in reader where it is not, and if poppler is present but fails on
 * a document the built-in reader gets a turn before anybody is told the manual cannot be read. The
 * name of whichever one answered comes back with the pages, because a result that does not say
 * what made it is a result nobody can check.
 */
function read(file) {
  const buffer = Buffer.isBuffer(file);

  if (poppler()) {
    /*
     * poppler reads files, and this is sometimes handed bytes — a manual somebody uploaded, which
     * never touched a disk. Writing it to one is the whole adaptation.
     *
     * The first version simply passed the Buffer to `execFileSync`, which throws, which fell
     * through to the built-in reader and then reported `reader: "poppler"`. It worked and it was
     * lying about who did the work, in a project whose entire argument is that a claim carries what
     * produced it.
     */
    let tmp = null;
    try {
      const at = buffer
        ? (tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'manual-')), 'in.pdf'), fs.writeFileSync(tmp, file), tmp)
        : file;
      const all = execFileSync('pdftotext', ['-layout', at, '-'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      // pdftotext writes a form feed AFTER the last page, leaving an empty trailing entry that is
      // a separator rather than a page.
      const out = all.split('\f');
      if (out.length && !out[out.length - 1].trim()) out.pop();
      if (out.some((p) => p.trim())) return { pages: out, reader: 'poppler' };
    } catch {
      /* fall through to the reader that cannot be missing */
    } finally {
      if (tmp) fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }

  const seen = { capped: 0 };
  return { pages: builtIn.readPages(file, { seen }), reader: 'built-in', capped: seen.capped };
}

/** Every page's text, in order. Page N is `pages[N - 1]`. */
function pages(file) {
  return read(file).pages;
}

/*
 * What a fault table looks like from a distance.
 *
 * Not "does it contain the word ERROR" — half a manual contains that word, and the safety section
 * contains it most. What distinguishes a fault table is SHAPE: many short lines that begin with a
 * short alphanumeric token, and a high density of remedy verbs. A paragraph about error codes has
 * the vocabulary and not the shape; the table has both.
 */
const CODE_AT_LINE_START = /^\s*(?:[A-Z]{1,3}[\s:\-]?\d{1,3}[A-Z]?|[A-Z]{2,3}|\d{1,2}[A-Z])\s{2,}\S/;

/*
 * Wider than faultgraph's own verb list on purpose. This decides WHICH PAGE to look at, where a
 * false positive costs one wasted parse and a false negative costs the whole manual.
 *
 * Multilingual, because this file's whole claim is that it scores SHAPE rather than vocabulary and
 * an English-only verb list quietly makes that false. A French fault table of the same size as an
 * English one scored six points lower for no reason but its language — close enough to the
 * threshold that a shorter table would have been missed outright. The remedy column of a fault
 * table is imperative verbs in every language these appear in; there is no reason to recognise
 * only one set.
 *
 * This finds the page. PARSING it is a separate matter and still English-only — see TABLE_WORDS.
 */
const REMEDY_VERB =
  /\b(check|clean|clear|replace|inspect|remove|tighten|straighten|reset|ensure|contact|turn|switch|install|unscrew|arrange|call|descale|refill)\b/i;
const REMEDY_VERB_OTHER =
  /\b(nettoyez|v[ée]rifiez|remplacez|fermez|ouvrez|appelez|contactez|retirez|installez|d[ée]branchez|reinigen|pr[üu]fen|ersetzen|austauschen|schlie[ßs]en|[öo]ffnen|entfernen|einsetzen|wenden|limpie|compruebe|sustituya|cierre|retire|llame|pulire|pulisca|controllare|sostituire|chiudere|contattare|reinig|controleer|vervang)\b/i;
/*
 * The heading, in the languages these manuals actually ship in.
 *
 * A Bosch dishwasher manual exists as one document per language, and the French edition's fault
 * table is headed "Dérangement | Cause | Solution". The column SHAPE found that page anyway —
 * which is the argument for scoring shape — but the heading is worth five points and there is no
 * reason to leave them on the table for four fifths of Europe.
 *
 * Finding the page is not the same as being able to PARSE it: faultgraph's remedy verbs are
 * English, so a French table is located and then recovers nothing. That is reported as its own
 * outcome rather than as "no fault table", because the two need opposite things from whoever is
 * holding the manual.
 */
const TABLE_WORDS =
  /\b(fault|error|alarm)\s+(code|codes|table|display)|troubleshoot|d[ée]rangement|code\s+d'erreur|fehlercode|st[öo]rung|c[óo]digo\s+de\s+error|codice\s+di\s+errore|storingstabel/i;

/*
 * Roughly, is this page English?
 *
 * Counted from function words, which are the most reliable signal in a short sample and do not
 * need a dictionary. Used only to explain a failure — never to refuse a page. A table we cannot
 * parse should say WHY, and "this manual is in French" is a far more useful thing to be told than
 * "nothing usable found".
 */
const ENGLISH_MARKERS = /\b(the|and|with|from|for|is|are|not|this|water|check|clean|replace)\b/gi;
const OTHER_MARKERS = /\b(le|la|les|des|und|der|die|das|für|el|los|para|con|il|della|het|een)\b/gi;

function probablyEnglish(text) {
  const en = (String(text).match(ENGLISH_MARKERS) || []).length;
  const other = (String(text).match(OTHER_MARKERS) || []).length;
  return en >= other;
}

/**
 * A line laid out in columns.
 *
 * `pdftotext -layout` preserves horizontal position as runs of spaces, so a three-column table row
 * arrives as `Fault…   Reason…   Remedial action…`. This is the most reliable signal available,
 * because it survives everything else about the page going wrong — including the font.
 */
const COLUMNAR = (line) => line.split(/\s{3,}/).filter((x) => x.trim()).length >= 2;

/**
 * Were the fault codes destroyed by the font?
 *
 * Real manuals set fault codes in a seven-segment display face, and that face maps its glyphs to
 * whatever codepoints the foundry chose. A Bosch dishwasher manual's `E:24` extracts as `“:‹ˆ` —
 * U+201C, U+003A, U+2039, U+02C6. The text layer is not wrong about the PAGE. It is wrong about the
 * CODES, which is the one thing we came for.
 *
 * This is the whole reason the pipeline keeps a vision fallback rather than just a parser. A
 * rendered page shows what a human sees, because the font draws correctly on screen even though it
 * extracts as punctuation. The expensive path is not a worse version of the cheap one — it is the
 * only one that works on exactly the manuals that matter most.
 */
function looksGarbled(text) {
  const suspicious = (String(text).match(/[\u2018\u2019\u201C\u201D\u2039\u203A\u02C6\u02DC\u0192\u2020\u2021]/g) || []).length;
  const letters = (String(text).match(/[A-Za-z]/g) || []).length || 1;
  // A manual uses real quotation marks. It does not use forty of them on one page.
  return suspicious >= 8 && suspicious / letters > 0.008;
}

/*
 * A troubleshooting table with no fault codes in it.
 *
 * Measured across ten current Bosch US dishwasher manuals: every one carries ten to thirteen pages
 * headed `Fault | Cause and troubleshooting`, and not one of them contains a fault code. The left
 * column is a described symptom — "All LEDs light up or flash", "Excessive formation of foam
 * occurs" — where a 2019 European manual for the same kind of machine says "Fault code E:07 is
 * lit."
 *
 * That is a fact about what manufacturers publish, not a parsing failure, and the two must not
 * report the same way. "I could not read this page" sends somebody looking for a better scan.
 * "This manual documents symptoms and prints no codes" tells them the codes are in the repair
 * documentation instead, which is a different and findable thing.
 *
 * It also stops the pipeline paying a vision model to re-read a table whose codes do not exist.
 */
const SYMPTOM_HEADING = /\bcause\s+and\s+troubleshooting\b|\bfault\s+cause\s+and\s+remedy\b/i;
const ANY_CODE = /\b(?:fault|error)\s+code\b|^\s*(?:E:?\s?\d{1,3}|F\d{1,2}|[A-Z]\d[A-Z]?)\s{2,}/im;

/**
 * Does this page document symptoms rather than codes?
 *
 * Both halves matter. The heading alone is not enough — a manual can head a table "Cause and
 * troubleshooting" and still list codes down the left of it — so this is only true when the
 * heading is there AND nothing on the page looks like a code.
 */
function symptomTable(text) {
  const t = String(text);
  return SYMPTOM_HEADING.test(t) && !ANY_CODE.test(t);
}

/**
 * A page's score, plus the evidence for it — so a low score can be argued with.
 *
 * Weighted toward SHAPE rather than vocabulary. Half a manual contains the word "error" and the
 * safety section contains it most; what distinguishes a fault table is that it IS a table.
 *
 * The first version of this leaned on fault codes appearing at line starts. It scored the real
 * Bosch table at 11 against a threshold of 12 and missed it completely — because the codes had been
 * destroyed by the display font and never matched anything. Columns survive that. Verbs survive it.
 */
function scorePage(text) {
  const lines = String(text).split(/\r?\n/);
  let codeLines = 0;
  let remedyLines = 0;
  let columnar = 0;

  for (const line of lines) {
    if (CODE_AT_LINE_START.test(line)) codeLines++;
    if (REMEDY_VERB.test(line) || REMEDY_VERB_OTHER.test(line)) remedyLines++;
    if (COLUMNAR(line)) columnar++;
  }

  const heading = TABLE_WORDS.test(text) ? 1 : 0;

  const score =
    codeLines * 3 +
    Math.min(remedyLines, 30) +
    Math.min(columnar, 25) +
    heading * 5;

  return {
    score,
    codeLines,
    remedyLines,
    columnar,
    heading: Boolean(heading),
    garbled: looksGarbled(text),
    english: probablyEnglish(text),
    symptomsOnly: symptomTable(text),
    lines: lines.length,
  };
}

/**
 * The pages most likely to carry the fault table.
 *
 * Returns a scored, sorted list rather than one answer, because tables run across page breaks and
 * the second-best page is very often the rest of the first.
 */
/**
 * The column header a symptom table introduces itself with, on every page it runs across.
 *
 * It is the one unambiguous sign that the page in front of you is a continuation of the table
 * behind it — a page that merely mentions troubleshooting does not reprint the header.
 */
const TABLE_HEADER = /^(\s*)(?:Fault|Problem|Symptom)\s{2,}(?:Cause and troubleshooting|Cause and remedy|Cause\b.*)$/im;

  /*
   * ── A page that carries the header outranks one that merely looks like a table ──
   *
   * Score is a measure of SHAPE, and shape is what finds a fault table in a manual that never uses
   * the word. It is also what a settings table looks like. In `CM585AGS1B` the real table — headed
   * `Fault | Cause and troubleshooting`, on pages 20 and 21 — scored 28 and 34, while a page of
   * oven default settings scored 37 on column count alone and took the top slot. The four
   * candidates went to three pages with no table on them, and the manual came back as "no column
   * header on this page", which is true of the pages it was handed and false of the manual.
   *
   * `symptoms.js` already states the rule this needed: a table says it is a table at the top of
   * itself. The header is not one signal among several, it is the definitive one, so it sorts
   * first. Shape still finds the headerless tables — plenty of manuals print one — they simply
   * rank below any page that introduced itself.
   */
function rank(pageTexts, { min = 0 } = {}) {
  return pageTexts
    .map((text, i) => ({ page: i + 1, text, ...scorePage(text) }))
    .filter((p) => p.score >= min)
    .sort((a, b) => Number(b.heading) - Number(a.heading) || b.score - a.score);
}

function faultTablePages(file, { take = 4, min = 18 } = {}) {
  const all = pages(file);
  const scored = rank(all, { min });

  const top = scored.slice(0, take);

  /*
   * ── Grow each run until the table stops ───────────────────────────────────
   *
   * `take` is a document-wide top-N, and a troubleshooting section is not N pages long — it is
   * however long it is. `SGE53C55UC` prints its table across pages 43 to 47, and the four slots
   * went to pages 45 and 46 plus two unrelated pages that happened to score well (a Home Connect
   * page, an installation page). Three pages of that machine's symptoms were never read, and
   * nothing anywhere said so: the run reported itself as 45–46 and looked complete.
   *
   * So after the top-N picks a starting point, each run grows outward while the neighbouring page
   * REPRINTS THE COLUMN HEADER. That is the precise signal — a table that runs across a page break
   * introduces itself again on the next page, and a page that merely mentions the word
   * "troubleshooting" in prose does not. Growing on score alone would swallow the neighbours that
   * caused this in the first place.
   */
  const grown = new Map(top.map((c) => [c.page, c]));

  for (const start of top) {
    for (const step of [-1, 1]) {
      let n = start.page + step;
      while (n >= 1 && n <= all.length && !grown.has(n)) {
        const text = all[n - 1];
        if (!TABLE_HEADER.test(text)) break;
        grown.set(n, { page: n, text, ...scorePage(text) });
        n += step;
      }
    }
  }

  return {
    total: all.length,
    candidates: [...grown.values()].sort((a, b) => b.score - a.score),
  };
}

/**
 * Consecutive pages joined back together.
 *
 * A fault table that runs pages 44–45 arrives from `faultTablePages` as two entries, and parsing
 * them separately splits a code from its remedies at the seam. Joining adjacent candidates before
 * parsing is the difference between recovering a code and reporting an orphan.
 */
function joinAdjacent(candidates) {
  const byPage = [...candidates].sort((a, b) => a.page - b.page);
  const runs = [];

  for (const c of byPage) {
    const last = runs[runs.length - 1];
    if (last && c.page === last.to + 1) {
      last.to = c.page;
      /*
       * A form feed at the seam, which is what `pdftotext` puts between pages before `pages()`
       * splits on it. Joined with a bare newline the page boundary was simply gone, so a parser
       * reading the run could only cite the page it started on — and every row on pages two
       * onwards got the first page's number. An owner sent to page 38 for a sentence printed on
       * page 39 has been given a wrong citation, which is the one thing a citation must not be.
       */
      last.text += `\n\f${c.text}`;
      last.score += c.score;
    } else {
      runs.push({ from: c.page, to: c.page, text: c.text, score: c.score });
    }
  }
  return runs.sort((a, b) => b.score - a.score);
}

/**
 * Render one page to a PNG, for the pages the text layer cannot be trusted on.
 *
 * 150 DPI: enough that a seven-segment glyph is unambiguous, small enough that the image is a
 * couple of hundred kilobytes rather than a couple of megabytes. Bedrock charges by tokens and an
 * image's token count scales with its pixels, so resolution is a cost decision as well as a
 * legibility one.
 *
 * @returns {string|null} path to the PNG, or null when `pdftoppm` is not installed — in which case
 *   the caller degrades to text-only and says so, rather than crashing.
 */
function renderPage(file, page, { dir, dpi = 150 } = {}) {
  const out = path.join(dir || fs.mkdtempSync(path.join(os.tmpdir(), 'manual-page-')), `p${page}`);
  try {
    execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', String(page), '-l', String(page), file, out], {
      stdio: 'ignore',
    });
  } catch {
    return null;
  }
  // pdftoppm appends a zero-padded page number whose width depends on the document length.
  const base = path.basename(out);
  const found = fs
    .readdirSync(path.dirname(out))
    .filter((f) => f.startsWith(base) && f.endsWith('.png'))
    .sort();
  return found.length ? path.join(path.dirname(out), found[0]) : null;
}

module.exports = {
  TABLE_HEADER,
  available, poppler, reader, read, pages, pageCount, scorePage, rank, faultTablePages, joinAdjacent,
  looksGarbled, renderPage, probablyEnglish, symptomTable, COLUMNAR,
};
