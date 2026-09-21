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

/** Is the cheap path available at all? */
function available() {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function pageCount(file) {
  try {
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

/** Every page's text, in order. Page N is `pages[N - 1]`. */
function pages(file) {
  const all = execFileSync('pdftotext', ['-layout', file, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return all.split('\f');
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
 */
const REMEDY_VERB = /\b(check|clean|clear|replace|inspect|remove|tighten|straighten|reset|ensure|contact|turn|switch|install|unscrew|arrange|call|descale|refill)\b/i;
const TABLE_WORDS = /\b(fault|error|alarm)\s+(code|codes|table|display)|troubleshoot/i;

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
    if (REMEDY_VERB.test(line)) remedyLines++;
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
    lines: lines.length,
  };
}

/**
 * The pages most likely to carry the fault table.
 *
 * Returns a scored, sorted list rather than one answer, because tables run across page breaks and
 * the second-best page is very often the rest of the first.
 */
function faultTablePages(file, { take = 4, min = 18 } = {}) {
  const all = pages(file);
  const scored = all
    .map((text, i) => ({ page: i + 1, text, ...scorePage(text) }))
    .filter((p) => p.score >= min)
    .sort((a, b) => b.score - a.score);

  return { total: all.length, candidates: scored.slice(0, take) };
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
      last.text += `\n${c.text}`;
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
  available, pages, pageCount, scorePage, faultTablePages, joinAdjacent,
  looksGarbled, renderPage, COLUMNAR,
};
