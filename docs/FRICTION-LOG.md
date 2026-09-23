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

---

### 2026-09-22 · The vision model reads a table off a page that has none

Not a complaint about Bedrock so much as a finding about how to use it, and the most useful thing
we learned this week.

`B18IF905SP` is a Bosch refrigerator. Our page scorer picked its **Home Connect** pages — prose
about joining an appliance to a Wi-Fi network, no fault table anywhere on them — and we asked Nova
Lite to read the fault-code table on that page. It produced one: seven codes, every single one with
the identical meaning *"REASON: The water inlet valve is stuck open"* and the identical cause. Four
of the seven are not Bosch conventions at all — `OE` and `4C`/`5E` are LG and Samsung, `H20` is
Whirlpool.

It was admitted, and it sat in our library looking like seven facts.

**It is reproducible.** Running that manual through the pipeline today does it again. On the facing
page the model refuses correctly — *"There is no fault code table on that page"* — so the behaviour
is not that it always invents; it is that a page with plausible structure and no table is enough.

**What we did about it**, and it is not a prompt change. A reviewer reads one row at a time and
every row is plausible; the tell exists only *across* rows. So the guard is arithmetic, in code:
distinct codes mean distinct things — that is what a code is for — and a reading where they all say
the same sentence is one answer copied down a page. `manual/faultgraph.js` refuses such a reading
outright rather than trimming it, because there is no way to tell which of the seven, if any, came
off the page.

**What would have helped:** nothing in the response distinguishes "I read this" from "I produced
something of the right shape". A per-field confidence, or even a flag for "the requested structure
was not present", would have let us refuse it at the seam rather than three layers downstream. We
would take that over a better model.

---

### 2026-09-22 · `pdftotext -layout` is the whole product, and it is not in npm

Poppler does something no npm package does as well: it preserves horizontal position as runs of
spaces, which is the only reason a two-column troubleshooting table can be read at all. Indent is
the grammar; a de-layouted extraction destroys exactly the thing that carries the meaning.

The friction is that it is a binary. We shell out to it and report `available()` rather than
crashing, and every caller degrades to something honest — but a self-hosted MCP server that needs
poppler on the host is a real install cost, and it is the one dependency we could not design away.

**One thing that cost an afternoon:** `pdftotext` separates pages with a form feed, and our page
splitter consumed it. Joining pages back together with a newline lost the boundary, so every row in
a multi-page table was cited to the page the run *started* on. A table running pages 37 to 48 cited
two hundred causes to page 37. An owner following one of them opens the manual to the wrong page
and finds nothing — and a citation that does not survive being checked is worse than no citation,
because it was believed. The fix is to keep the form feed at the seam and count them.

---

### 2026-09-23 · The one dependency we could not design away, designed away

**Task:** make the hosted review bench able to read a manual.
**Expected:** it already could — reading a PDF is the thing this project does.
**Actual:** it never could. `pdftotext` is poppler, poppler is a binary, and a serverless host does
not have one. The live bench had said "Nothing is waiting" since the day it was deployed, and the
single capability the whole repository is built around was the one thing a visitor could not see.
The entry above this one ends *"the one dependency we could not design away"*. That turned out to be
false, and the cost of believing it was months of a demo URL that could not demo the product.
**Severity:** high — not a bug in anything, which is why nothing caught it. Every test passed on a
machine that had poppler installed.
**Workaround:** none needed in the end. Node ships `zlib`, and `FlateDecode` is the only genuinely
hard part of the PDF format; the rest is parsing. `manual/pdf-read.js` reads the cross-reference,
object streams, fonts and their `ToUnicode` maps, the content stream, and the glyph positions that
put a three-column fault table back into three columns.
**Suggestion, to ourselves:** "we depend on a binary" is a design decision that should have been
written down as one and revisited, rather than becoming a fact about the world. It sat in this log
as a closed question for a week.

**What made it safe to ship:** poppler is on the laptop, so it is ground truth. `npm run pdf:compare`
runs both readers over every manual on the machine and scores the thing that decides anything —
whether `readSymptoms` recovers the same rows. 1,881 pages, identical page counts, 98.4–100% of
poppler's words, 87.5% of its parsed rows word for word. Five bugs surfaced that way, and every one
of them returned text that looked perfectly fine: characters dropped where two glyphs claimed one
grid cell; a column header that became `Causeandtroubleshooting` because a subset font declared a
space three times wider than the one it drew; `I m p o r t a n t   s a f e t y` from an advance that
ignored the text matrix; a line rendered backwards because the producer drew the right column first.
**A text extractor does not fail by crashing.** It fails by returning something readable with three
words missing from the middle of a table, and no measurement of "did we get text" sees any of it.

---

### 2026-09-23 · The platform's request-body limit is not the one in the changelog

