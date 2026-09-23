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

const { lookup } = require('../../data/service-data');
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
function fromLearnedManual({ model, code, causeId } = {}) {
  const found = lookup(model, code);
  if (!found.known) return null;

  const cause = found.causes.find((c) => c.id === causeId);
  if (!cause || !cause.remedy) return null;

  // Everything the manual lists for this fault, with the chosen cause's remedy first.
  const ordered = [cause, ...found.causes.filter((c) => c.id !== causeId && c.remedy)];

  /*
   * One remedy per step. A troubleshooting table can list several remedies under one cause —
   * "Clean the Filters, Page 35." then "Clean the Drain pump, Page 48." — and joined into one line
   * they became one step with two jobs in it, read out in one breath.
   */
  const pairs = ordered.flatMap((c) => {
    const list = Array.isArray(c.remedies) && c.remedies.length ? c.remedies : [c.remedy];
    return list.filter(Boolean).map((remedy, k) => ({ c, remedy, sameCause: k > 0 }));
  });

  const steps = pairs.map(({ c, remedy, sameCause }, i) => {
    const effort = effortOf(remedy);
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

  return {
    known: true,
    generated: true,
    steps,
    totalSeconds: steps.reduce((n, s) => n + s.pace, 0),
    handsFree: true,
    citation: cause.evidence,
  };
}

function guide({ model, code, causeId } = {}) {
  const key = `${model}:${code}:${causeId}`;
  const steps = STEPS[key];

  if (!steps) {
    // Nothing hand-written — but we may have been taught this machine from its own manual.
    const learned = fromLearnedManual({ model, code, causeId });
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
