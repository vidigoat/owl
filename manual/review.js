/**
 * The review queue: nothing reaches the library without a person saying so.
 *
 * `learn-manual` turns a manufacturer PDF into a candidate machine and writes it to `data/pending/`.
 * This is the other half — the part where somebody looks. Until now "review" meant opening a JSON
 * file by hand, which is not a review step so much as a note saying one ought to happen.
 *
 * ── Why this is the product, not an admin screen ────────────────────────────
 *
 * The entire argument of this project is that it does not guess. A vision model reading a
 * seven-segment fault table is right most of the time, and *most of the time* is exactly the
 * standard that produces a library nobody can trust: a confidently wrong fault code sends somebody
 * to buy a drain pump for a blocked filter, and the one thing worse than not knowing is being told
 * the wrong thing with a citation attached.
 *
 * So admission is per fault code, not per machine, and every code carries the sentence in the
 * manual it came from. A reviewer holds the rendered page against the parse and admits the ones
 * that match. Rejecting one code does not throw away the other four.
 *
 * ── What "admitted" means on disk ───────────────────────────────────────────
 *
 * Admitted machines are written to `data/admitted/`, which the library loads at startup. Keeping
 * them out of `service-data.js` is deliberate: that file is hand-verified data with a different
 * provenance, and merging machine-read entries into it would erase the distinction between
 * something a person wrote and something a model read. Every admitted entry keeps `readWith`, the
 * page it came from, and who admitted it.
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');
const PENDING = path.join(DATA, 'pending');
const ADMITTED = path.join(DATA, 'admitted');

/** Model numbers are filenames here, so they have to be ones. */
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Everything waiting to be looked at.
 *
 * Summaries only — a queue view does not need five fault codes' worth of causes per machine, and
 * sending them would make the list slow in exactly the case that matters, which is a lot of
 * machines.
 */
function queue() {
  let files = [];
  try {
    files = fs.readdirSync(PENDING).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  return files
    .map((f) => {
      const entry = readJson(path.join(PENDING, f));
      if (!entry) return { model: f.replace(/\.json$/, ''), error: 'unreadable' };
      return {
        model: entry.model,
        brand: entry.brand,
        source: entry.source,
        pages: entry.pages,
        readWith: entry.readWith,
        codes: Object.keys(entry.codes || {}),
        causes: Object.values(entry.codes || {}).reduce((n, c) => n + (c.causes?.length || 0), 0),
        hasPage: Boolean(entry.pageImage),
        learnedAt: entry.learnedAt,
      };
    })
    .sort((a, b) => String(a.model).localeCompare(String(b.model)));
}

/** One candidate machine, in full, with the evidence for every cause. */
function candidate(model) {
  if (!SAFE.test(String(model))) return null;
  return readJson(path.join(PENDING, `${model}.json`));
}

/** The rendered manual page this candidate was read from, if one was kept. */
function pageImagePath(model) {
  if (!SAFE.test(String(model))) return null;
  const file = path.join(PENDING, `${model}.png`);
  return fs.existsSync(file) ? file : null;
}

/**
 * Admit the fault codes a reviewer accepted, and record what they rejected.
 *
 * Rejections are written down rather than deleted. A code the parser keeps getting wrong is a bug
 * report about `faultgraph`, and throwing it away means finding it again on the next manual from
 * the same manufacturer.
 *
 * @param {string} model
 * @param {string[]} accept  fault codes to admit; anything not listed is recorded as rejected
 * @param {string} by        who looked. Stored, because "a person checked this" is a claim with an
 *                           author or it is not a claim.
 */
function admit(model, accept, by = 'unattributed') {
  const entry = candidate(model);
  if (!entry) return { admitted: false, reason: `Nothing pending for ${model}.` };

  const all = Object.keys(entry.codes || {});
  const wanted = all.filter((c) => accept.includes(c));
  const rejected = all.filter((c) => !accept.includes(c));

  if (!wanted.length) {
    return { admitted: false, reason: 'No fault codes were accepted, so there is nothing to admit.', rejected };
  }

  const codes = {};
  for (const c of wanted) codes[c] = entry.codes[c];

  fs.mkdirSync(ADMITTED, { recursive: true });
  const record = {
    model: entry.model,
    brand: entry.brand,
    // Kept as-is, null included. A machine whose kind nobody recorded is not "an Appliance"; the
    // library says the brand and stays quiet about the rest.
    kind: entry.kind || null,
    source: entry.source,
    pages: entry.pages,
    readWith: entry.readWith,
    codes,
    rejected,
    reviewed: true,
    reviewedBy: by,
    reviewedAt: new Date().toISOString(),
    learnedAt: entry.learnedAt,
  };
  fs.writeFileSync(path.join(ADMITTED, `${model}.json`), JSON.stringify(record, null, 2));

  // The candidate stays, marked, so the queue can show what was decided rather than going silent.
  fs.writeFileSync(
    path.join(PENDING, `${model}.json`),
    JSON.stringify({ ...entry, reviewed: true, reviewedAt: record.reviewedAt, rejected }, null, 2)
  );

  return { admitted: true, model, codes: wanted, rejected };
}

/** Everything a person has signed off, for the library to load at startup. */
function admitted() {
  let files = [];
  try {
    files = fs.readdirSync(ADMITTED).filter((f) => f.endsWith('.json'));
  } catch {
    return {};
  }
  const out = {};
  for (const f of files) {
    const rec = readJson(path.join(ADMITTED, f));
    /*
     * `reviewed === true`, checked here and again where the library loads it.
     *
     * `admit` is the only thing that writes this directory and it always marks records reviewed —
     * but the directory sits on disk, and the one thing that must never happen is an unchecked
     * machine answering as a checked one. Two guards on the same rule is the right number when
     * being wrong means giving somebody a fault code no person ever looked at.
     */
    if (rec && rec.model && rec.reviewed === true) out[rec.model] = rec;
  }
  return out;
}

module.exports = { queue, candidate, admit, admitted, pageImagePath, PENDING, ADMITTED };
