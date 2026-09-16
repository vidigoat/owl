/**
 * Build a fault graph from a service manual.
 *
 * This is what makes the copilot work on a machine nobody wrote code for. Given the text of a
 * manual it produces the same structure the hand-written service data has — codes, causes, checks —
 * so everything downstream (hypotheses, next_test, the trust gate) is indifferent to where the
 * knowledge came from.
 *
 * One path, two ways in.
 *
 * `parse()` is deterministic. Fault-code tables in manuals are unusually regular, and a regex that
 * finds them is honest about what it found: no code, no claim.
 *
 * The text reaching it may have been typed, or it may have been read off a photograph of the page
 * by `mcp/tools/read_manual.js`. The ordering there is the constraint: the model produces
 * CHARACTERS and this file produces causes, so a model-invented remedy can never arrive wearing a
 * citation to a line that was not printed.
 *
 * Everything carries a `source` — the page and line it came from — because the trust gate is only
 * allowed to uphold a cause that can cite something, and "the manual said so" has to mean a
 * specific place in a specific manual.
 */

/* Fault codes are not one shape. Bosch writes E24 and E:15; Samsung writes 4C and 5E; LG's entire
 * scheme is letter pairs — OE, UE, dE, FE — with no digits at all. A parser that only understands
 * "letter then number" silently fails on two of the four biggest brands, which is worse than
 * failing loudly.
 *
 * Letter-only codes need a wider gap before the description, because two capitals followed by a
 * single space is also what a sentence looks like. */
const CODE_PATTERNS = [
  /^\s*([A-Z]{1,2}[:\-\s]?\d{1,3}[A-Z]?)\s*[-–—:.\t]?\s+(.{6,200})$/, // E24, E:15, F21, E09A
  /^\s*(\d{1,2}[A-Z]{1,2})\s*[-–—:.\t]?\s+(.{6,200})$/,               // 4C, 5E, 21E
  /^\s*([A-Z]{2,3})\s*(?:[-–—:]\s*|\s{2,})(.{6,200})$/,               // OE, UE, dE, FE
];

/* Words that would otherwise read as a letter-only fault code at the start of a line. */
const NOT_A_CODE = new Set(['THE', 'AND', 'FOR', 'ARE', 'NOT', 'YOU', 'USE', 'SEE', 'ALL', 'ANY', 'CAN', 'ITS', 'OFF', 'ON', 'IF', 'IN', 'TO', 'OF', 'OR', 'AT', 'IS', 'IT', 'BE', 'DO', 'NO', 'WARNING', 'NOTE']);

function matchCodeLine(line) {
  for (const pattern of CODE_PATTERNS) {
    const m = line.match(pattern);
    if (!m) continue;
    if (NOT_A_CODE.has(m[1].toUpperCase().replace(/[:\-\s]/g, ''))) continue;
    return m;
  }
  return null;
}

/** Kept for callers that only need to ask "does this line start a fault entry?" */
const CODE_LINE = { test: (line) => matchCodeLine(line) !== null };

/** Words that mark a line as describing a remedy rather than a symptom. */
const REMEDY_HINTS = /\b(check|clean|clear|replace|inspect|remove|tighten|straighten|reset|ensure)\b/i;

/**
 * Rough cost of asking a person to do the thing described. Drives information gain.
 *
 * "Replace the drain pump" is the important case. A manual lists it as a remedy, but as a
 * *diagnostic step* it means buy a part, fit it, and see — which is exactly the expensive guessing
 * this whole project exists to prevent. It is the most costly thing we can ask for, so it must
 * never be reached for early: every free look and every cheap check has to be exhausted first.
 */
