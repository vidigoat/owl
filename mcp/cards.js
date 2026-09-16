/**
 * What the device shows while it talks.
 *
 * Alexa+ speaks, and on an Echo Show it also draws. These are the cards — offered as MCP
 * **resources**, so a host that can render them does, and a host that cannot still gets every word
 * spoken. A card is never the only place a fact appears.
 *
 * That last rule is the one worth defending. The natural thing is to put the detail on the screen
 * and a summary in the speech, and it is wrong here: the person is kneeling in front of a machine
 * with their hands inside it and their eyes nowhere near a display. Anything they must know has to
 * survive being heard. The card is for the things eyes are better at — a probability bar, a
 * struck-through cause, an itemised total — and for those things only.
 *
 * Rendered as Markdown rather than as a component tree, deliberately. A repair step is prose and a
 * cause list is a list; inventing a widget vocabulary for that would be work in service of nothing,
 * and Markdown degrades gracefully everywhere including into speech.
 */

const bar = (p, width = 18) => {
  const filled = Math.max(0, Math.min(width, Math.round(p * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

/** The hypothesis space, mid-diagnosis. Eyes are much better at this than ears. */
function spaceCard({ model, code, meaning, space, eliminated = [], bits }) {
  const rows = [
    ...space.map((c) => `\`${bar(c.prior)}\` **${Math.round(c.prior * 100)}%** · ${c.label}`),
    ...eliminated.map((c) => `\`${'░'.repeat(18)}\` ~~${c.label}~~ · ruled out`),
  ];
  return [
    `### ${code} — ${meaning}`,
    `${model}`,
    '',
    ...rows,
    '',
    bits > 0.01 ? `_${bits.toFixed(2)} bits of uncertainty left_` : '_No uncertainty left._',
  ].join('\n');
}

/**
 * One repair step, with what comes after it.
 *
 * Deliberately shows the step you are on and not the whole procedure. A list of nine steps on a
 * screen is a list nobody reads, and the pacing exists so the device says the next one when you are
 * ready rather than when you ask.
 */
function stepCard({ step, index, total, seconds }) {
  return [
    `### Step ${index + 1} of ${total}`,
    '',
    `## ${step}`,
    '',
    seconds ? `_about ${seconds}s_` : '',
    '',
    index + 1 < total ? '_Say "next" when that is done._' : '_That is the last step._',
  ].filter(Boolean).join('\n');
}

/** The refusal. The one card that exists to stop somebody spending money. */
function refusalCard({ reason, alternative }) {
  return [
    '### NOT UPHELD — no part sold',
    '',
    "## I'm not going to guess with your money.",
    '',
    reason,
    '',
    alternative ? `_A service call for this is about ${alternative}._` : '',
  ].filter(Boolean).join('\n');
}

/** The cart. Itemised, with what the alternative costs, because that comparison is the argument. */
function checkoutCard({ part, price, tax, total, alternative }) {
  return [
    '### The part',
    '',
    `| | |`,
    `|---|---:|`,
    `| ${part} | ${price} |`,
    `| tax | ${tax} |`,
    `| **total** | **${total}** |`,
    '',
    alternative ? `_A service call would have been ${alternative}._` : '',
    '',
    '_Say "order it" to confirm._',
  ].filter(Boolean).join('\n');
}

/**
 * The static resources a host can list. Live cards are returned alongside tool results; these are
 * the ones that make sense to fetch on their own.
 */
const RESOURCES = [
  {
    uri: 'card://second-set-of-hands/how-it-decides',
    name: 'How it decides what to ask',
    description: 'The one-screen explanation of why it asks the questions it asks, for a host that wants to show its working.',
    mimeType: 'text/markdown',
    read: () => [
      '### How it decides what to ask',
      '',
      'Every question is chosen by how much uncertainty it removes **per unit of effort for you**.',
      '',
      '- Looking at something is cheap. Replacing something is not.',
      '- A question that rules out two causes beats one that rules out one.',
      '- A cheaper question within reach of the best one wins.',
      '',
      'So it asks *"can you hear the pump?"* before it asks you to buy a pump.',
      '',
      '_Nothing is ordered until one cause is left, everything cheaper has been ruled out, and the',
      'cause is not behind mains wiring._',
    ].join('\n'),
  },
  {
    uri: 'card://second-set-of-hands/what-it-will-not-do',
    name: 'What it will not do',
    description: 'The refusals, listed. The gate is the product, so it is worth being able to read it.',
    mimeType: 'text/markdown',
    read: () => [
      '### What it will not do',
      '',
      '- **Sell you a part behind mains wiring.** Not at any confidence. It books a technician.',
      '- **Sell you the expensive cause first.** The free check goes first, every time.',
      '- **Call it when two causes are close.** Within 15% is a coin toss, not a diagnosis.',
      '- **Tell you a repair worked if it could not see the panel.** It says NOT VERIFIED.',
      '- **Invent a fault code**, a model number, or a repair step that was not in the manual.',
      '',
      '_A repair copilot that sells you a pump when it is not sure is worse than no copilot: you now',
      'have the part and the original fault._',
    ].join('\n'),
  },
];

module.exports = { RESOURCES, spaceCard, stepCard, refusalCard, checkoutCard, bar };
