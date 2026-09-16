/**
 * tool: identify_appliance
 *
 * "What machine am I looking at, and can you help me with it?"
 *
 * `see` answers the first half — it reads characters off a photograph. This answers the second,
 * which is the half an agent actually needs before it starts a conversation. Alexa+ asking a person
 * to go and photograph a rating plate is a cost; it should only pay that cost if knowing the model
 * changes what it can do.
 *
 * So this returns three things the caller can branch on without a second round trip:
 *   - what was read
 *   - whether there is service data for it
 *   - if not, what would have to happen next (a manual, and `learn` to read it)
 *
 * It never invents a model number. A brand is not a model, and "it looks like a Bosch" has never
 * once been enough to order a part.
 */

const { see } = require('./see');
const { known, MODELS, LEARNED } = require('../../data/service-data');

const name = 'identify_appliance';

const description =
  'Identify the appliance in a photograph and say whether there is service data for it. ' +
  'Returns the model number only if it was actually read off a rating plate — never inferred ' +
  'from the brand or the look of the machine. Says plainly when the machine is unknown and what ' +
  'would be needed to help with it.';

/**
 * @param {object} arg
 * @param {string} [arg.imagePath]    a file on disk (the evaluation harness)
 * @param {string} [arg.imageBase64]  bytes from a camera or a dropped file (the device)
 * @param {string} [arg.model]        skip the photograph; ask about a model we were told
 */
async function identify_appliance({ imagePath, imageBase64, model } = {}) {
  // Told, rather than shown. Cheaper and exact, so prefer it when the caller already knows.
  if (model && !imagePath && !imageBase64) {
    return describe(String(model).toUpperCase(), { read: false, confidence: null });
  }

  const read = await see({ imagePath, imageBase64 });

  if (read.simulated) {
    return {
      abstain: true,
      confidence: null,
      simulated: true,
      reason: read.reason,
      note: 'Nothing in this response was actually seen.',
    };
  }

  if (!read.model) {
    return {
      abstain: true,
      confidence: read.confidence ?? null,
      model: null,
      reason:
        'No model number in that frame. The rating plate is usually a sticker on the door jamb, ' +
        'the underside of the lid, or behind the kick plate.',
      // A fault code without a model is still worth handing back: the caller may already know the
      // machine, and throwing the code away would make them photograph it twice.
      code: read.code ?? null,
    };
  }

  return describe(read.model.toUpperCase(), { read: true, confidence: read.confidence ?? null, code: read.code ?? null });
}

function describe(model, { read, confidence, code = null }) {
  const record = MODELS[model] || LEARNED[model];

  if (!known(model)) {
    return {
      abstain: true,
      model,
      code,
      confidence,
      readFromPhotograph: read,
      haveServiceData: false,
      reason: `I can read the model — ${model} — but I have no service data for it.`,
      // The one actionable sentence. Without it this is a dead end; with it, it is a next step.
      nextStep:
        'Point me at that model\'s service manual and I can read its fault table and work from ' +
        'that instead. Call `learn` with the manual text.',
    };
  }

  return {
    model,
    code,
    confidence,
    readFromPhotograph: read,
    haveServiceData: true,
    brand: record.brand,
    kind: record.kind,
    learned: Boolean(record.generated),
    // Which codes we could actually help with. An agent can use this to set expectations before
    // asking the person to go and look at the display.
    knownCodes: Object.keys(record.codes),
    source: record.source || 'service data',
  };
}

module.exports = { name, description, identify_appliance };
