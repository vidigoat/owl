/**
 * SECOND SET OF HANDS — Alexa+ repair copilot
 *
 * Real shape of the system (only the device shell and the vision call are simulated today):
 *
 *   MCP server (Streamable HTTP, spec 2025-11-25) exposing:
 *     identify_appliance(image)      -> brand, model, confidence      [Bedrock vision]
 *     read_error(image)              -> fault code                    [Bedrock vision]
 *     diagnose(model, code)          -> ranked causes                 [service data]
 *     verify_diagnosis(model, cause) -> upheld | ABSTAIN              <-- the trust gate
 *     guide(model, cause)            -> hands-free steps
 *     find_part(model, cause)        -> exact part for THIS model
 *     order_part(part)               -> Amazon Wallet checkout
 *     home.remember / home.due       -> AgentCore Memory
 *     confirm_fix(image)             -> re-read the panel, prove the fault cleared
 *
 * The Alexa+ layer is the simulated web experience the hackathon rules explicitly allow;
 * every tool above is a real MCP call in the repo.
 */

const APPLIANCE = {
  brand: 'Bosch',
  model: 'SHE3AR75UC',
  kind: 'Dishwasher',
  bought: 'March 2021',
  plateConfidence: 0.97,
};

const FAULT = {
  code: 'E24',
  meaning: 'Water cannot leave the machine during the pump-out phase.',
  codeConfidence: 0.99,
};

/** Ranked causes. The first is cheap and common; only if it fails do we reach the paid part. */
const CAUSES = [
  {
    id: 'filter',
    label: 'Blocked filter or drain path',
    likelihood: 0.72,
    cost: 0,
    verified: true,
    evidence: 'Bosch service data lists a blocked filter as the first check for E24 on this model line.',
  },
  {
    id: 'pump',
    label: 'Failed drain pump',
    likelihood: 0.21,
    cost: 38,
    verified: true,
    evidence: 'Confirmed for this model when the filter path is clear and the pump does not spin up.',
  },
];

const STEPS = [
  {
    n: 1,
    say: 'Open the door and pull the bottom rack all the way out.',
    detail: 'You are looking at the round filter in the floor of the machine.',
    hands: 'both hands',
  },
  {
    n: 2,
    say: 'Twist the round filter anticlockwise and lift it out.',
    detail: 'A quarter turn. It lifts straight up once it releases.',
    hands: 'both hands',
  },
  {
    n: 3,
    say: 'Clear anything sitting in the well underneath, then rinse the filter.',
    detail: 'Most E24 faults on this model end here.',
    hands: 'both hands',
  },
  {
    n: 4,
    say: 'Drop the filter back in, twist clockwise until it stops, and run a rinse cycle.',
    detail: 'I will watch for the code to come back.',
    hands: 'both hands',
  },
];

const PART = {
  name: 'Drain pump',
  fitsModel: 'SHE3AR75UC',
  price: 38.42,
  eta: 'Tomorrow by 9pm',
  alternative: { label: 'Service call', price: 179, eta: '7+ day wait' },
  fitConfidence: 0.98,
};

/** The refusal path. This is the product, not an edge case. */
const ABSTAIN_CASE = {
  code: 'E09',
  model: 'SHE3AR75UC',
  causes: ['Heating element', 'Control board', 'Wiring harness'],
  verdict: 'ABSTAIN',
  say:
    "I can see an E09, but I can't tell you which of three parts it is without opening the base, and one of them is mains wiring. I'm not going to guess with your money. This one's worth a technician.",
  why:
    'Three causes sit within 12% of each other, and one involves mains voltage. The verifier refused to uphold a single cause, so the copilot books help instead of selling a part.',
};

/** What the household remembers, and what that lets it do next. */
const MEMORY = [
  { appliance: 'Bosch SHE3AR75UC dishwasher', note: 'E24 cleared by filter clean', when: 'today' },
  { appliance: 'LG LFXS26973S fridge', note: 'Water filter fitted 6 months ago — due now', when: 'due' },
  { appliance: 'Whirlpool WFW5620HW washer', note: 'No faults on record', when: '—' },
];

/** The tool trace shown beside the device, so the engineering is visible. */
const TRACE = {
  look: [
    { tool: 'identify_appliance', arg: 'frame.jpg', out: 'Bosch SHE3AR75UC · 0.97', ms: 620, tech: 'Bedrock vision' },
    { tool: 'read_error', arg: 'frame.jpg', out: 'E24 · 0.99', ms: 310, tech: 'Bedrock vision' },
    { tool: 'home.remember', arg: 'appliance', out: 'stored', ms: 40, tech: 'AgentCore Memory' },
  ],
  verify: [
    { tool: 'diagnose', arg: 'SHE3AR75UC, E24', out: '2 ranked causes', ms: 480, tech: 'service data' },
    { tool: 'verify_diagnosis', arg: 'filter path', out: 'UPHELD', ms: 390, tech: 'trust gate' },
  ],
  guide: [{ tool: 'guide', arg: 'E24 / filter', out: '4 steps, hands-free', ms: 210, tech: 'MCP Apps card' }],
  part: [
    { tool: 'find_part', arg: 'SHE3AR75UC drain pump', out: '$38.42 · fits 0.98', ms: 540, tech: 'parts catalog' },
    { tool: 'order_part', arg: 'confirm', out: 'Wallet checkout', ms: 700, tech: 'Amazon Wallet' },
  ],
  confirm: [
    { tool: 'confirm_fix', arg: 'frame.jpg', out: 'no fault code · cycle running', ms: 350, tech: 'Bedrock vision' },
    { tool: 'home.remember', arg: 'repair receipt', out: 'stored', ms: 45, tech: 'AgentCore Memory' },
  ],
};

module.exports = { APPLIANCE, FAULT, CAUSES, STEPS, PART, ABSTAIN_CASE, MEMORY, TRACE };
