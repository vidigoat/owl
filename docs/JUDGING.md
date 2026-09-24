# For reviewers

Four criteria, equally weighted, plus the mini challenge and the friction-log bonus. Every row points
at something runnable — no claim here needs to be taken on trust.

## Start here

Two screens. The device at `/` is the thing an owner talks to; **the bench at `/review.html` is the
thing that makes the device trustworthy** — a rendered manual page on the left, what was parsed out
of it on the right, and nothing reaching the library until somebody ticks a row.

**Take it a manual of your own.** The bench has a drop target: give it any manufacturer's PDF — any
brand, nothing here is coded for yours — and the fault table comes back in under a second with the
page each cause is printed on. Nothing is uploaded anywhere, and **nothing is admitted**: a
machine-read table is a candidate, which is the whole reason the bench exists.

That works on the hosted URL because reading a PDF here needs nothing installed. It used to shell
out to `pdftotext` — poppler, a binary the host does not have — so until this week the live bench
was permanently empty and the one capability this project is for was the one thing a visitor could
not see. `manual/pdf-read.js` reads the format itself: cross-references, object streams, fonts and
their `ToUnicode` maps, the content stream, and the glyph positions that put a three-column table
back into three columns.

`npm run pdf:compare` is the measurement, not the claim — the built-in reader against poppler over
every manual on the machine, scored on whether `readSymptoms` recovers the same rows: **1,881 pages,
identical page counts, 98.4–100% of poppler's words, 87.5% of its parsed rows word for word**, plus
287 rows poppler did not produce. Which reader answered travels with every result, and
`server.test.js` runs the read twice — once as this machine, once with poppler switched off —
because proving the hosted path on a laptop that has poppler proves the wrong thing.

It caught a real error the first time it was used, on the first machine: the manual prints **E:16**
and the model read **E18**. The output was well formed and confidently wrong, and nothing
downstream could have caught it.

The larger finding is on that screen too. Ten current Bosch US dishwasher manuals, fetched from
Bosch's own site by `scripts/source-manuals.js`, contain **zero fault codes between them** — the
troubleshooting tables are keyed on described symptoms now. The entry point this product was built
on matches what Bosch published in 2019 and not what it publishes today, which is written up
honestly in `PLAN.md` rather than papered over.

## Tech implementation
*How effectively does it use the required technology for the Alexa+ track?*

