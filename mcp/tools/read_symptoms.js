/**
 * tool: read_symptom_table
 *
 * Read a troubleshooting table off a rendered page, for the rows the text layer cannot split.
 *
 * `manual/symptoms.js` reads these tables from `pdftotext -layout` and does it well — ninety-nine
 * symptoms across twelve manuals, free and offline. It fails on one thing and knows it: rows where
 * the two columns have COLLIDED, where the left column ran long and the typesetter squeezed the gap
 * to a single space. `Home Connect cannot Home Connect set incorrectly.` could break before the
 * second "Home" or after it, and nothing in the text says which, so those rows are refused and
 * flagged.
 *
 * A picture of the page does not have that problem. The columns are plainly columns to anything
 * that can see, and the ruled lines between rows are right there.
 *
 * ── Why this is not just "use the model for everything" ─────────────────────
 *
 * It costs money, per page, every time. The text layer is free, offline and correct on the rows it
 * can read, which is most of them — so this runs only where the free path has already said what it
 * could not do, on the pages that had a collision. Cheapest step first, and the expensive one earns
 * its place by fixing a named failure rather than by being the default.
 */

const { invoke } = require('./read_manual');

const name = 'read_symptom_table';
const description =
  'Read a symptom-keyed troubleshooting table off a rendered manual page, for the rows whose ' +
  'columns ran together in the text layer. Returns the manual\'s words, never a summary of them.';

/*
 * A shape with no columns in it at all.
 *
 * The whole failure this exists to fix is column ambiguity, so the output format must not have any:
 * one labelled line per thing, and the label says what it is. Asking for a transcription "as a
 * table" would hand the problem straight back.
 */
const PROMPT = `This is a page from an appliance manual, showing a TROUBLESHOOTING TABLE. Its left
column is a described problem and its right column holds the causes and what to do about each.

Transcribe it exactly as printed, using these labels, one per line:

  SYMPTOM: <the whole left-column text for this row, on one line>
  CAUSE: <one cause from the right column, on one line>
  STEP: <one thing to do about that cause, on one line>
  STEP: <the next thing, if there is one>
  CAUSE: <the next cause for the same symptom>
  STEP: ...

Rules:
- Copy the words. Do not explain, rephrase, tidy, summarise, or add a step the page does not print.
  Joining a cell's own wrapped lines back into one line is the ONLY rearranging allowed.
- One SYMPTOM line per row of the table. Repeat SYMPTOM for each new row.
- A cause with no steps printed beside it still gets its CAUSE line, and no STEP lines.
- Some causes carry an explanatory sentence between their numbered steps — how long something
  takes, what happens next. Those are STEP lines too, in the order printed. They are not causes.
- Ignore page numbers, headers, footers, and cross-references like "see page 38".
- If this page has no troubleshooting table on it, reply with exactly: NO TABLE

Reply with the labelled lines and nothing else. No preamble, no commentary.`;

/*
 * The hyphen the typesetter added at a line break, removed.
 *
 * A vision model reads what is printed, and what is printed is "Home Connect cannot be implemented
 * cor-" on one line and "rectly." on the next. Asked for one line it gives "cor- rectly", which is
 * faithful and useless: it does not match the same symptom read cleanly from the text layer, so the
 * merge saw two symptoms where the manual has one.
 *
 * Only between two lower-case letters. A real hyphenated word — "self-cleaning" — has no space
 * after its hyphen, and a dash between clauses has a space on both sides.
 */
const heal = (t) => String(t).replace(/([a-z])-\s+([a-z])/g, '$1$2');

/**
 * Turn the labelled lines back into the shape `readSymptoms` produces, so both readers feed the
 * same library and nothing downstream needs to know which one answered.
 */
function parseLabelled(text, { sourceName = 'service manual', page = null } = {}) {
  const symptoms = [];
  let current = null;
  let cause = null;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const m = /^(SYMPTOM|CAUSE|STEP)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const body = heal(m[2].trim());

    if (kind === 'SYMPTOM') {
      // The same symptom repeated for each of its causes is one symptom, not several.
      if (current && current.symptom === body) continue;
      current = { symptom: body, causes: [] };
      cause = null;
      if (body) symptoms.push(current);
    } else if (kind === 'CAUSE' && current) {
      cause = { label: body || null, remedies: [] };
      current.causes.push(cause);
    } else if (kind === 'STEP' && current) {
      if (!cause) {
        // A step with no cause above it. Kept under an unnamed one rather than dropped — the
        // manual printed an instruction and losing it is worse than filing it awkwardly.
        cause = { label: null, remedies: [] };
        current.causes.push(cause);
      }
      if (body) cause.remedies.push(body);
    }
  }

  const usable = symptoms.filter((s) => s.causes.length);
  return {
    found: usable.length,
    readWith: 'bedrock',
    symptoms: usable.map((s) => ({
      id: slug(s.symptom),
      symptom: s.symptom,
      causes: s.causes.map((c, k) => ({
        id: `${slug(s.symptom)}-${k}`,
        label: c.label,
        likelihood: Number((1 / (k + 1.6)).toFixed(3)),
        // A manual lists steps, never prices. Null, not zero — zero would mean free.
        cost: null,
        remedies: c.remedies,
        evidence: `${sourceName}${page ? `, page ${page}` : ''}: "${c.label || c.remedies[0] || ''}"`,
        source: { manual: sourceName, page, readWith: 'bedrock' },
      })),
    })),
    coverage: usable.length
      ? `${usable.length} symptom${usable.length === 1 ? '' : 's'} read from the page`
      : 'the page was read and held no table',
  };
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'symptom';

/**
 * @param {object} opts
 * @param {string} [opts.imagePath]   a rendered page on disk
 * @param {function} [opts.transcribe] injected, for tests — the model's only job here is turning
 *   pixels into characters, so a test supplying characters exercises the same code with the same
 *   input the model would have produced.
 */
async function read_symptom_table({ imagePath, sourceName, page, transcribe } = {}) {
  let text;
  try {
    if (transcribe) {
      text = await transcribe();
    } else {
      const fs = require('node:fs');
      const path = require('node:path');
      if (!imagePath || !fs.existsSync(imagePath)) {
        return { found: 0, symptoms: [], abstain: true, reason: `No image at ${imagePath}` };
      }
      const FORMATS = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' };
      const format = FORMATS[path.extname(imagePath).toLowerCase()] || 'jpeg';
      const base64 = fs.readFileSync(imagePath).toString('base64');
      const envelope = JSON.parse(await invoke(base64, format, PROMPT));
      text = envelope?.output?.message?.content?.[0]?.text ?? '';
    }
  } catch (e) {
    // A model that could not be reached is an absent answer, never an empty table.
    return { found: 0, symptoms: [], abstain: true, reason: e.message };
  }

  if (/^\s*NO TABLE\s*$/i.test(text)) {
    return { found: 0, symptoms: [], coverage: 'the model read the page and found no table on it' };
  }
  return { ...parseLabelled(text, { sourceName, page }), transcribed: text };
}

module.exports = { name, description, read_symptom_table, parseLabelled, PROMPT };
