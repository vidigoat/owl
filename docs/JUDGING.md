# For reviewers

Four criteria, equally weighted, plus the mini challenge and the friction-log bonus. Every row points
at something runnable — no claim here needs to be taken on trust.

## Tech implementation
*How effectively does it use the required technology for the Alexa+ track?*

| what to look at | where |
|---|---|
| The MCP server — JSON-RPC over Streamable HTTP, spec 2025-11-25 | `mcp/server.js` |
| Four tools genuinely registered and invoked, not described | `mcp/tools/` — `diagnose`, `verify_diagnosis`, `guide`, `find_part` |
| The device calls those same modules; the front-end knows nothing | `server.js` → `/api/verify`, `/api/guide`, `/api/part` |
| 20 checks over the tools that can cost someone money | `npm test` |

Call the gate yourself without the device:

```bash
npm run mcp
curl -s -X POST http://localhost:8793/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify_diagnosis",
       "arguments":{"model":"SHE3AR75UC","code":"E24","causeId":"pump"}}}'
```

It refuses — the free check has not been ruled out. Add `"ruledOut":["filter","hose"]` and it upholds.

**Not there yet:** the three vision tools, Wallet checkout, and AgentCore memory are stubs waiting on
AWS credentials. The README table marks which is which.

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
  household record. Both stubbed today — see the README table.
- **Friction log:** `docs/FRICTION-LOG.md`, written while building rather than at the end.
- **Product feedback:** `docs/PRODUCT-FEEDBACK.md`.
