const fs = require('node:fs');
const path = require('node:path');

/**
 * Service data, keyed by model.
 *
 * Fault codes here are real, published manufacturer codes. Part numbers are deliberately absent
 * until each one has been checked against the specific model — see AGENTS.md. A cause carries the
 * evidence that justifies it, because `verify_diagnosis` is only allowed to uphold a cause that
 * cites something.
 */

const MODELS = {
  'SHE3AR75UC': {
    brand: 'Bosch',
    kind: 'Dishwasher',
    codes: {
      E24: {
        meaning: 'Water cannot leave the machine during the pump-out phase.',
        // The checks a technician would actually run, and what each outcome rules out.
        // `effort` is what it costs the person, not the machine — that is what stops the copilot
        // asking someone to haul a dishwasher out of a cabinet to save itself one question.
        tests: [
          {
            id: 'pump-hum',
            question: 'Start a drain cycle and listen. Can you hear the pump humming?',
            effort: 'free',
            outcomes: [
              { value: 'hums', say: 'it hums', consistentWith: ['filter', 'hose'] },
              { value: 'silent', say: "it's silent", consistentWith: ['pump'] },
            ],
          },
          {
            id: 'filter-check',
            question: 'Twist the filter out and look at it. Is it clogged?',
            effort: 'easy',
            outcomes: [
              { value: 'clogged', say: "it's clogged", consistentWith: ['filter'] },
              { value: 'clean', say: "it's clean", consistentWith: ['pump', 'hose'] },
            ],
          },
          {
            id: 'hose-check',
            question: 'Pull the machine out and check the drain hose behind it. Is it kinked?',
            effort: 'heavy',
            outcomes: [
              { value: 'kinked', say: "it's kinked", consistentWith: ['hose'] },
              { value: 'straight', say: "it's fine", consistentWith: ['filter', 'pump'] },
            ],
          },
        ],
        causes: [
          {
            id: 'filter',
            label: 'Blocked filter or drain path',
            likelihood: 0.72,
            cost: 0,
            mains: false,
            ownerFixable: true,
            evidence: 'Bosch service data lists a blocked filter as the first check for E24 on this model line.',
          },
          {
            id: 'pump',
            label: 'Failed drain pump',
            likelihood: 0.21,
            cost: 38,
            mains: false,
            ownerFixable: true,
            evidence: 'Confirmed for this model when the filter path is clear and the pump does not spin up.',
          },
          {
            id: 'hose',
            label: 'Kinked or blocked drain hose',
            likelihood: 0.07,
            cost: 0,
            mains: false,
            ownerFixable: true,
            evidence: 'Occurs after the machine has been moved.',
          },
        ],
      },
      E09: {
        meaning: 'The water is not heating.',
        causes: [
          { id: 'element', label: 'Heating element', likelihood: 0.38, cost: 95, mains: true, ownerFixable: false, evidence: 'Element sits in the base, behind mains wiring.' },
          { id: 'board', label: 'Control board', likelihood: 0.33, cost: 210, mains: true, ownerFixable: false, evidence: 'Presents identically to an element failure without a meter.' },
          { id: 'harness', label: 'Wiring harness', likelihood: 0.29, cost: 60, mains: true, ownerFixable: false, evidence: 'Chafed harness gives the same symptom.' },
        ],
      },
    },
  },

  // Codes carried for breadth; causes intentionally not filled in until checked per model.
  'WFW5620HW': { brand: 'Whirlpool', kind: 'Washer', codes: { F21: { meaning: 'Draining is taking too long.', causes: [] } } },
  'WM3900HWA': { brand: 'LG', kind: 'Washer', codes: { OE: { meaning: 'The machine cannot drain.', causes: [] } } },
  'WF45T6000AW': { brand: 'Samsung', kind: 'Washer', codes: { '4C': { meaning: 'The machine is not getting water.', causes: [] } } },
};

/**
 * Models learned at runtime from a service manual, keyed the same way as the hand-written ones.
 * Verified data always wins: `learn` will not overwrite a model that is already in MODELS.
 */
const LEARNED = {};

function learn({ model, brand = 'Unknown', kind = 'Appliance', codes, source }) {
  if (MODELS[model]) return { learned: false, reason: `${model} already has verified service data.` };
  if (!codes || Object.keys(codes).length === 0) return { learned: false, reason: 'Nothing usable was recovered from that manual.' };
  LEARNED[model] = { brand, kind, codes, source, generated: true };
  return { learned: true, model, codes: Object.keys(codes).length };
}

/**
 * Machines read from a manufacturer's manual and then checked by a person, one fault code at a
 * time, on the review bench. Loaded from `data/admitted/` at startup.
 *
 * Kept as its own tier rather than merged into MODELS, because the three have genuinely different
 * provenance and the difference is the product:
 *
 *   MODELS    written by hand against a manual somebody read.
 *   ADMITTED  read by a machine, then confirmed code by code against the page it came from.
 *   LEARNED   read by a machine this session and confirmed by nobody. Never persisted.
 *
 * Collapsing them would erase the one distinction this library exists to maintain. A caller that
 * wants to know how a fact got here can ask; `provenance()` answers.
 */
const ADMITTED = loadAdmitted();

function loadAdmitted() {
  const dir = path.join(__dirname, 'admitted');
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return out; // nothing has been reviewed yet, which is the normal state of a new checkout
  }
  for (const f of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      // Belt and braces: `admit` only ever writes reviewed records, but this directory is on disk
      // and the one thing that must not happen is an unreviewed machine answering as a reviewed one.
      if (rec && rec.model && rec.reviewed === true) out[rec.model] = rec;
    } catch { /* an unreadable record is not a machine */ }
  }
  return out;
}

/** Hand-written first, then human-checked, then this session's unchecked reading. */
const find = (model) => MODELS[model] || ADMITTED[model] || LEARNED[model];

/** How a machine's data got here, for anything that needs to say so out loud. */
function provenance(model) {
  if (MODELS[model]) return 'written by hand from the manual';
  if (ADMITTED[model]) {
    const r = ADMITTED[model];
    return `read from ${r.source || 'a manual'} and checked by ${r.reviewedBy || 'a reviewer'}`;
  }
  if (LEARNED[model]) return 'read from a manual this session and checked by nobody';
  return null;
}

function known(model) {
  return Boolean(find(model));
}

function lookup(model, code) {
  const m = find(model);
  if (!m) return { known: false, reason: `No service data for model ${model}.` };
  const c = m.codes[code];
  if (!c) return { known: false, reason: `No record of ${code} for ${model}.` };
  return {
    known: true,
    brand: m.brand,
    kind: m.kind,
    meaning: c.meaning,
    causes: c.causes,
    provenance: provenance(model),
  };
}

module.exports = { MODELS, LEARNED, ADMITTED, lookup, learn, known, provenance, loadAdmitted };
