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

/*
 * "Fault code E24 is lit." — the code in a sentence, not in a column.
 *
 * Found in a real Bosch dishwasher manual, and it is the phrasing that survives when a
 * three-column table is read aloud by a vision model: the table's first column becomes a sentence
 * and the code lands in the middle of it. Every pattern above wants the code at the START of the
 * line, so this format recovered nothing at all until it was handled.
 *
 * The line carries no meaning — "is lit" is not a description of the fault — so a code matched this
 * way takes its meaning from the first line beneath it that is not itself a remedy.
 */
const CODE_IN_SENTENCE =
  /^\s*(?:fault|error|alarm)\s+code\s+["'\u201C\u2018]?([A-Z]{0,2}[:\-\s]?\d{1,3}[A-Z]?|[A-Z]{2,3})["'\u201D\u2019]?\s+(?:is\s+)?(?:lit|shown|displayed|flashing|appears)/i;

/* Words that would otherwise read as a letter-only fault code at the start of a line. */
const NOT_A_CODE = new Set(['THE', 'AND', 'FOR', 'ARE', 'NOT', 'YOU', 'USE', 'SEE', 'ALL', 'ANY', 'CAN', 'ITS', 'OFF', 'ON', 'IF', 'IN', 'TO', 'OF', 'OR', 'AT', 'IS', 'IT', 'BE', 'DO', 'NO', 'WARNING', 'NOTE']);

/**
 * Phrases that are not a description of a fault.
 *
 * "E:07 is lit." parses cleanly — code, then six-plus characters of text — and hands back the
 * meaning "is lit.", which tells a reader nothing and looks like a bug in the interface. The page
 * simply does not state a meaning for these codes; the causes carry all of it. An empty meaning is
 * the honest answer and the caller can decide how to show a code with no description.
 */
const NOT_A_MEANING = /^(?:is\s+)?(?:lit|shown|displayed|flashing|on|appears|illuminated)\.?$/i;

function matchCodeLine(line) {
  const sentence = CODE_IN_SENTENCE.exec(line);
  if (sentence && !NOT_A_CODE.has(sentence[1].toUpperCase().replace(/[:\-\s]/g, ''))) {
    // No meaning on this line. `parse` fills it from the first non-remedy line beneath.
    return [line, sentence[1], ''];
  }

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
const REMEDY_HINTS = /\b(check|clean|clear|replace|inspect|remove|tighten|straighten|reset|ensure|lock|install|unscrew|descale|refill|arrange)\b/i;

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

/** Sentence case, trailing full stop removed — the shape every other label in here has. */
function tidy(text) {
  const t = String(text).trim().replace(/[.;]$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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
/**
 * A fault table whose columns reached us as delimited rows — `E24 | Water cannot drain | Check the
 * filter.`, the same with tabs, or a markdown table — rewritten as the layout the rest of this file
 * reads: the code and its meaning on one line, then one remedy per line beneath it.
 *
 * Before this, such a page came back "2 fault codes seen, none with remedies beneath them": the
 * right page, in a layout it could not read. The remedy cell is split at sentence ends and at
 * semicolons, because a cell usually holds the whole ordered list.
 *
 * Every produced line remembers the row it came from, so a citation still points at the line on
 * the page. A row whose first cell is not a code — the header, a divider — is left as it was.
 */
function expandDelimitedRows(lines) {
  const out = [];
  const origin = [];
  lines.forEach((line, i) => {
    const sep = line.includes('\t') ? '\t' : line.includes('|') ? '|' : null;
    const cells = sep ? line.split(sep).map((c) => c.trim()).filter((c, k, all) => !(c === '' && (k === 0 || k === all.length - 1))) : [];
    const code = cells.length >= 2 ? /^([A-Za-z]{0,3}[:\-]?\d{1,3}[A-Za-z]?)$/.exec(cells[0]) : null;
    if (!code || NOT_A_CODE.has(code[1].toUpperCase())) { out.push(line); origin.push(i); return; }
    const [, meaning = '', ...rest] = cells;
    out.push(`${code[1]}   ${meaning}`);
    origin.push(i);
    for (const cell of rest) {
      for (const remedy of cell.split(/(?<=[.!?])\s+|;\s*/).map((r) => r.trim()).filter((r) => r.length > 3)) {
        out.push(remedy);
        origin.push(i);
      }
    }
  });
  Object.defineProperty(out, 'origin', { value: origin });
  return out;
}

function joinOrphanCodes(lines) {
  const out = [];
  // Joining two lines into one shifts every line number after it, so a citation computed from the
  // joined array points at the wrong line of the page somebody is holding. The original index of
  // each surviving line is carried alongside.
  const origin = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bare = /^\s*([A-Za-z]{0,3}[:\-]?\d{0,3}[A-Za-z]?)\s*$/.exec(line);
    const next = lines[i + 1];

    // A line holding only a plausible code, with something substantial under it.
    if (bare && bare[1].length >= 2 && /[A-Za-z0-9]/.test(bare[1]) && next && next.trim().length > 5
        && !NOT_A_CODE.has(bare[1].trim().toUpperCase())) {
      out.push(`${bare[1].trim()}   ${next.trim()}`);
      origin.push(i);
      i++; // the meaning has been consumed
      continue;
    }
    out.push(line);
    origin.push(i);
  }

  // Metadata, not content: non-enumerable so that `joinOrphanCodes(x)` still deep-equals the plain
  // array of lines it produced. A line-number table riding along as a visible element would make
  // every caller that iterates or compares the result subtly wrong.
  Object.defineProperty(out, 'origin', { value: origin });
  return out;
}

/**
 * What came back, including the two different ways it can be empty.
 *
 *   0 codes, 0 orphans   wrong page. Go and find the fault table.
 *   0 codes, 5 orphans   RIGHT page — the remedies are not underneath the codes. Almost always a
 *                        two-column layout with the remedy in a column to the right.
 *
 * The second told somebody to go and photograph a page they were already photographing.
 */
function coverageOf(found, orphanCodes) {
  if (found > 0) return `${found} fault code${found === 1 ? '' : 's'} recovered`;
  if (orphanCodes > 0) {
    return `${orphanCodes} fault code${orphanCodes === 1 ? '' : 's'} seen, none with remedies beneath them — ` +
      'this looks like the right page, in a layout I cannot read. Are the remedies in a column to the right?';
  }
  return 'nothing usable found';
}

function parse({ model, text, sourceName = 'manual' }) {
  // Same as github.com/vidigoat/faultgraph: delimited rows first, then orphan codes.
  const expanded = expandDelimitedRows(String(text).split(/\r?\n/));
  const lines = joinOrphanCodes(expanded);
  /** Joined-array index → the line a reader would count to on the original page. */
  const onPage = (idx) => expanded.origin[lines.origin ? lines.origin[idx] : idx] + 1;
  const codes = {};
  let found = 0;
  // Codes that looked like codes but carried no remedies beneath them. Counted separately because
  // "this page has no fault table on it" and "this page has one and I cannot read its layout" are
  // different problems needing opposite things from somebody holding a manual, and they were
  // sharing one sentence — which this product then reads out loud.
  let orphanCodes = 0;

  lines.forEach((line, i) => {
    const m = matchCodeLine(line);
    if (!m) return;

    const code = normaliseCode(m[1]);
    const raw = m[2].trim();
    // "is lit" is not a fault description. Better an empty meaning than a meaningless one.
    const description = NOT_A_MEANING.test(raw) ? '' : raw;

    /*
     * Remedy lines directly beneath a code line usually belong to it — and so, it turns out, do the
     * lines between them.
     *
     * A three-column fault table (Fault | Reason | Remedial action) flattens into alternating
     * lines when it is transcribed:
     *
     *     Fault code E24 is lit.
     *     Waste-water hose kinked or blocked.              ← the manufacturer's REASON
     *     Install hose without kinks, remove any residue.  ← the remedial ACTION
     *     Siphon connection still sealed.                  ← reason
     *     Check connection to siphon and open if required. ← action
     *
     * Only the action lines carry a remedy verb, so an earlier version kept those and threw the
     * reasons away — then derived a cause back out of the remedy with `remedyToCause`. That works,
     * and it is strictly worse than reading the reason the manufacturer printed. "Waste-water hose
     * kinked or blocked" is their sentence; "Hose has failed" is our guess at their sentence.
     *
     * So a non-remedy line immediately above a remedy is kept as that remedy's stated cause.
     */
    const following = [];
    // Each remedy carries its own line number. A citation pointing at the code line instead of the
    // remedy is not a citation, it is a gesture at roughly the right part of the page.
    const atLine = [];
    /** The manufacturer's own words for the cause, where the page gave them. Sparse by design. */
    const statedCause = [];
    let pendingReason = null;

    // Twelve lines, not five: a real table runs several reason/action pairs under one code, and a
    // window sized for a short fixture truncated every genuine manual at the third cause.
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const next = lines[j].trim();
      if (!next || CODE_LINE.test(lines[j])) break;

      /*
       * An explicitly labelled row beats any inference.
       *
       * A transcription that says `REASON:` and `REMEDY:` has already told us which cell is which,
       * and guessing from verbs when the answer is written down would be perverse. "Water
       * protection system activated" carries no remedy verb and "Turn off water supply" does, so
       * the inference happens to work here — but "Check the door seal" as a REASON would fool it,
       * and a labelled line never can.
       */
      /*
       * `(.*)`, not `(.+)`: a label with nothing after it is a MERGED CELL, not a malformed line.
       *
       * Where a manual draws one reason cell across three fault codes, a faithful transcription
       * gives the second and third codes a bare `REASON:`. Requiring a body made that line fail to
       * match, fall through to the verb test, and be stored as a cause whose text was the literal
       * string "REASON:" — which then appeared on screen, under a real fault code, as the meaning
       * of E15.
       */
      const labelled = /^(REASON|CAUSE|REMEDY|ACTION|REMEDIAL ACTION)\s*:\s*(.*)$/i.exec(next);
      if (labelled) {
        const kind = labelled[1].toUpperCase();
        const body = labelled[2].trim();
        if (kind === 'REASON' || kind === 'CAUSE') {
          // Empty means the cell was shared with the code above. Not a reason, and not a string.
          pendingReason = body || null;
        } else if (body) {
          following.push(body);
          atLine.push(onPage(j));
          statedCause.push(pendingReason);
          pendingReason = null;
        } else if (pendingReason) {
          /*
           * A reason with no remedy beside it. The manual lists this code and states what it means
           * but prints its remedy in a cell shared with the codes above, which we cannot attribute.
           *
           * Recorded anyway, with no remedy. Dropping it would delete a fault code the manual
           * plainly documents — and a machine that answers "I have no record of E16" about a code
           * printed in its own manual is worse than one that says what it means and admits it
           * cannot tell you what to do about it.
           */
          following.push(null);
          atLine.push(onPage(j));
          statedCause.push(pendingReason);
          pendingReason = null;
        }
        continue;
      }

      if (REMEDY_HINTS.test(next)) {
        following.push(next);
        atLine.push(onPage(j));
        statedCause.push(pendingReason);
        pendingReason = null;
      } else {
        // Not a remedy. Hold it: if a remedy follows, this was its reason.
        pendingReason = next;
      }
    }

    const causes = following.map((remedy, k) => ({
      id: `${code.toLowerCase()}-${k}`,
      // The manufacturer's stated reason when the page gave one; our derivation when it did not.
      label: statedCause[k] ? tidy(statedCause[k]) : remedyToCause(remedy),
      // The manual's ordering is the prior: the first remedy listed is the most common.
      likelihood: Number((1 / (k + 1.6)).toFixed(3)),
      // Null, not 0. A service manual lists remedies, never prices — so what this costs is
      // UNKNOWN, and 0 would mean "free". Written as 0 it told an owner that replacing a drain
      // pump costs nothing to fix, which is both wrong and exactly the kind of confident wrong
      // answer the gate exists to prevent.
      cost: null,
      // With no remedy there is nothing to judge as mains work, and `false` would read as a
      // positive finding that this is safe to touch. Unknown, and the gate treats it as such.
      mains: remedy ? isMains(remedy) : null,
      ownerFixable: remedy ? !isMains(remedy) : null,
      evidence: remedy
        ? `${sourceName}: "${remedy}"`
        : `${sourceName}: the manual states this cause but prints no remedy beside it`,
      // The manual's own wording, kept verbatim. This is what the guide reads aloud, because a
      // remedy line IS the repair step — paraphrasing it would be inventing a procedure.
      remedy,
      source: { line: atLine[k], codeLine: onPage(i), manual: sourceName },
    }));

    if (causes.length === 0) { orphanCodes++; return; }
    found++;

    // A remedy check tests exactly one cause, so a table of them is irreducibly linear: a "no"
    // removes one possibility. An OBSERVATION is consistent with several causes at once, which is
    // what makes choosing the question worth anything — see eval/questions.js for the measurement
    // that made this gap visible.
    // A cause with no remedy printed beside it yields no test. There is nothing to ask somebody to
    // try, and inventing a step to keep the list tidy is the exact failure this whole file is
    // written to avoid. The cause still exists and is still named; it just cannot be checked.
    const remedyTests = causes
      .map((c, k) => (following[k] == null ? null : {
        id: `${c.id}-check`,
        question: following[k].endsWith('?') ? following[k] : `${following[k]} — did that fix it?`,
        effort: effortOf(following[k]),
        kind: 'remedy',
        outcomes: [
          { value: 'yes', say: 'yes, that was it', consistentWith: [c.id] },
          { value: 'no', say: 'no, still faulty', consistentWith: causes.filter((x) => x.id !== c.id).map((x) => x.id) },
        ],
      }))
      .filter(Boolean);

    codes[code] = {
      meaning: description,
      causes,
      // Observations first: they cost the same to ask and rule out more.
      tests: [...observationsFrom(causes, following), ...remedyTests],
    };
  });

  /*
   * ── One answer, stamped on every code ───────────────────────────────────
   *
   * This is a hallucination guard, and it is here because it caught a live one.
   *
   * `B18IF905SP` is a Bosch refrigerator. The page scorer picked its Home Connect pages — prose
   * about joining a Wi-Fi network, with no fault table anywhere on them — and the vision model,
   * asked to read the fault-code table on that page, produced one: seven codes (E24, E07, F21, OE,
   * 4C, 5E, H20), every single one carrying the identical meaning "REASON: The water inlet valve is
   * stuck open" and the identical cause. Four of those are not even Bosch conventions; OE and
   * 4C/5E are LG and Samsung, H20 is Whirlpool. It was admitted, and it sat in the library looking
   * like seven facts.
   *
   * Read one row at a time — which is how a reviewer reads — every row is plausible. The tell is
   * only visible across rows, so it belongs here rather than in anybody's judgement: distinct codes
   * mean distinct things. That is what a code is FOR. A reading where they all say the same
   * sentence is not a manual that repeats itself; it is one answer copied down the page.
   *
   * Refused rather than trimmed. There is no way to tell which of the seven, if any, was read off
   * the page rather than invented around it, and keeping one of them would be choosing at random
   * and calling it a fact.
   */
  const meanings = new Set(
    Object.values(codes).map((c) =>
      JSON.stringify([c.meaning || '', (c.causes || []).map((x) => [x.label || '', x.remedy || ''])])
    )
  );

  if (found >= 3 && meanings.size === 1) {
    return {
      model,
      source: sourceName,
      method: 'parsed',
      codes: {},
      found: 0,
      refused: 'every code came back with the same meaning and the same cause, which is one answer copied down the page rather than a table',
      coverage: `${found} codes were read and all of them said the same thing, so none of them was kept`,
      orphanCodes,
    };
  }

  return {
    model,
    source: sourceName,
    method: 'parsed',
    codes,
    found,
    // Said out loud in the interface. A graph with two codes from a 90-page manual is a thin graph
    // and the product should admit it rather than imply it read the whole thing.
    coverage: coverageOf(found, orphanCodes),
    orphanCodes,
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
    // No remedy printed, so no conditional clause to mine an observation out of.
    if (!remedy) return;
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