function effortOf(text) {
  if (/\b(replace|renew|fit a new|install a new|swap out)\b/i.test(text)) return 'heavy';
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
/**
 * Manuals write a fault table two ways, and so do people transcribing one.
 *
 *   E24  The machine cannot drain        the code and its meaning on one line
 *   E24
 *   The machine cannot drain             the code alone, meaning underneath
 *
 * The second is common in printed tables, where the code sits in its own narrow column, and it is
 * what a vision model produces when it transcribes such a table honestly. Rejoining them here means
 * the rest of the parser only ever sees one shape — and, more to the point, means a perfectly good
 * transcription is not thrown away over a line break.
 */
function joinOrphanCodes(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bare = /^\s*([A-Za-z]{0,3}[:\-]?\d{0,3}[A-Za-z]?)\s*$/.exec(line);
    const next = lines[i + 1];

    // A line holding only a plausible code, with something substantial under it.
    if (bare && bare[1].length >= 2 && /[A-Za-z0-9]/.test(bare[1]) && next && next.trim().length > 5
        && !NOT_A_CODE.has(bare[1].trim().toUpperCase())) {
      out.push(`${bare[1].trim()}   ${next.trim()}`);
      i++; // the meaning has been consumed
      continue;
    }
    out.push(line);
  }
  return out;
}

