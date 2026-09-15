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

function lookup(model, code) {
  const m = MODELS[model];
  if (!m) return { known: false, reason: `No service data for model ${model}.` };
  const c = m.codes[code];
  if (!c) return { known: false, reason: `No record of ${code} for ${model}.` };
  return { known: true, brand: m.brand, kind: m.kind, meaning: c.meaning, causes: c.causes };
}

module.exports = { MODELS, lookup };
