/**
 * tool: guide
 *
 * Turns an upheld cause into steps a person can follow with their hands inside a machine.
 *
 * The constraint that shapes this tool: the person is not looking at the screen. They are lying on a
 * kitchen floor with a torch. So each step is one instruction, said in one breath, and it never
 * refers to anything visual ("as shown below" is useless here). `pace` is how long the step usually
 * takes, which is what lets the copilot wait rather than race ahead.
 */

const STEPS = {
  'SHE3AR75UC:E24:filter': [
    { n: 1, say: 'Open the door and pull the bottom rack all the way out.', detail: 'You are looking at the round filter in the floor of the machine.', pace: 8, hands: 'both' },
    { n: 2, say: 'Twist the round filter anticlockwise and lift it out.', detail: 'A quarter turn. It lifts straight up once it releases.', pace: 12, hands: 'both' },
    { n: 3, say: 'Clear anything sitting in the well underneath, then rinse the filter.', detail: 'Most E24 faults on this model end here.', pace: 40, hands: 'both' },
    { n: 4, say: 'Drop the filter back in, twist clockwise until it stops, and run a rinse cycle.', detail: 'I will watch for the code to come back.', pace: 20, hands: 'both' },
  ],
  'SHE3AR75UC:E24:pump': [
    { n: 1, say: 'Switch the machine off at the wall before you start.', detail: 'Not the door switch. The socket.', pace: 10, hands: 'both' },
    { n: 2, say: 'Take the filter out again, then lift off the white pump cover underneath.', detail: 'It unclips. No tools.', pace: 25, hands: 'both' },
    { n: 3, say: 'Unclip the old pump, push the new one in until it clicks, and refit the cover.', detail: 'It only goes in one way round.', pace: 60, hands: 'both' },
    { n: 4, say: 'Power it back on and run a rinse cycle.', detail: 'I will check the panel when it finishes.', pace: 20, hands: 'both' },
  ],
};

const { lookup, procedureFor } = require('../../data/service-data');
const { effortOf } = require('../../manual/faultgraph');

/** How long a step plausibly takes, from what it asks the person to do. */
const PACE = { free: 10, easy: 25, awkward: 45, heavy: 90 };

/**
 * A procedure recovered from a manual we were handed at runtime.
 *
 * The manual's remedy line is read out verbatim. That is deliberate: the moment we start
 * rephrasing instructions about dismantling an appliance, we are inventing a procedure, and the
 * whole argument of this project is that it does not do that.
 */
