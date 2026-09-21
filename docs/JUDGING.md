# For reviewers

Four criteria, equally weighted, plus the mini challenge and the friction-log bonus. Every row points
at something runnable — no claim here needs to be taken on trust.

## Start here

Two screens. The device at `/` is the thing an owner talks to; **the bench at `/review.html` is the
thing that makes the device trustworthy** — a rendered manual page on the left, what was parsed out
of it on the right, and nothing reaching the library until somebody ticks a row.

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
| Nineteen tools genuinely registered and invoked, not described | `mcp/tools/` — answer `tools/list` over Streamable HTTP; the README table names the file each lives in |
| **Vision that actually runs** — real Bedrock Nova Lite, scored against deliberately hard panels | `npm run eval` → 7/9 codes, 1/1 model, **0 invented**; the two misses return null rather than guess. `mcp/tools/see.js` |
| **A camera, and a voice** — point it at a machine, answer out loud | `public/app.js` — `getUserMedia`, `speechSynthesis`, `SpeechRecognition` |
| **Learns a machine from a photograph of its manual** | `mcp/tools/read_manual.js` — verified on a Hotpoint FDW60 whose codes appear nowhere in this repo |
| **Rich cards as MCP resources** | `mcp/cards.js` — `resources/list` and `resources/read`; nothing appears only on a card |
| **Survives a hostile manual** | `manual/adversarial.test.js` — a page trying to sell a £340 board cannot open a cart |
| **Measured, not asserted** | `npm run questions` (every answer path) · `npm run eval` (real Bedrock) |
| **The diagnosis engine** — entropy over a hypothesis space, cost-weighted information gain | `mcp/tools/next_test.js` |
| **Learning a machine at runtime** from its own service manual | `manual/faultgraph.js`, `POST /api/learn` |
| The device calls those same modules; the front-end knows nothing | `server.js` → `/api/diagnosis/*`, `/api/learn`, `/api/verify`, `/api/guide`, `/api/part` |
| **Where the manuals come from** — sitemap → product page → typed document list, robots-respecting, capped | `scripts/source-manuals.js` — run it and watch it fetch |
| **Reading the table manufacturers print now**, keyed on a described symptom rather than a code | `manual/symptoms.js` — the column boundary from the page's own header, indent as the grammar |
| **Answering in words**, returning every candidate rather than picking one | `describe_problem` → `data/service-data.js` `lookupSymptom` |
| **Nothing enters the library without a person** — evidence and parse side by side, admission per row | `manual/review.js`, `public/review.html` at `/review.html` |
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
Household memory is live and file-backed behind the same interface AgentCore will sit behind.

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
