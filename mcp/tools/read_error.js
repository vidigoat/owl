/**
 * tool: read_error
 *
 * "There's a code on the machine. What does it mean?"
 *
 * `see` returns characters. This returns meaning, by joining the characters to the fault table for
 * that specific model — because `E24` means one thing on a Bosch dishwasher and something else
 * entirely on a Samsung, and a code read correctly but interpreted against the wrong machine is
 * worse than not reading it at all.
 *
 * It is the natural first call for an agent: one round trip gets the code, what it means on this
 * machine, and whether a diagnosis can even be attempted. Everything it cannot establish it
 * returns as null with a reason, never as a confident guess.
 */

const { see } = require('./see');
const { lookup, known } = require('../../data/service-data');

const name = 'read_error';

const description =
  'Read the fault code off a photograph of an appliance display and say what it means on that ' +
  'specific model. Returns abstain when no code is shown, when the code cannot be read, or when ' +
  'there is no service data for the machine — a code interpreted against the wrong model is worse ' +
  'than no reading at all.';

/**
 * @param {object} arg
 * @param {string} [arg.imagePath]    a file on disk
 * @param {string} [arg.imageBase64]  bytes from a camera or a dropped file
 * @param {string} [arg.model]        the machine, if the caller already knows it
 * @param {string} [arg.code]         skip the photograph entirely and just interpret a code
 */
async function read_error({ imagePath, imageBase64, model, code } = {}) {
  let confidence = null;
  let readFromPhotograph = false;

  if (!code) {
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

    // A display with no fault on it is a real answer and a good one. It is not a failure to read.
    if (!read.code) {
      return {
        abstain: true,
        code: null,
        confidence: read.confidence ?? null,
        reason: 'There is no fault code on that display.',
        healthy: true,
        note: 'Nothing to diagnose. That is the correct answer, not a failed read.',
      };
    }

    code = read.code;
    confidence = read.confidence ?? null;
    readFromPhotograph = true;
    model = model || read.model || null;
  }

  code = String(code).toUpperCase().replace(/\s/g, '');

  if (!model) {
    return {
      abstain: true,
      code,
      confidence,
      readFromPhotograph,
      reason: `I can read ${code}, but not which machine it is on. The same code means different ` +
        'things on different models, so interpreting it now would be a guess.',
      nextStep: 'Photograph the rating plate, or tell me the model number.',
    };
  }

  model = String(model).toUpperCase();

  if (!known(model)) {
    return {
      abstain: true,
      code,
      model,
      confidence,
      readFromPhotograph,
      reason: `${code} on a ${model}, and I have no service data for that model.`,
      nextStep: 'Point me at its service manual and call `learn`; I can read the fault table out of it.',
    };
  }

  const found = lookup(model, code);
  if (!found.known) {
    return {
      abstain: true,
      code,
      model,
      confidence,
      readFromPhotograph,
      // Distinct from "unknown machine": we know this appliance and this code is not in its table.
      // That usually means the code was misread, and saying so is more useful than a shrug.
      reason: found.reason,
      nextStep: 'Worth re-reading the display — a misread character is the commonest cause of this.',
    };
  }

  return {
    code,
    model,
    brand: found.brand,
    kind: found.kind,
    meaning: found.meaning,
    confidence,
    readFromPhotograph,
    // How many ways this can be caused, so a caller knows whether a diagnosis is even needed.
    causeCount: found.causes.length,
    diagnosable: found.causes.length > 0,
  };
}

module.exports = { name, description, read_error };
