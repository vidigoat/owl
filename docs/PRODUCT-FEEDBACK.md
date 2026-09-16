# Product feedback

Required in the submission. Written from what was actually used, while building — the sections for
tools we have not reached yet say so rather than inventing an opinion.

---

## MCP Toolkit / Alexa+ add-on model

**What we used it for.** The whole product is an MCP server: fourteen tools covering vision,
diagnosis, the trust gate, guided repair, checkout and household memory. Everything the device shows
comes back from a tool call.

**What worked well.** The spec is a genuinely good fit for this problem. Modelling a repair as
discrete tools — *choose a check*, *fold in a result*, *decide whether the evidence justifies
spending* — made the product's central rule enforceable in one place rather than scattered through
a conversation. Tool descriptions doing double duty as the assistant's understanding of when to call
something is elegant; writing them carefully improved the design.

**What needs work.**

1. **Nothing says whether a tool can receive an image.** Alexa+ visual recognition ships on Echo
   Show, and MCP Apps covers rendering UI *to* the device thoroughly — but whether an add-on tool
   can take an image as an argument, and in what encoding, is not stated anywhere we could find.
   That single fact decides an entire product architecture. We built the vision step server-side to
   avoid the question, which may be the wrong shape.

2. **No way to test against Alexa+ itself.** Confirmed on the forum that entrants cannot call it at
   all. The simulated path is a fair accommodation, but it means the first time an add-on meets the
   real orchestrator is after submission. A read-only sandbox — one device, rate-limited — would let
   an add-on be validated before certification.

3. **Latency budget is stated but not testable.** The functional requirements ask for sub-500ms
   round trips. Without a way to call the real thing, that number can only be honoured by guesswork.

**Onboarding.** Fast. The spec plus an existing HTTP server was enough to have tools answering
within an hour. `alexa-ai` and the Add-on Agent Skill look well designed; we have not reached
deployment.

**Would we build with it again?** Yes — with the caveat that we still do not know how our add-on
behaves in front of the real assistant.

---

## Amazon Bedrock (vision)

**Status: written, not yet exercised.** The vision path is implemented against `invoke-model` via
the AWS CLI, with a prompt that instructs the model to return null rather than infer a plausible
model number. We have not run it against Bedrock — credentials are not in place — so there is no
honest feedback to give yet, and the code labels every unexercised read as simulated rather than
letting it pass as real.

One note from writing it: reaching Bedrock through the CLI rather than an SDK kept this project
dependency-free, which was worth it. `--cli-binary-format raw-in-base64-out` is the sort of detail
that costs an hour if you have not met it before.

## AgentCore Memory

**Status: not yet used.** Household memory is file-backed behind the same four functions, so the
swap is contained. No opinion to offer until it is real.

## Amazon Wallet / checkout

**Status: modelled, not yet connected.** The checkout reference was clear about the division of
responsibility — merchant owns cart, pricing, tax and fulfilment; the wallet supplies the
credential — and that clarity shaped the implementation more than any other document we read. The
`handler_id` round trip is well specified. Nothing to report until it runs against the sandbox.

---

## Friction log

Separate, and kept as things happen: [`FRICTION-LOG.md`](FRICTION-LOG.md).
