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

function guide({ model, code, causeId }) {
  const key = `${model}:${code}:${causeId}`;
  const steps = STEPS[key];

  if (!steps) {
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
