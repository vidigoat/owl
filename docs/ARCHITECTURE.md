# Architecture

Three ideas hold this up. Everything else is plumbing.

1. **Diagnosis is a search over a shrinking space**, not a lookup in a table.
2. **The knowledge can come from the machine's own manual**, so it is not limited to appliances
   someone wrote code for.
3. **One function decides whether the evidence justifies spending money**, and it is allowed to
   say no.

---

## The shape

```
  device (or Alexa+)
        │  every fact on screen comes from a tool call — the front end knows nothing
        ▼
  MCP server  ·  Streamable HTTP  ·  spec 2025-11-25  ·  mcp/server.js
        │
        ├── see ─────────────► Bedrock, via the AWS CLI. Returns nulls, never guesses.
        │                      Any read it could not perform is labelled simulated.
        │
        ├── learn ──────────► manual/faultgraph.js
        │                      a service manual → codes → causes → checks, each citing its line
        │
        ├── hypotheses ─────► the space, and its entropy in bits
        ├── next_test ──────► THE HEART: expected information gain ÷ (1 + human effort)
        ├── observe ────────► prune the space, name what was eliminated
        │
        ├── verify_diagnosis► THE GATE: the only function that can authorise spending
        │
        ├── guide ──────────► hand-written procedure, or the manual's own wording verbatim
        ├── begin_checkout ─► no cart at all for a cause the gate refused
        ├── confirm_fix ────► "could not look" is not the same answer as "still broken"
        └── remember_repair► receipts, repeat detection, consumables due
```

## The heart: choosing what to ask

`mcp/tools/next_test.js`

For each available check, compute the entropy of the space now, and the entropy expected after the
check — averaged over its outcomes, weighted by how likely each outcome is under current belief. The
difference is the information it buys. Divide by effort:

```
  EFFORT = { free: 0, easy: 1, awkward: 4, heavy: 12 }
  value  = bits gained ÷ (1 + effort)
```

Two consequences worth understanding, because they are the product:

- On a Bosch E24 the most likely cause is a blocked filter at 72%. It does **not** open by telling
  you to clean the filter. It opens with *"start a drain cycle and listen"* — free, and it rules out
  more per unit of effort.
- "Replace the drain pump" is a remedy in every manual, but as a *diagnostic step* it means buy a
  part and fit it to find out. It is the most expensive tier, so every free look and cheap check is
  exhausted first.

A check that eliminates nothing is never chosen, however cheap. When nothing left would tell it
anything, it reports being stuck rather than inventing a question.

## The gate

`mcp/tools/verify_diagnosis.js` — the only function permitted to authorise spending. It refuses when:

- there is no service data for the model or the code
- the cause sits behind mains voltage, **regardless of confidence** — this rule outranks all others
- a cheaper cause has not been ruled out yet (`ruledOut` takes **cause** ids)
- the top two causes are within 15% of each other
- the cause carries no evidence to cite

A refusal is the product working. It is tested harder than the success path, including against data
the parser wrote itself rather than data we hand-wrote.

## Learning a machine

`manual/faultgraph.js`

Fault codes are not one shape. Bosch writes `E24`, Samsung `4C`, and LG's entire scheme is letter
pairs with no digits at all — `OE`, `UE`, `dE`. Three patterns, plus a stop-list so ordinary
sentences are not mistaken for codes.

Each remedy becomes a cause (`"Replace the drain pump"` → `"Drain pump has failed"`), keeps the
manual's verbatim wording for the guide to read aloud, infers effort and mains-risk from the
language, and carries the line number it came from. The manual's ordering becomes the prior.

Verified service data always beats a learned graph on conflict.

## Seams, for when credentials arrive

| today | then |
|---|---|
| `see` shells out to the AWS CLI, labels simulated reads | same interface, real Bedrock calls |
| `home.js` writes JSON to disk | AgentCore Memory, same four functions |
| `order_part` models a checkout session | Wallet sandbox, same session/confirm shape |

None of these leak upward. The device, the diagnosis loop and the gate do not know which is running.
