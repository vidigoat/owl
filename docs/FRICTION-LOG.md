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
