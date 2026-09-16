# 005 — Read the question out of the manual, not just the remedy

**Status:** Accepted. Measured before and after.

## How this was found

Not by inspection. By writing `eval/questions.js`, which walks every fault code on every machine and
every possible sequence of answers, and then asking a question the project had not asked itself:
*does choosing the question actually help as fault tables get bigger?*

The first answer was **0% saving at every size**, and it was tempting to treat that as a broken
benchmark. It was the finding:

> Information gain cannot beat working down a list when every check tests exactly **one** cause.

A remedy — *"try this, did it fix it?"* — is precisely that kind of check. A yes identifies one
cause; a no removes one. And a fault table is a list of remedies, so a machine learned from its
manual was getting an irreducibly linear curve that no amount of entropy arithmetic could improve.

```
  causes   one-cause checks   partitioning checks
  8        7                  3
  32       31                 5
```

The built-in machines in `data/service-data.js` did better because somebody hand-wrote observations
for them. The generality path worked, was measured as working, and was quietly weaker.

## The decision

Lift the conditions the manuals are already carrying.

> Replace the drain pump **if it does not turn**

That subordinate clause is not part of the repair. It is the observation that *justifies* the
repair — and as a question it is enormously cheaper. "Does it turn?" is answered by looking.
"Replace the drain pump — did that fix it?" is answered by buying a pump.

## What it cost, measured

```
  mean effort   2.3  →  1.1        free 0 · easy 1 · awkward 4 · heavy 12
```

The same number of questions. Less than half the work, because it stopped asking people to replace
parts in order to find out what is wrong — which is what [003](003-replacement-is-not-a-test.md)
said was wrong and could not, until now, be fixed for a machine learned at runtime.

## The constraints that keep it honest

- **Nothing is invented.** Every question is a clause that was printed on the page, and it is
  reported with `derivedFrom` so it can be checked against the manual.
- **A manual with no conditions yields no observations** and works exactly as before. The remedy
  checks are still there; observations are offered *in addition*, and `next_test` picks between them
  on bits-per-unit-effort, so the cheap question wins on its own merits with no special case.
- **The manual's implication is followed, not extended.** "Replace X if it does not turn" is the
  manufacturer asserting that a non-turning X is the fault. Taking them at their word is citing the
  manual; every cause already does.
- **It is read aloud.** The question takes a bare infinitive and the answer does not, so "yes, it
  turn" is a defect rather than a typo.

## What would change it

A manual whose conditions are unreliable — where "if it does not turn" is a caution rather than a
diagnosis. None of the four manufacturers' tables tested here read that way, but one that did would
need the observation demoted to evidence rather than treated as identifying.
