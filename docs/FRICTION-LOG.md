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

---

### 2026-09-16 · Pointing it at real AWS for the first time

**Task:** get the vision path working, after a Bedrock-only IAM user made it possible at all.
**Severity:** the whole feature. Five defects in about twenty minutes, and *not one of them was
findable offline* — every unit test had been passing against a path that had never once succeeded.

**1. The call had never worked.** `bedrock-runtime invoke-model` was writing the model's response
body to `/dev/stdout` while the CLI wrote its own metadata there too, so stdout held two JSON
documents concatenated and every read died on `JSON.parse`. Every image came back labelled
SIMULATED — the system being honest about a path that was simply broken. *Fix:* request and
response through temp files. A file has exactly one writer.

**2. The prompt confused its own two fields.** It read `F21` off a washer display perfectly and
returned it as the model number. Expensive in both directions: a model number in the code field
walks a fault tree that does not exist, a fault code in the model field silently looks up the wrong
machine. *Fix:* the prompt says where each field physically lives — lit display versus printed
rating plate, 2–4 characters versus 8–14 — rather than only what each one is.

**3. The string "null" became a fault code.** Asked about a healthy machine the model sometimes
writes `"null"` rather than JSON null; uppercasing produced `code: "NULL"`, which then failed lookup
and was reported as a *misread display*. An absence has to survive as an absence.

**4. A rating plate returned its FD number as a fault.** On a photograph with no display in it at
all, `9902` came back as a fault code. Label text is not a fault, however short it looks.

**5. A repair was confirmed on a read at 0.1 confidence.** The worst of the five, because it is the
one claim that stops a person looking further. A blank display read that badly is evidence we could
not see, not evidence a fault cleared. *Fix:* a floor under confirmation only — a poor read still
showing the original code is perfectly good evidence the repair failed.

**The general lesson.** Four of these five are the same mistake wearing different clothes: treating
"I could not establish X" as "X is absent". The project already had a rule about that and still
shipped it four more times, which suggests a rule is not enough and the shape needs to be a test.

**Suggestion for AWS:** `invoke-model` taking an output path *and* printing metadata to stdout is a
trap that costs everyone the same hour. Either write metadata to stderr, or refuse `/dev/stdout` as
an output path with a message saying why.

### 2026-09-20 · Bedrock has no spend ceiling you can set

**What happened.** This project makes a Bedrock call every time it looks at anything: a control
panel, a rating plate, a manual page, a repair being confirmed. For most of its life nothing
bounded that. A loop in a demo, a stuck retry, or a browser tab left refreshing would have billed
until somebody noticed on a statement.

We looked for a ceiling to set and there isn't one. Budgets in Cost Explorer **alert**; they do not
**stop**. The closest mechanism is an SCP or an IAM deny that somebody has to write, test, and
remember to remove — which is a lot of ceremony for "do not let this exceed a dollar".

**Why it matters more than usual here.** A separate IAM user isolates *permissions*, not *billing*,
so a hackathon project created carefully under its own user still spends the owner's production
account. We found this while checking whether the project was safe to leave running — it was not.

**What we did instead.** Wrote one: `mcp/budget.js`, an on-disk ledger with a pre-flight check that
refuses a call which *could* exceed the ceiling, and which fails closed when it cannot read its own
ledger. Sixty lines. Every project doing vision at any volume is going to write this same file.

**Suggestion:** a per-IAM-principal or per-inference-profile monthly cap in the Bedrock console that
returns a distinct throttling error when reached. Alerting after the money is gone is the wrong end
of the problem, and for anyone trying something new on a personal card it is the difference between
experimenting and not.

---

### 2026-09-20 · `invoke-model` reports usage, and that is genuinely good

Worth recording alongside the complaints, because it is the thing that made the ceiling above
possible to build honestly.

The response body carries `usage.inputTokens` and `usage.outputTokens`, so a caller can record what
a call **actually** cost rather than what it estimated. Our ledger keeps the real figure and uses the
estimate only for the pre-flight check — which means the ceiling errs toward refusing while the
recorded total stays true to the bill.

Several providers make you infer this. Not having to is the reason the number this project prints
is a measurement rather than a guess, and that distinction is load-bearing for a product whose whole
argument is about not guessing.

**One small thing:** images are charged as tokens and the response does not break out how many were
image tokens versus text. We over-count images at a flat 3,000 in the pre-flight estimate because we
cannot see the real split, which makes the ceiling blunter than it needs to be.
