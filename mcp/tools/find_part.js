/**
 * tool: find_part
 *
 * Finds the part that fits one specific model — and refuses to offer anything it cannot tie to that
 * model number. Ordering the wrong part is the most common way a DIY repair turns into a week of
 * waiting plus a return, so "probably fits" is not an answer this tool is allowed to give.
 *
 * It also always returns what the alternative costs, because the decision the owner is making is not
 * "buy this part?" — it is "part, or call someone?".
 */

const CATALOGUE = {
  'SHE3AR75UC:pump': {
    name: 'Drain pump',
    price: 38.42,
    eta: 'Tomorrow by 9pm',
    fitConfidence: 0.98,
    fitsModel: 'SHE3AR75UC',
    note: 'Bosch dishwasher drain pump assembly for this model series.',
  },
};

const ALTERNATIVE = { label: 'Service call', price: 179, eta: '7+ day wait' };

function find_part({ model, causeId }) {
  const part = CATALOGUE[`${model}:${causeId}`];

  if (!part) {
    return {
      found: false,
      reason: `No part verified against ${model} for "${causeId}". A part that only probably fits is worse than no part.`,
      alternative: ALTERNATIVE,
    };
  }

  return {
    found: true,
    part,
    alternative: ALTERNATIVE,
    saving: Number((ALTERNATIVE.price - part.price).toFixed(2)),
  };
}

module.exports = { name: 'find_part', find_part, CATALOGUE, ALTERNATIVE };