| what to look at | where |
|---|---|
| The MCP server — JSON-RPC over Streamable HTTP, spec 2025-11-25 | `mcp/server.js` |
| **See it work in one command** | `npm run mcp:session` — starts the server, speaks the protocol properly (initialize, initialized, tools/list, resources/list) and walks a real repair through it: a sentence, a citation, a refusal, a fault code narrowed, and a cart the gate refuses to open. Nothing mocked. |
| **Any MCP client can use it — checked with the official SDK** | the reference client, `@modelcontextprotocol/sdk` 1.30.0 `StreamableHTTPClientTransport`, against the live URL: handshake at 2025-11-25, 19 tools, real `hypotheses` / `next_test` answers, the `ui://` card read as `text/html;profile=mcp-app`, and a checkout refused because a cheaper cause was not ruled out — in about three seconds. `/connect.html` is how to add it to Claude |
| **An agent drives it, not a script** — Amazon Nova 2 Lite on Bedrock choosing every tool, over MCP | `npm run alexa -- --demo` — a whole repair with only the person's lines scripted, every tool call printed, about two cents. `agent/alexa.js`; SigV4 with no SDK in `agent/sigv4.js`, checked against AWS's vectors |
| **Latency — the sub-500 ms requirement, the part we own** | `npm run latency -- --url https://second-set-of-hands.vercel.app/mcp` — every tool the agent uses, twenty calls each, split into the server's own time (`Server-Timing` on every answer: slowest p95 **1.8 ms** on the server) and the round trip from wherever it is run; `docs/latency.json` |
| **Ready to onboard to Alexa+** — the add-on package `alexa-ai deploy` uploads | `addon.json`: the deployed `/mcp` endpoint, store listing, the six icon sizes and 600×900 carousel images (the real card, rendered — `scripts/addon-assets.js`), privacy and terms pages. `addon.test.js` holds it to every limit the MCP toolkit quickstart publishes, reads each PNG's real size, and checks the privacy page against the code |
| **Talk to the agent, with the screen it would draw** | `/talk.html` under `npm start` with AWS credentials — the live agent via `POST /api/alexa` (`agent/live.js`, the MCP server reached in-process), and the real MCP App card for the last tool it called. It takes turns only from this site's pages, meters every call against the budget ceiling, caps turns; on a host with no credentials it says so. `agent/live.test.js` |
| **One spend ceiling for every instance of the hosted agent** | `node mcp/shared-budget.test.js` — on a serverless host each instance has its own disk, so a file ledger is a ceiling that multiplies with traffic. The hosted ledger is one DynamoDB item that a turn reserves its worst case against in a single conditional write: two instances racing for the last cent, exactly one gets it; an unreachable ledger stops the call; what AWS says about the ledger (which names the account) never reaches the page; a deployment with keys and no ledger refuses to talk. Signed by the project's own SigV4, checked against the real endpoint. `scripts/hosted-setup.sh` turns it on in one confirmed step |
| **The agent is held to its rules by measurement** | `npm run agent:eval` — nine live conversations, ten rules on every turn (one question, grounded numbers, consent, the gate, honest memory, mains, length, always answers, the part asked about before it is fitted, the question next_test chose); recorded in `docs/agent-eval.json`. Each rule it broke on a live run is now a structure in the client, and `agent/alexa.test.js` proves each one without spending anything |
| Nineteen tools genuinely registered and invoked, not described | `mcp/tools/` — answer `tools/list` over Streamable HTTP; the README table names the file each lives in |
| **Vision that actually runs** — real Bedrock Nova Lite, scored against deliberately hard panels | `npm run eval` → 7/9 codes, 1/1 model, **0 invented**; the two misses return null rather than guess. `mcp/tools/see.js` |
| **A camera, and a voice** — point it at a rating plate, hear the step out loud | `web/src/sections/Plate.jsx` (`getUserMedia` → `POST /api/see`), `web/src/sections/Device.jsx` (`speechSynthesis`); neither starts on its own |
| **Learns a machine from a photograph of its manual** | `mcp/tools/read_manual.js` — verified on a Hotpoint FDW60 whose codes appear nowhere in this repo |
| **An MCP App for the screen** — the Alexa+ way to draw a tool's UI | `mcp/apps/card.html`, served as `ui://second-set-of-hands/card` (`text/html;profile=mcp-app`) and named by eight tools in `_meta.ui.resourceUri`. See it at **`/app-host.html`** — a reference host we wrote, driving real tool calls. `mcp/apps/card.test.js` runs the card's own script as a host would: handshake order, real results drawn, markup escaped, foreign senders ignored, nothing fetched. Nothing appears only on the card |
| **Survives a hostile manual** | `manual/adversarial.test.js` — a page trying to sell a £340 board cannot open a cart |
| **Thirty-two attempts to make it spend money, zero carts** | `mcp/tools/gate-adversarial.test.js` — claiming the verdict in the arguments (`upheld`, `maySpend`, `force`, `skipVerification`, a `__proto__` payload), confusing the types it keys on, confirming an order for a cart that was never opened. The gate holds, and none of it throws — a tool that crashes hands its caller a crash to interpret |
| **A path from a caller is not a path a tool may read** | `mcp/tools/local-file.test.js` — `{"imagePath":"/etc/passwd"}` used to be read off the disk and would have gone to Bedrock; images now come from this project or the renderer's scratch directory, symlinks resolved first |
| **Measured, not asserted** | `npm run questions` (every answer path) · `npm run eval` (real Bedrock) |
| **The diagnosis engine** — entropy over a hypothesis space, cost-weighted information gain | `mcp/tools/next_test.js` |
| **Learning a machine at runtime** from its own service manual | `manual/faultgraph.js`, `POST /api/learn` |
| The device calls those same modules; the front-end knows nothing | `server.js` → `/api/diagnosis/*`, `/api/learn`, `/api/verify`, `/api/guide`, `/api/part` |
| **Where the manuals come from** — sitemap → product page → typed document list, robots-respecting, capped | `scripts/source-manuals.js` — run it and watch it fetch |
| **Reading the table manufacturers print now**, keyed on a described symptom rather than a code | `manual/symptoms.js` — the column boundary from the page's own header, indent as the grammar |
| **Answering in words**, returning every candidate rather than picking one | `describe_problem` → `data/service-data.js` `lookupSymptom` |
| **Nothing enters the library without a person** — evidence and parse side by side, admission per row | `manual/review.js`, `public/review.html` at `/review.html` |
| **The site asks the manual live** — type what the machine is doing, get the manufacturer's sentence and the page | `web/src/sections/Ask.jsx` → `/api/describe`; a quotation without a citation fails `ui.test.js` |
| **The device decides nothing** — no probability, severity or eligibility is computed in the interface | `mcp/architecture.test.js` "the device decides nothing", now scanning every file in `web/src/` |
| **Is it worth fixing** — refuses, and names the figure it cannot have | `mcp/tools/replace_or_repair.js`; it never returns a verdict and a test says so |
| Every suite reported together, weighted towards the things that can cost someone money | `npm test` |