**Task:** drop a 4.4 MB manual on the hosted bench.
**Expected:** it to work. Vercel's changelog says functions now accept 100 MB request bodies.
**Actual:** `413 FUNCTION_PAYLOAD_TOO_LARGE`, as a plain-text platform page, refused before the
function ran. Half the manuals in this project's own corpus are bigger than the real limit of about
4.5 MB.
**Severity:** medium — the feature works, it is just bounded, and the bound arrives as a raw error
with no relation to anything on the page. That reads as *broken* rather than *bounded*, which is the
worst way to be limited.
**Workaround:** the page asks the endpoint what it accepts before it spends somebody's upload, and
says so in the drop target's own line. Anything still too big gets its size, the limit, and the
command that reads any size.
**Suggestion:** when a limit is enforced by the platform ahead of the function, the error is the only
thing the developer can never improve — so it is the one that most needs to say which limit was hit
and where it is documented. And a changelog headline about a raised limit is worth a line about what
still has the old one.

---

### 2026-09-23 · We shipped a denial of service and found it an hour later

**Task:** check that the new reader survives hostile input, since it now parses uploads from anybody.
**Expected:** some crashes on malformed files.
**Actual:** no crashes at all across 267 malformed documents — bit-flipped and truncated real
manuals, self-referential page trees, two-thousand-deep nesting, a fifty-thousand-entry array, absurd
`/Length` values. But a **0.58 MB upload** — one content stream, deflate of six hundred megabytes of
spaces — was inflated in full and took the process to **1.59 GB** of resident memory in under two
seconds. The hosted function has 512 MB.
**Severity:** high, and entirely ours. A file that costs the sender nothing and costs the server a
gigabyte, on an endpoint with no authentication, shipped in the same hour as the feature.
**Workaround:** none — fixed. zlib is told to stop (`maxOutputLength`) rather than this code told to
check afterwards, with a budget per document as well, because a thousand streams each a byte under
the limit is the same attack with more steps. Both caps are measured against the corpus rather than
picked: the largest real decompressed stream is 18.8 MB and the largest document totals 43.3 MB.
**Suggestion, to ourselves:** the lesson is not "remember decompression bombs". It is that adding an
endpoint that accepts a file format changes what the threat model is, and the hour to notice that is
the hour you add it. The fuzzing took twenty minutes and found this, a crash-to-client in the MCP
envelope, an arbitrary-file-read in the vision tool, and a single malformed POST that permanently
broke the household view.

---

### 2026-09-23 · Nova's reasoning arrives as ordinary text, next to the tool call

**Task:** drive the MCP server from Amazon Nova 2 Lite over Bedrock Converse, with tools, as a
simulated Alexa+.
**Expected:** a tool call, and any text meant for the person, distinguishable from any text that is
the model working things out.
**Actual:** the first live turn came back with the model's chain of thought as a plain `text` block
("Okay, let's see. The user has a Bosch dishwasher…") beside its `toolUse`. Converse has a
`reasoningContent` block for exactly this, and it was not used, so a voice client has no field to
tell thinking from speech. Ours read the whole thing aloud.
**Severity:** high for anything that speaks. A kitchen hearing an assistant's internal monologue is
the end of the demo, and a prompt telling the model not to think aloud is only a request.
**Workaround:** speech became a tool. `toolChoice: { any: {} }` makes every response a tool call and
`speak` is the only way to reach the person; any other text goes to the trace. Structural, and it has
held on every run since.
**Suggestion:** return Nova's reasoning in `reasoningContent`, as Converse already allows, or say
in the Nova tool-use docs that text beside a tool call may be reasoning and should not be shown.

Smaller, in the same session: a call's price is in neither the Converse response nor the model
catalog. We read it from the Price List API (`AmazonBedrock` offer, us-east-1) so the ledger could
record dollars rather than tokens. That works, but it is a second API to find and parse for a figure
every caller needs.

---

### 2026-09-23 · An agent eval found five bugs the unit suite had not (our own)

**Task:** check whether the agent obeys its own rules, mechanically, rather than by reading
transcripts: `npm run agent:eval`, six conversations with the person scripted and everything else live.
**Actual:** the first versions scored 6/6 and still showed, in the transcripts, things no rule caught.
Tightening the checks until they caught them turned up:

- **A known machine answered as unknown.** "My Bosch SGE53C55UC…" was passed on as
  `"Bosch SGE53C55UC"`, model lookup was exact, and a reviewed manual came back as "no service data".
  Now resolved once at the MCP boundary: case, spaces and the machine's own brand do not
  distinguish models; a different digit or variant suffix still does.
- **A perfect match with nowhere to go.** `describe_problem` scored the owner's sentence 1.0
  against the manual — and every tool after it was keyed by a fault code, which symptom-keyed
  machines (most sold now) do not have. A symptom's id now stands where a code would.
- **Charged a total nobody said.** It quoted the part price, got "yes, order it", and opened and
  confirmed the checkout in one turn: $41.78 agreed to as £38.42. An order now goes through only on
  a later turn than the checkout, after the speech that ended that turn contained its total.
- **A currency invented.** No tool named one, so it picked pounds. The figures now carry `USD`.
- **Asked for a photo of a code it had just been told.** The tools that look were always offered,
  so it looked first. They are now offered only when a photo exists.

**Lesson worth keeping:** "the tool was called" is not an outcome. The first version of the
no-fault-code scenario passed on exactly that while the agent told the person their problem was
"not in our records". An eval scenario has to assert where the conversation ended up.
