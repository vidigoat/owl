# Second Set of Hands

**An Alexa+ add-on that sees what's broken and fixes it with you — hands-free, down to the part on your doorstep.**

Point an Echo Show at a blinking appliance panel. It reads the fault code and the model plate, proves the
diagnosis against that model's service data before asking you to spend anything, talks you through the
repair while your hands are inside the machine, and orders the exact part through Amazon Wallet.

> **Status:** scaffold. The structure below is final; sections marked `TODO` stay unwritten until the
> feature they describe exists. No screenshot is committed until it is a real capture.

<!-- MEDIA: docs/media/hero.png — the device screen mid-repair, one instruction large, fault code visible. -->
![TODO hero](docs/media/hero.png)

---

## Contents

- [The problem](#the-problem)
- [What it does](#what-it-does)
- [See it run](#see-it-run)
- [The trust gate](#the-trust-gate)
- [Architecture](#architecture)
- [MCP tool surface](#mcp-tool-surface)
- [Built with](#built-with)
- [Run it yourself](#run-it-yourself)
- [What is real and what is simulated](#what-is-real-and-what-is-simulated)
- [For reviewers](#for-reviewers)
- [Repository map](#repository-map)
- [License](#license)

---

## The problem

`TODO` — four numbers and one sentence of consequence:

- `$179` average appliance repair call, before parts
- `$60–100` diagnostic fee just for the visit
- `7+ days` typical wait, worse rurally
- `39%` of Americans have thrown out a large appliance they couldn't get fixed
- roughly **one in three** service calls are things the owner could have done themselves

---

## What it does

`TODO` — the flow, in the order it happens, one line each:

| stage | what happens |
|---|---|
| see | camera reads the fault code and the model plate — nothing is typed |
| **learn** | if it has never met this machine, it reads that model's own service manual and builds the fault graph |
| hypothesise | the possible causes, with how likely each is and how much is still unknown, in bits |
| **ask** | it picks the single check that rules out the most for the least effort — and waits, because it has no hands |
| **narrow** | your answer eliminates causes in front of you; repeat until one survives |
| **verify** | the survivor must be upheld against service data, or it refuses |
| guide | spoken steps, paced to the work, one instruction on screen |
| buy | the exact part for the model, ordered in one word via Amazon Wallet |
| confirm | re-reads the panel afterwards to prove the fault actually cleared |
| remember | writes a repair receipt so the next conversation is short |

The three bold rows are the difference between this and a repair app. Everything else guesses once
from a photo; this runs a procedure and can stop halfway through to say it doesn't know.

<!-- MEDIA: docs/media/flow.gif — the whole loop end to end, under 12 seconds. -->

---

## See it run

`TODO` — numbered path for a reviewer, with the exact utterances to try.

![TODO run](docs/media/flow.gif)

---

## The trust gate

The difference between this and a photo-diagnosis app: **it will not guess with your money.**

`TODO` — write this section around the refusal, not the success. When three causes sit within a few
percent of each other and one involves mains voltage, the verifier refuses to uphold any of them and the
copilot books a technician instead of selling a part.

<!-- MEDIA: docs/media/refusal.png — the ABSTAIN card. This screenshot is not optional. -->
![TODO refusal](docs/media/refusal.png)

<!-- MEDIA: docs/media/proof.png — confirm_fix re-reading the panel with no fault code. -->
![TODO proof](docs/media/proof.png)

---

## Architecture

`TODO` — keep the ASCII in-README and export a matching `docs/media/architecture.png`.

```
 you ──► Alexa+ (device surface) ──► this MCP server ──► Bedrock vision
                                          │                AgentCore memory
                                          │                parts catalog
                                     TRUST GATE            Amazon Wallet
                                     upheld? ──no──► book a technician
                                          │yes
                                     guide ──► part ──► order ──► confirm ──► remember
```

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## MCP tool surface

`TODO` — this table is the most important thing in the repository for an automated reviewer. Every row
must name the file it lives in and be callable, not merely described.

Four of these are implemented and callable over JSON-RPC today; the rest are stubs waiting on AWS
credentials. The table says which, because a tool table that overstates itself is the fastest way to
lose a reviewer's trust.

| tool | input | returns | status |
|---|---|---|---|
| `hypotheses` | model, code | the space of possible causes + how uncertain it is, in bits | **live** |
| `next_test` | space, tests, performed | the one check worth asking for — most ruled out for least effort | **live** |
| `observe` | space, outcome | what survived, and what that answer eliminated | **live** |
| `diagnose` | model, code | ranked causes, cheapest first | **live** |
| `verify_diagnosis` | model, code, causeId, ruledOut | upheld / abstain, with a citation | **live** |
| `guide` | model, code, causeId | hands-free steps with pacing | **live** |
| `find_part` | model, causeId | exact part + what a service call costs | **live** |
| `see` | image | model number + fault code, or nulls | **live**, falls back to a *labelled* simulated read without credentials |
| `confirm_fix` | image, code | did the fault actually clear? | **live** — refuses to confirm a repair it could not see |
| `remember_repair` | model, code, cause, outcome | the repair receipt | **live**, file-backed until AgentCore |
| `repair_history` | model | everything this machine has been through | **live** |
| `whats_due` | — | consumables past their window | **live** |
| `order_part` | part | Wallet checkout | stub — needs Wallet sandbox |

Each lives in its own file under `mcp/tools/`, registered in `mcp/server.js`.

Transport: Streamable HTTP, MCP spec `2025-11-25`. Server entry point: `mcp/server.js`.

### Being taught a machine it has never seen

`TODO` — the section that matters most. The copilot is not programmed for one dishwasher. Hand it the
service manual for an appliance nothing in this repository has heard of and it reads the fault table
out of it, builds the hypothesis space, and runs the same loop — with every cause citing the line of
the manual it came from.

```bash
curl -s -X POST localhost:8792/api/learn -H 'content-type: application/json' \
  -d '{"model":"LG-WM3900","brand":"LG","source":"LG service manual",
       "text":"Fault codes\nOE   The machine cannot drain\n     Check the drain filter for debris\n     Replace the drain pump if it does not turn\n"}'
```

Fault codes are not one shape — Bosch writes `E24`, Samsung writes `4C`, and LG's entire scheme is
letter pairs with no digits at all. The parser handles all three, and reports honestly how much of a
manual it actually recovered rather than implying it read the whole thing.

---

## Built with

`TODO` — name the exact services and what each is for.

| piece | what it does here |
|---|---|
| MCP (Streamable HTTP, 2025-11-25) | the add-on surface Alexa+ calls |
| MCP Apps | the step cards rendered on the device |
| Amazon Bedrock vision | reads fault codes and model plates |
| Bedrock AgentCore Memory | the household appliance record |
| Amazon Wallet checkout | ordering the part in-conversation |

---

## Run it yourself

`TODO` — four commands maximum.

No dependencies, no build step, no credentials needed to see it work.

```bash
git clone <repo>
cd second-set-of-hands

npm run demo            # ← start here: the whole loop in a terminal, 20 seconds
npm test                # every suite, reported together
npm start               # http://localhost:8792 — the device experience
npm run mcp             # http://localhost:8793/mcp — the server Alexa+ calls
npm run eval            # the vision evaluation (needs photographs)
```

`npm run demo` runs the complete procedure against an LG washing machine that nothing in this
repository has ever heard of: it reads the manual, builds the hypothesis space, picks each check by
what it rules out per unit of effort, narrows to one cause, cites the line of the manual it came
from, and refuses to sell a part it hasn't earned the right to sell.

Call the gate directly, without the device:

```bash
curl -s -X POST http://localhost:8793/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify_diagnosis",
       "arguments":{"model":"SHE3AR75UC","code":"E24","causeId":"pump"}}}'
```

It refuses, because the free check has not been ruled out yet. Add `"ruledOut":["filter","hose"]` and
it upholds the part.

---

## What is real and what is simulated

`TODO` — say it plainly:

- **Real:** the MCP server and every tool above, the trust gate, the step pacing, the memory model.
- **Simulated:** the Alexa+ device surface — the web experience the hackathon rules explicitly permit,
  because no entrant can call Alexa+ directly.
- Fault codes used in the demo are genuine Bosch/Whirlpool/LG/Samsung codes.

---

## For reviewers

[`docs/JUDGING.md`](docs/JUDGING.md) maps each criterion — tech implementation, design, potential
impact, quality of the idea — to the file or screen that answers it, covers the mini challenge, and
marks what is still stubbed.

The short version, if you have two minutes: `npm start`, open localhost:8792, press **Start the
repair** and walk it through. Then press **Show it refuse a job** — that screen is the product.

- Friction log: [`docs/FRICTION-LOG.md`](docs/FRICTION-LOG.md)
- Product feedback: [`docs/PRODUCT-FEEDBACK.md`](docs/PRODUCT-FEEDBACK.md)

---

## Repository map

```
second-set-of-hands/
├── mcp/
│   ├── server.js        Streamable HTTP MCP server
│   └── tools/           one file per tool, each independently testable
├── data/                service data: fault codes, causes, parts by model
├── server.js            dev server for the device experience
├── engine.js            session state the device renders
├── public/              the Echo Show experience
└── docs/
    ├── ARCHITECTURE.md
    ├── DEMO-SCRIPT.md   the 3-minute video, shot by shot
    ├── FRICTION-LOG.md  every rough edge hit, as we hit it
    ├── PRODUCT-FEEDBACK.md
    ├── decisions/
    └── media/
```

---

## License

MIT — see [LICENSE](LICENSE).
