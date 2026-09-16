/**
 * Build a fault graph from a service manual.
 *
 * This is what makes the copilot work on a machine nobody wrote code for. Given the text of a
 * manual it produces the same structure the hand-written service data has — codes, causes, checks —
 * so everything downstream (hypotheses, next_test, the trust gate) is indifferent to where the
 * knowledge came from.
 *
 * Two paths, one interface:
 *   parse()   deterministic. Fault-code tables in manuals are unusually regular, and a regex that
 *             finds them is honest about what it found: no code, no claim.
 *   extract() model-assisted, for the manuals that are prose rather than tables. Stubbed until
 *             Bedrock credentials land; the shape it must return is fixed here so the rest of the
 *             system can be finished without it.
 *
 * Everything carries a `source` — the page and line it came from — because the trust gate is only
 * allowed to uphold a cause that can cite something, and "the manual said so" has to mean a
 * specific place in a specific manual.
 */

/* Fault tables look like:  "E24   Drain pump blocked   Check filter and drain hose"
 * or:                      "E:24 - Water not draining. Clean the filter."
 * Codes are 2-6 chars, letters+digits, and sit at the start of a line. */
const CODE_LINE = /^\s*([A-Z]{1,2}[:\-\s]?\d{1,3}[A-Z]?|\d[A-Z])\s*[-–—:.\t]?\s+(.{6,200})$/;

/** Words that mark a line as describing a remedy rather than a symptom. */
const REMEDY_HINTS = /\b(check|clean|clear|replace|inspect|remove|tighten|straighten|reset|ensure)\b/i;

/** Rough cost of asking a person to do the thing described. Drives information gain. */
function effortOf(text) {
  if (/\b(pull (the )?(machine|appliance) out|behind the|move the|disconnect the (mains|water)|remove the (back|panel|base))\b/i.test(text)) return 'heavy';
  if (/\b(unscrew|open the (base|panel)|take off|dismantle)\b/i.test(text)) return 'awkward';
  if (/\b(listen|look|check the display|is there|do you (hear|see))\b/i.test(text)) return 'free';
  return 'easy';
}

/** Causes behind mains voltage never become owner repairs, whatever the manual implies. */
function isMains(text) {
  return /\b(mains|voltage|wiring harness|control board|element|earth|live|terminal block)\b/i.test(text);
}

function normaliseCode(raw) {
  return raw.replace(/[:\-\s]/g, '').toUpperCase();
}

/**
 * A manual lists remedies; the interface has to show causes. "Replace the drain pump if it does not
 * run" is an instruction, and putting it in a list headed "possible causes" reads as nonsense.
 * These turn the instruction back into the thing that is wrong with the machine.
 */
const CAUSE_PHRASINGS = [
  [/^replace\s+(?:the\s+)?(.+?)(?:\s+if\b.*)?$/i, (m) => `${m[1]} has failed`],
  [/^(?:clean|clear)\s+(?:the\s+)?(.+?)(?:\s+(?:of|from)\b.*)?$/i, (m) => `${m[1]} is blocked`],
  [/^straighten\s+(?:the\s+)?(.+)$/i, (m) => `${m[1]} is kinked`],
  [/^tighten\s+(?:the\s+)?(.+)$/i, (m) => `${m[1]} is loose`],
  [/^(?:check|inspect)\s+(?:the\s+)?(.+?)\s+for\s+(.+)$/i, (m) => `${m[1]} — ${m[2]}`],
  [/^(?:check|inspect|ensure)\s+(?:the\s+)?(.+)$/i, (m) => `${m[1]}`],
];

function remedyToCause(remedy) {
  const text = remedy.replace(/\.$/, '').trim();
  for (const [pattern, phrase] of CAUSE_PHRASINGS) {
    const m = text.match(pattern);
    if (m) {
      const out = phrase(m).trim();
      return out.charAt(0).toUpperCase() + out.slice(1);
    }
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Deterministic pass over manual text.
 * Returns only what it actually found — an empty graph is a valid, honest answer.
 */
function parse({ model, text, sourceName = 'manual' }) {
  const lines = String(text).split(/\r?\n/);
  const codes = {};
  let found = 0;

  lines.forEach((line, i) => {
    const m = line.match(CODE_LINE);
    if (!m) return;

    const code = normaliseCode(m[1]);
    const description = m[2].trim();

    // Remedy lines directly beneath a code line usually belong to it.
    const following = [];
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const next = lines[j].trim();
      if (!next || CODE_LINE.test(lines[j])) break;
      if (REMEDY_HINTS.test(next)) following.push(next);
    }

    const causes = following.map((remedy, k) => ({
      id: `${code.toLowerCase()}-${k}`,
      label: remedyToCause(remedy),
      // The manual's ordering is the prior: the first remedy listed is the most common.
      likelihood: Number((1 / (k + 1.6)).toFixed(3)),
      cost: 0,
      mains: isMains(remedy),
      ownerFixable: !isMains(remedy),
      evidence: `${sourceName}: "${remedy}"`,
      source: { line: i + 1 },
    }));

    if (causes.length === 0) return;
    found++;

    codes[code] = {
      meaning: description,
      causes,
      tests: causes.map((c, k) => ({
        id: `${c.id}-check`,
        question: following[k].endsWith('?') ? following[k] : `${following[k]} — did that fix it?`,
        effort: effortOf(following[k]),
        outcomes: [
          { value: 'yes', say: 'yes, that was it', consistentWith: [c.id] },
          { value: 'no', say: 'no, still faulty', consistentWith: causes.filter((x) => x.id !== c.id).map((x) => x.id) },
        ],
      })),
    };
  });

  return {
    model,
    source: sourceName,
    method: 'parsed',
    codes,
    found,
    // Said out loud in the interface. A graph with two codes from a 90-page manual is a thin graph
    // and the product should admit it rather than imply it read the whole thing.
    coverage: found === 0 ? 'nothing usable found' : `${found} fault code${found === 1 ? '' : 's'} recovered`,
  };
}

/**
 * Model-assisted extraction, for manuals whose fault information is prose.
 * TODO: Bedrock. Must return the identical shape as parse(), with method: 'extracted' and a source
 * for every cause — a cause the model invented without a citation must never reach the gate.
 */
async function extract({ model, text, sourceName = 'manual' }) {
  return { model, source: sourceName, method: 'extracted', codes: {}, found: 0, coverage: 'not implemented', TODO: true };
}

/** Merge a generated graph into the hand-written service data shape. Hand-written wins on conflict. */
function merge(existing = {}, graph) {
  const codes = { ...graph.codes };
  Object.entries(existing).forEach(([code, entry]) => {
    codes[code] = entry; // verified data always beats generated data
  });
  return codes;
}

module.exports = { parse, extract, merge, effortOf, isMains, remedyToCause, CODE_LINE };
