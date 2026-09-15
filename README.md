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
| diagnose | ranked causes for *that* model, cheapest first |
| **verify** | the diagnosis must be upheld against service data, or it refuses |
| guide | spoken steps, paced to the work, one instruction on screen |
| buy | the exact part for the model, ordered in one word via Amazon Wallet |
| confirm | re-reads the panel afterwards to prove the fault actually cleared |
| remember | writes a repair receipt so the next conversation is short |

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

| tool | input | returns | file |
|---|---|---|---|
| `identify_appliance` | image | brand, model, confidence | `mcp/tools/identify_appliance.js` |
| `read_error` | image | fault code, confidence | `mcp/tools/read_error.js` |
| `diagnose` | model, code | ranked causes | `mcp/tools/diagnose.js` |
| `verify_diagnosis` | model, cause | upheld / abstain | `mcp/tools/verify_diagnosis.js` |
| `guide` | model, cause | hands-free steps | `mcp/tools/guide.js` |
| `find_part` | model, cause | exact part, fit confidence | `mcp/tools/find_part.js` |
| `order_part` | part | Wallet checkout | `mcp/tools/order_part.js` |
| `confirm_fix` | image | fault cleared? | `mcp/tools/confirm_fix.js` |
| `home.remember` / `home.due` | record | household memory | `mcp/tools/home.js` |

Transport: Streamable HTTP, MCP spec `2025-11-25`. Server entry point: `mcp/server.js`.

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

```bash
git clone <repo>
cd second-set-of-hands
cp .env.example .env    # AWS profile + Bedrock model
node server.js          # http://localhost:8792 — the device experience
node mcp/server.js      # the MCP server Alexa+ would call
```

---

## What is real and what is simulated

`TODO` — say it plainly:

- **Real:** the MCP server and every tool above, the trust gate, the step pacing, the memory model.
- **Simulated:** the Alexa+ device surface — the web experience the hackathon rules explicitly permit,
  because no entrant can call Alexa+ directly.
- Fault codes used in the demo are genuine Bosch/Whirlpool/LG/Samsung codes.

---

## For reviewers

`TODO` — a table mapping each judging criterion to the file or screen that answers it: technological
implementation, design, potential impact, quality of the idea. Add a line pointing to the product
feedback and friction log, which are part of the submission.

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