function fromLearnedManual({ model, code, causeId, ruledOut = [] } = {}) {
  const found = lookup(model, code);
  if (!found.known) return null;

  const cause = found.causes.find((c) => c.id === causeId);
  if (!cause || !cause.remedy) return null;

  // The chosen cause's remedy first, then the manual's other remedies as "if that did not do it"
  // fallbacks — but never a cause the owner has already ruled out. A ruled-out cause is not an
  // untested alternative, it is a disproven one, and reading "replace the drain pump if it does not
  // turn" to someone who just confirmed it turns is the guessing this product exists to refuse.
  const ruled = new Set((Array.isArray(ruledOut) ? ruledOut : []).map(String));
  // …and never a remedy behind mains wiring. guide() refuses a mains cause outright; a fallback is
  // the same sentence read out one step later, so those are withheld here and counted.
  const others = found.causes.filter((c) => c.id !== causeId && c.remedy && !ruled.has(c.id));
  const withheld = others.filter((c) => c.mains === true);
  const ordered = [cause, ...others.filter((c) => c.mains !== true)];

  /*
   * One remedy per step. A troubleshooting table can list several remedies under one cause —
   * "Clean the Filters, Page 35." then "Clean the Drain pump, Page 48." — and joined into one line
   * they became one step with two jobs in it, read out in one breath.
   */
  const pairs = ordered.flatMap((c) => {
    const list = Array.isArray(c.remedies) && c.remedies.length ? c.remedies : [c.remedy];
    return list.filter(Boolean).map((remedy, k) => ({ c, remedy, sameCause: k > 0 }));
  });

  /*
   * A remedy that only points — "Clean the Filters, Page 35." — becomes the procedure on that page,
   * when one was followed and checked (data/procedures/). Its steps are the manual's sentences,
   * each carrying its page, and each saying plainly that a script checked it and a person has not.
   * Where nothing checked out, the pointer is read as it is: better "see page 48" than a guess.
   */
  const expanded = pairs.flatMap((pair) => {
    const proc = procedureFor(model, pair.remedy);
    if (!proc) return [pair];
    return proc.steps.map((st, k) => ({
      ...pair,
      remedy: st.text,
      sameCause: k > 0 || pair.sameCause,
      procedure: proc,
      procStep: st,
      first: k === 0,
    }));
  });

  const steps = expanded.map(({ c, remedy, sameCause, procedure, procStep, first }, i) => {
    const effort = effortOf(remedy);
    if (procedure) {
      return {
        n: i + 1,
        say: remedy,
        detail: [
          first ? `From "${procedure.heading}", page ${procedure.pages[0]} of the manual.` : '',
          ...(procStep.notes || []),
        ].filter(Boolean).join(' ') || `Step ${procStep.n} of "${procedure.heading}".`,
        pace: PACE[effort] ?? PACE.easy,
        paceEstimated: true,
        hands: 'both',
        source: { manual: c.source?.manual || 'manual', page: procStep.page },
        reviewed: false,
        checkedBy: 'script',
      };
    }
    return {
      n: i + 1,
      say: remedy,
      // A symptom's key is a slug of its sentence, and a slug read aloud is noise.
      detail: i === 0
        ? `This is what the manual lists first for ${found.keyedBy === 'symptom' ? 'this problem' : code}.`
        : sameCause ? 'The manual lists this next for the same cause.' : 'If that did not do it, this is next.',
      /*
       * Pacing, not a promise. The manual states no durations; this is guessed from the kind of
       * work the remedy describes, so the device can wait a sensible while before prompting. It is
       * marked as such, and nothing reads it out: a live run told somebody cleaning the filters
       * "usually takes about 25 seconds", which no manual said.
       */
      pace: PACE[effort] ?? PACE.easy,
      paceEstimated: true,
      hands: 'both',
      source: c.source,
    };
  });

  const followed = [...new Set(expanded.filter((x) => x.procedure).map((x) => x.procedure))];
  return {
    known: true,
    generated: true,
    ...(followed.length ? {
      procedures: followed.map((p) => ({ reference: p.reference, heading: p.heading, pages: p.pages, reviewed: false, checkedBy: p.checkedBy })),
    } : {}),
    steps,
    totalSeconds: steps.reduce((n, s) => n + s.pace, 0),
    handsFree: true,
    citation: cause.evidence,
    ...(withheld.length ? {
      mainsWithheld: withheld.length,
      beyond: `The manual lists ${withheld.length === 1 ? 'one more remedy' : `${withheld.length} more remedies`} for this fault that ${withheld.length === 1 ? 'is' : 'are'} behind mains wiring. If these steps do not fix it, that is a technician's job, and it is not read out here.`,
    } : {}),
  };
}

function guide({ model, code, causeId, ruledOut = [] } = {}) {
  /*
   * Mains work is refused HERE, not only at the gate.
   *
   * verify_diagnosis refuses a cause behind mains wiring, and the bundled agent only reaches guide
   * after an upheld diagnosis. But guide is a tool on a public MCP server, and Alexa+ — or any
   * agent — can call it directly with a cause id. For a machine learned from its manual that
   * returned the manual's own remedy, verbatim: "Replace the heating element". A safety rule that
   * holds only when the caller asks in the right order is a convention, so the one function that
   * turns a cause into steps checks it for itself.
   */
  const found = lookup(model, code);
  const target = found.known ? (found.causes || []).find((c) => c.id === causeId) : null;
  if (target && target.mains === true) {
    return {
      known: false,
      refused: true,
      mains: true,
      reason: 'That repair is behind mains wiring. It is a technician\'s job, and it is not talked through here.',
      escalate: 'technician',
      steps: [],
    };
  }

  const key = `${model}:${code}:${causeId}`;
  const steps = STEPS[key];

  if (!steps) {
    // Nothing hand-written — but we may have been taught this machine from its own manual.
    const learned = fromLearnedManual({ model, code, causeId, ruledOut });
    if (learned) return learned;

    return {
      known: false,
      reason: `No verified procedure for ${causeId} on ${model} ${code}. Not going to improvise one.`,
      steps: [],
    };
  }

  return {
    known: true,
    steps,
    totalSeconds: steps.reduce((n, s) => n + s.pace, 0),
    handsFree: steps.every((s) => s.hands === 'both'),
  };
}

module.exports = { name: 'guide', guide, STEPS };
