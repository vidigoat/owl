# Service data

This is the only file in the project that can cause somebody to spend money.

`verify_diagnosis` reads nothing else. A manual can add a *cause* — see
[`manual/faultgraph.js`](../manual/faultgraph.js) and the hostile-manual tests — but only a row here
can carry a price, and only a priced row can open a cart. That boundary is what makes learning from
an arbitrary page safe, so it is worth understanding before editing anything below.

## Shape

```js
'SHE3AR75UC': {                                  // the model number, exactly as printed on the plate
  brand: 'Bosch',
  kind: 'Dishwasher',
  codes: {
    E24: {
      meaning: 'Water cannot leave the machine during the pump-out phase.',
      causes: [ … ],
      tests:  [ … ],
    },
  },
}
```

### A cause

```js
{
  id: 'filter',                                  // stable; tests and the gate refer to it
  label: 'Blocked filter or drain path',         // what is WRONG, never an instruction
  likelihood: 0.72,                              // prior from service data, not from this household
  cost: 0,                                       // 0 = genuinely free. null = UNKNOWN. never confuse them
  mains: false,                                  // behind mains voltage? outranks everything if true
  ownerFixable: true,
  evidence: 'Bosch service data lists a blocked filter as the first check for E24 on this model line.',
}
```

Four fields do real work and are easy to get subtly wrong:

**`cost: 0` vs `cost: null`.** Zero means the repair is free. Null means nobody knows what it costs.
These are opposite facts and collapsing them once told an owner that replacing a drain pump *"costs
nothing to fix"*. Causes learned from a manual always carry `null`, because a service manual lists
remedies and never prices.

**`mains`** outranks every other consideration including certainty. A cause behind mains voltage is
never an owner repair, at any confidence, and the gate books a technician instead. Set it true
whenever the repair requires getting past the mains supply — a heating element, a control board, a
motor winding. Being wrong in the cautious direction costs a service call. Being wrong the other way
costs more than this project is worth.

**`likelihood`** is a population prior, not a posterior. It is what fails on this model across
everybody's kitchen, and it is used to pick which question to ask next — never presented to a person
as confidence.

**`evidence`** is what the gate cites when it upholds a cause. A cause that cannot say where it came
from cannot be upheld, so this is not optional and "it seemed likely" is not an entry.

### A test

```js
{
  id: 'pump-hum',
  question: 'Start a drain cycle and listen. Can you hear the pump humming?',
  effort: 'free',                                // free · easy · awkward · heavy
  outcomes: [
    { value: 'hums',   say: 'it hums',      consistentWith: ['filter', 'hose'] },
    { value: 'silent', say: "it's silent",  consistentWith: ['pump'] },
  ],
}
```

**`effort` is what it costs the person, not the machine.** That is what stops the copilot asking
somebody to haul a dishwasher out of a cabinet to save itself one question. `free` is looking or
listening; `heavy` is replacing a part, which is a repair pretending to be a test — see
[decision 003](../docs/decisions/003-replacement-is-not-a-test.md).

**Prefer an observation to a remedy.** `consistentWith` listing *several* causes is what makes a
question worth choosing at all: a check that identifies exactly one cause can never beat working
down the list. *"Can you hear the pump?"* splits three causes in one question; *"replace the pump —
did that fix it?"* removes one and costs £89. `npm run questions` measures the difference.

**`say`** is read aloud. Write what a person would actually answer, not a form label.

## Rules for adding a row

1. **Never invent a part number.** Not for a model you have not checked, not "probably compatible".
   `find_part` returns nothing rather than a part that only probably fits, and that is the desired
   behaviour — a wrong part costs somebody money and a week.
2. **Fault codes must be real.** The ones here are genuine Bosch, Whirlpool, LG and Samsung codes.
3. **`mains: true` when unsure.** The asymmetry above.
4. **Every cause cites something.** The gate will not uphold one that cannot.
5. **Write tests as observations where the manual allows it**, and let the effort tier do the rest.

## What is here now

| model | brand | codes | note |
|---|---|---|---|
| `SHE3AR75UC` | Bosch | `E24`, `E09` | fully specified — causes, priors, observations, parts |
| `WFW5620HW` | Whirlpool | `F21` | code only; the manual path fills the rest |
| `WM3900HWA` | LG | `OE` | code only — letter-pair scheme, which is why the parser has three patterns |
| `WF45T6000AW` | Samsung | `4C` | code only |

The three stubs exist so the learning path has real model numbers and real codes to attach to.
Anything learned at runtime lands in `LEARNED` and is marked `generated: true`, so the interface can
say where a cause came from and hand-written data always wins a conflict.
