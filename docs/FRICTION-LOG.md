# Friction log

Part of the submission. Written as things happen, not reconstructed at the end — the detail that makes
a log useful is gone within a day.

Only entries from work actually done are recorded here. Bedrock, Wallet and AgentCore entries will
appear when those are wired; there is nothing to say about them yet.

---

### 2026-09-15 · Alexa+ add-ons cannot be tested against Alexa+

**Task:** work out how to demo an add-on end to end.
**Expected:** a sandbox or simulator that runs an MCP add-on against Alexa+ itself.
**Actual:** Alexa+ for Builders is limited to selected partners, and hackathon entrants cannot call
Alexa+ at all. The rules permit a simulated experience instead, and an organiser confirmed on the
forum that judges have no way to distinguish a real add-on from a convincing simulation in a video.
**Severity:** medium — it does not block the build, but it decides the architecture on day one.
**Workaround:** build a real MCP server and drive it from a simulated device surface, so the tools are
genuinely invoked even though the assistant is not.
**Suggestion:** a read-only Alexa+ sandbox — even one device, even rate-limited — would let an add-on
be validated against the real orchestrator before certification. Without it, the first time an add-on
meets Alexa+ is after submission.

---

### 2026-09-15 · Docs describe MCP Apps for output, but not image input

**Task:** establish whether a tool can receive a photo from the Echo Show camera as an argument.
**Expected:** a clear statement either way in the MCP toolkit docs.
**Actual:** the docs cover rendering UI *to* the device thoroughly via MCP Apps, and Alexa+ visual
recognition ships on Echo Show, but whether an add-on tool can take an image argument is not stated.
**Severity:** medium — it is the difference between "point the camera at the panel" being a real
capability or a simulated one.
**Workaround:** the vision step runs server-side in our own surface.
**Suggestion:** one line in the MCP toolkit overview saying whether tool inputs can carry an image,
and if so in what encoding.

---

### 2026-09-15 · A confidence ranking is not a safety rule (our own bug)

**Task:** ask the trust gate whether the $38 drain pump could be authorised.
**Expected:** a refusal, because the free filter check had not been tried yet.
**Actual:** a refusal — but for a nonsense reason: *"Failed drain pump and Failed drain pump are within
0% of each other."* The gate compared the requested cause against the highest-ranked cause, which was
the same row when the caller named a specific cause.
**Severity:** high. The refusal was right by accident, and the reason shown to a user was incoherent.
**Fix:** compare against the best *remaining* cause, and add `ruledOut` so clearing the free check is
what earns the paid part its verdict. Tests now cover both directions and assert the gate never
compares a cause to itself.
**Lesson worth keeping:** we found this by running the tool and reading the sentence it produced, not
from a test. Bugs in refusal paths hide well, because a refusal looks like success.

---

### 2026-09-16 · Reaching Bedrock without adding a dependency

**Task:** call a vision model from a project that deliberately has no npm dependencies.
**Expected:** either an SDK or a documented plain-HTTPS path.
**Actual:** the SDK is the documented route; signing requests by hand is SigV4, which is a lot of
code to own. Shelling out to the AWS CLI works and inherits whatever profile the operator has
configured, which turned out to be the better answer anyway for a hackathon judge running this
locally.
**Severity:** low, once you land on it.
**Workaround:** `aws bedrock-runtime invoke-model` with `--cli-binary-format raw-in-base64-out`.
**Suggestion:** that flag is the hour-costing detail. A copy-pasteable CLI example for image input
in the Bedrock vision docs — not just SDK snippets — would save it. Judges and hackathon entrants
reach for curl and the CLI first.

---

### 2026-09-16 · The latency requirement cannot be measured

**Task:** check our add-on against the sub-500ms round trip the functional requirements ask for.
**Expected:** some way to measure against the real orchestrator.
**Actual:** entrants cannot call Alexa+, so the number can only be honoured by guesswork. We can
measure our own server, which is not the thing being specified.
**Severity:** medium — it is a stated requirement with no way to verify compliance.
**Suggestion:** publish the measurement point, or provide an echo endpoint that reports the
round-trip as the orchestrator sees it.

---

### 2026-09-15 · A test that encoded the wrong precedence

**Task:** assert the gate refuses when causes are too close to separate.
**Expected:** the E09 case to fail on the separation rule.
**Actual:** it refused on the mains-voltage rule instead, and the test failed.
**Severity:** low, but instructive — the test was wrong, not the code. Mains voltage *should* outrank
a confidence comparison.
**Fix:** test separation on a case with no mains in it, and add a test asserting mains takes
precedence.

---

### 2026-09-16 · An unknown cost, reported as a free repair

**Task:** read the `npm run demo` output end to end, looking for anything that overstates itself.
**Expected:** the LG run to end by naming a part, or by saying it had no parts data for that machine.
**Actual:** it concluded the drain pump had failed and then said *"That cause costs nothing to fix.
There is no part to buy."*
**Severity:** high. It is in the only file that can take money from someone, and it is a confident
wrong answer of exactly the kind the gate exists to prevent.
**Cause:** two bugs stacked. `manual/faultgraph.js` wrote `cost: 0` on every cause learned from a
manual — but a service manual lists remedies and never prices, so the cost was *unknown* and zero
means *free*. Then `order_part` saw `maySpend: false` and asserted one specific reason for it
without checking which of several applied.
**Fix:** learned causes carry `cost: null`; the verdict carries `costKnown`; the refusal says the
true thing. Regression test in `mcp/tools/checkout.test.js`.
**Worth saying:** this is the same shape as reporting an unobserved run as a quiet one. Whenever a
field can mean *zero* or *we do not know*, those are opposite facts and one of them will eventually
be spoken aloud to a person.

---

### 2026-09-16 · Two screenshots of the same moment

**Task:** generate the README's images from real runs rather than posing them.
**Expected:** seven distinct frames.
**Actual:** `teach.png` and `learned.png` came out byte-identical. The manual-ingest state lasts
under a second, and headless capture runs on virtual time, which skips straight past it.
**Severity:** medium. Nothing was broken; the README would simply have carried two captions
describing one image, which is the quiet kind of dishonesty this project argues against.
**Fix:** dropped the frame rather than contorting the product to be photographable, and `npm run
capture` now hashes every frame and exits non-zero if any two match.

---

### 2026-09-16 · Documents that understated the project

**Task:** check the docs a reviewer actually opens.
**Actual:** `AGENTS.md` claimed 20 checks and `docs/JUDGING.md` claimed 50 (there are 112).
`JUDGING.md` also said seven tools (fourteen) and called checkout and memory "stubs waiting on AWS
credentials" — both are live and tested; only Wallet and AgentCore behind them are not.
**Severity:** medium, and the kind that is easy to dismiss. A judging document that undersells is as
much a defect as one that oversells, and it fails in front of precisely the reader it was written
for.
**Fix:** corrected, and added a rule to `AGENTS.md`: never cite a check count in prose. Say "every
suite" and let `npm test` print the number.
