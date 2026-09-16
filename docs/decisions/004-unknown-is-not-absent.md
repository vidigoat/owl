# 004 — "I could not establish X" is not "X is absent"

**Status:** Accepted. Enforced by `mcp/tools/absence.test.js`.

## Why this needed a decision record

It was already a written rule. The project shipped four violations of it anyway, all in one
afternoon, all discovered within twenty minutes of pointing the vision path at real AWS for the
first time:

| what happened | what it was reported as |
|---|---|
| a display read at 0.1 confidence showing nothing | **"the fault cleared"** |
| the model wrote the string `"null"` in the code field | fault code `NULL` |
| a photograph of a rating plate with no display in it | the label's `FD 9902` as a fault code |
| the CLI call failing and returning nothing usable | a read |

Every unit test had been green throughout, against a path that had never once succeeded.

## The distinction

**UNKNOWN** — we did not establish it. Nobody may act on this.
**ABSENT** — we established that there is nothing. This is a finding, and often a good one.

They look identical from outside. Both have no fault code. One ends the conversation happily and the
other must not.

## What follows from it

- A confidence floor under **confirming** a repair, and deliberately not under contradicting one. A
  poor read still showing the original code is fine evidence the repair failed; only the answer that
  sends someone away satisfied needs to be sure.
- `noCodeShown`, so an agent that asked "any lights on the panel?" and heard "nothing" can report an
  established absence instead of being forced to demand a photograph.
- Words meaning nothing — `null`, `none`, `N/A`, `-` — never survive as values.
- Every refusal carries a reason. A refusal a person cannot act on is only a slightly better failure.

## The rule about the rule

A rule lives in someone's head. A test lives in the repository. When the same mistake appears twice,
stop restating the principle and write the test that makes it unshippable — which is what
`absence.test.js` is, and why it is organised by the mistake rather than by the tool.