The one worth running yourself:

```bash
npm start
curl -s -X POST localhost:8792/api/diagnosis/start -H 'content-type: application/json' \
  -d '{"model":"SHE3AR75UC","code":"E24"}'
```

Three causes come back with priors and the uncertainty in bits. Feed that to `/api/diagnosis/next`
and it will pick the *free* listening check over the one that needs the machine pulled out — even
though the filter is the more likely cause. That trade-off is the product.

Call the gate yourself without the device:

```bash
npm run mcp
curl -s -X POST http://localhost:8793/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify_diagnosis",
       "arguments":{"model":"SHE3AR75UC","code":"E24","causeId":"pump"}}}'
```

It refuses — the free check has not been ruled out. Add `"ruledOut":["filter","hose"]` and it upholds.

**The vision path is live.** `see`, `read_error`, `identify_appliance` and `confirm_fix` reach
Bedrock Nova Lite. `npm run demo` opens on a real read; `npm run eval` scores it. Without
credentials every read is still labelled `SIMULATED — no credentials` on screen and in the trace,
and it is that label, not a silent fallback, that makes the demo honest.

**Not there yet, precisely.** `eval/photos/` is empty, so the reader is measured against six drawn
panels and *not* against a real kitchen — the README reports those as two separate numbers under a
heading saying which is which. AgentCore memory is refused by this identity
(`AmazonBedrockFullAccess` does not cover `bedrock-agentcore:*`), so household memory is file-backed
behind the same interface and the UI says "local". `npm run preflight` reports both in one line each.

Checkout itself is live and tested (`begin_checkout` refuses outright on a diagnosis that was not
upheld, `confirm_checkout` completes exactly once); Amazon Wallet behind it is the sandbox stub.
Household memory is live: a file on a laptop; on a deployment, a second item in the spend
ledger's DynamoDB table (`mcp/household-store.js`), loaded before `remember_repair` /
`repair_history` / `whats_due` and saved after with a version check, so two instances saving at
once are merged, not overwritten (`mcp/household-store.test.js`). Where neither is available — the
hosted demo today — every answer says the repair is kept for this conversation only, rather than
claiming a save it did not make (`mcp/tools/home-durability.test.js`).

### The two runs worth doing yourself

```bash
npm run demo      # the whole loop on a machine nobody coded for, in a terminal
npm test          # every suite, reported together
npm run eval      # the vision evaluation — honest about having no photographs yet
```

That last one is the claim that matters: four manufacturers' manuals — Bosch, LG, Samsung, Whirlpool,
each writing fault codes differently — parsed from scratch, narrowed to a single cause, and talked
through with a procedure citing the manual it came from. None of them are coded for.

## Design
*Is the interaction model well considered for the device?*

| what to look at | where |
|---|---|
| One instruction at a time, legible from across a kitchen | `/` on localhost:8792 |
| Hands-free: steps advance on the pace the tool returns, not a fixed timer | the "Hands-free" button |
| The refusal path | the "Show it refuse a job" button |
| Why pacing lives in the tool | `docs/decisions/002` |

## Potential impact
*Does it solve a real customer need?*

A repair call averages $179 before parts, $60–100 of that just to arrive, with a 7+ day wait. 39% of
Americans have thrown out a large appliance they could not get fixed, and roughly one service call in
three is something the owner could have done. The demo turns one of those into ten minutes and a
$38.42 part, and the tool reports the $140.58 difference rather than hiding it.

## Quality of the idea
*Creative use of the tools, and understanding of the user?*

Photo-diagnosis apps exist and they guess. The idea here is the refusal: `verify_diagnosis` is the only
function allowed to authorise spending, it will not name a cause behind mains voltage however
confident the ranking, and it will not sell a part while a free check is still standing. That gate is
the product, and it is the thing under test.

## Mini challenge and bonus

- **AWS Builder:** Bedrock vision for the fault code and model plate, AgentCore Memory for the
  household record. Both written behind their real interfaces and neither has reached AWS yet;
  `npm run preflight` says why, and every simulated read says so where it appears.
- **Friction log:** `docs/FRICTION-LOG.md`, written while building rather than at the end.
- **Product feedback:** `docs/PRODUCT-FEEDBACK.md`.