function parse({ model, text, sourceName = 'manual' }) {
  const lines = joinOrphanCodes(String(text).split(/\r?\n/));
  const codes = {};
  let found = 0;

  lines.forEach((line, i) => {
    const m = matchCodeLine(line);
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
      // Null, not 0. A service manual lists remedies, never prices — so what this costs is
      // UNKNOWN, and 0 would mean "free". Written as 0 it told an owner that replacing a drain
      // pump costs nothing to fix, which is both wrong and exactly the kind of confident wrong
      // answer the gate exists to prevent.
      cost: null,
      mains: isMains(remedy),
      ownerFixable: !isMains(remedy),
      evidence: `${sourceName}: "${remedy}"`,
      // The manual's own wording, kept verbatim. This is what the guide reads aloud, because a
      // remedy line IS the repair step — paraphrasing it would be inventing a procedure.
      remedy,
      source: { line: i + 1, manual: sourceName },
    }));

    if (causes.length === 0) return;
    found++;

    // A remedy check tests exactly one cause, so a table of them is irreducibly linear: a "no"
    // removes one possibility. An OBSERVATION is consistent with several causes at once, which is
    // what makes choosing the question worth anything — see eval/questions.js for the measurement
    // that made this gap visible.
    const remedyTests = causes.map((c, k) => ({
      id: `${c.id}-check`,
      question: following[k].endsWith('?') ? following[k] : `${following[k]} — did that fix it?`,
      effort: effortOf(following[k]),
      kind: 'remedy',
      outcomes: [
        { value: 'yes', say: 'yes, that was it', consistentWith: [c.id] },
        { value: 'no', say: 'no, still faulty', consistentWith: causes.filter((x) => x.id !== c.id).map((x) => x.id) },
      ],
    }));

    codes[code] = {
      meaning: description,
      causes,
      // Observations first: they cost the same to ask and rule out more.
      tests: [...observationsFrom(causes, following), ...remedyTests],
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

/*
 * There used to be an `extract()` here — a stub for model-assisted extraction, returning
 * `{ TODO: true, coverage: 'not implemented' }` and called by nobody.
 *
 * It got built, and it is `mcp/tools/read_manual.js`. Bedrock transcribes the fault table off a
 * PHOTOGRAPH of the page and hands the text to `parse()` above, which means the model never
 * produces a cause — it produces characters, and the same parser everything else uses turns those
 * into causes that each cite a line. That ordering was the constraint the stub's comment described,
 * and keeping it is why a model-invented remedy cannot reach the gate wearing a citation to a line
 * that does not exist.
 *
 * Deleted rather than left standing, because a stub nobody calls reads as work outstanding.
 */

/** Merge a generated graph into the hand-written service data shape. Hand-written wins on conflict. */
function merge(existing = {}, graph) {
  const codes = { ...graph.codes };
  Object.entries(existing).forEach(([code, entry]) => {
    codes[code] = entry; // verified data always beats generated data
  });
  return codes;
}

/**
 * The conditions a manual already contains.
 *
 *   "Replace the drain pump IF IT DOES NOT TURN"
 *   "Replace the inlet valve IF IT DOES NOT OPEN"
 *   "Check the machine is level ON ALL FOUR FEET"
 *
 * That subordinate clause is not part of the repair. It is the *observation that justifies* the
 * repair, and it is a far better question than the repair itself — "does the pump turn?" can be
 * answered by looking, costs nothing, and its answer says something about every other cause too.
 *
 * Asking "replace the drain pump — did that fix it?" makes somebody buy a pump to find out.
 *
 * A manual that contains no conditions yields no observations, and the remedy checks still work.
 * Nothing is invented: every question here is a clause that was printed on the page.
 */
/**
 * Third person singular, for a phrase read aloud.
 *
 * Only the first word is a verb — "turn on the tap" conjugates to "turns on the tap" — and only the
 * bare infinitive needs it. Anything already inflected, or not obviously a verb, is left alone:
 * a clumsy sentence is better than a wrong one, and this is spoken to somebody.
 */
function conjugate(phrase) {
  const [head, ...rest] = String(phrase).trim().split(/\s+/);
  if (!head) return phrase;
  const tail = rest.length ? ` ${rest.join(' ')}` : '';
  // Already third-person, past, or a participle: leave it.
  if (/(s|ed|ing)$/i.test(head)) return phrase;
  if (/(s|sh|ch|x|z|o)$/i.test(head)) return `${head}es${tail}`;
  if (/[^aeiou]y$/i.test(head)) return `${head.slice(0, -1)}ies${tail}`;
  return `${head}s${tail}`;
}

const CONDITION = /\b(?:if|when|where|unless)\s+(?:it\s+|the\s+\w+\s+|they\s+)?(does not|doesn't|is not|isn't|will not|won't|fails to|cannot|can't|has|is|are)\s+([a-z][a-z\s]{2,40}?)\s*$/i;

function observationsFrom(causes, remedies) {
  const out = [];

  remedies.forEach((remedy, k) => {
    const m = CONDITION.exec(remedy.trim().replace(/[.;]$/, ''));
    if (!m) return;

    const negated = /not|n't|fails|cannot/i.test(m[1]);
    const thing = m[2].trim().replace(/\s+/g, ' ');
    const cause = causes[k];
    if (!cause) return;

    // "does not turn" → "Does it turn?" — the affirmative, because that is how a person checks.
    const question = `Does it ${thing}?`;

    // The question takes the bare infinitive ("Does it turn?") and the answer does not ("yes, it
    // turns"). This is read aloud by a voice assistant, so "yes, it turn" is not a detail.
    const affirmative = conjugate(thing);

    // The manual's own implication, followed rather than guessed at. "Replace the pump if it does
    // not turn" is the manufacturer asserting that a pump which does not turn IS the fault; taking
    // them at their word is citing the manual, and every cause here already cites it.
    //
    // The information is the same as the remedy check it was derived from. What differs is the
    // PRICE of asking: "does the pump turn?" is answered by looking, and "replace the pump — did
    // that fix it?" is answered by buying a pump. next_test weighs bits against effort, so the
    // cheaper question wins on its own merits and this needs no special case.
    const holds = negated
      ? { value: 'no', say: `no, it does not ${thing}` }
      : { value: 'yes', say: `yes, it ${affirmative}` };
    const fails = negated
      ? { value: 'yes', say: `yes, it ${affirmative}` }
      : { value: 'no', say: `no, it does not ${thing}` };

    out.push({
      id: `${cause.id}-observe`,
      question,
      // Looking is easy. Replacing is heavy. That gap is the entire point of deriving this.
      effort: 'easy',
      kind: 'observation',
      derivedFrom: remedy,
      outcomes: [
        { ...holds, consistentWith: [cause.id] },
        { ...fails, consistentWith: causes.filter((c) => c.id !== cause.id).map((c) => c.id) },
      ],
    });
  });

  return out;
}

module.exports = { parse, merge, effortOf, isMains, remedyToCause, matchCodeLine, joinOrphanCodes, observationsFrom, conjugate, CONDITION, CODE_LINE };
