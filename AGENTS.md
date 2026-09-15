# Working in this repository

Read this before changing anything. It is written for whoever picks the work up next — a person or a
coding agent — and it is deliberately specific, because the reviewer of this project may also be
automated and will judge what it can verify from the code.

## What this is

An Alexa+ add-on: an MCP server that lets a voice assistant see a broken appliance, prove what is wrong
with it, talk the owner through the repair, and order the exact part. Submission for the Amazon
Developer Hackathon, Alexa+ track. Deadline **23 Oct 2026, 12:00 PT**.

## The one rule that decides the project

**Never assert a cause, a part, or a price that has not been verified for that specific model.**

The product is not "AI guesses what's wrong." Every other appliance app does that, and they are
confidently wrong in a way that costs people money. Our differentiator is the refusal: when the evidence
does not separate the causes, `verify_diagnosis` returns `ABSTAIN`, the copilot books a technician, and
nothing is sold. If you find yourself softening that gate to make a demo smoother, stop — you are
removing the reason this wins.

## Non-negotiables for the submission

These come from the official rules; breaking one disqualifies the entry.

1. **The MCP server must actually be called at runtime.** Not described in a README — imported, invoked,
   reachable. An automated reviewer will look for the call path.
2. **Streamable HTTP, MCP spec `2025-11-25` or later.** Not the legacy SSE transport.
3. **The repository is public with an MIT license visible on the repo page.**
4. **The demo video is under three minutes** and shows the thing working.
5. **Product feedback is part of the submission**, not an afterthought — keep `docs/FRICTION-LOG.md`
   current as you build, while the annoyance is fresh. It is worth up to a 10% scoring bonus.

## Layout

| path | what belongs there |
|---|---|
| `mcp/server.js` | transport, tool registration, nothing clever |
| `mcp/tools/*.js` | one tool per file, each independently testable, no cross-imports between tools |
| `data/` | service data keyed by model: fault codes, causes, parts. The source of truth the gate checks against |
| `engine.js` | session state the device experience renders |
| `public/` | the simulated Alexa+ device surface |
| `docs/decisions/` | short notes on any choice worth defending later |

## Conventions

- Node, no build step, no framework. If a dependency is not obviously worth it, do not add it.
- Tools take plain objects and return plain objects. No tool reaches into another tool.
- Every tool returns a `confidence` and may return `abstain: true`. Callers must handle `abstain`.
- Copy is spoken aloud. Write it as a competent person standing next to someone would say it: short
  sentences, no jargon, no apologies, never "I'm sorry, I couldn't find...".
- Screenshots in `docs/media/` are real captures only. Never commit a mockup as evidence.

## Where the demo must not drift

The recorded flow is Bosch `SHE3AR75UC`, fault `E24`, filter first, then the drain pump. Those are real
codes and a real repair order. If you change the demo appliance, change `data/` with it — do not invent
a part number for a model you have not checked.

## Definition of done for any change

- The device experience still completes the full loop without a dead end.
- `verify_diagnosis` still refuses the ambiguous case (`E09`) — there is a button for it in the UI.
- The friction log has an entry if the change was harder than it should have been.
