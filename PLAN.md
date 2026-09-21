# Second Set of Hands — the 10× plan

Amazon Developer Hackathon, **Alexa+ track**. Submissions close **23 Oct 2026, 12:00 PT**
(24 Oct, 00:30 IST).

```
written          21 Sep 2026
build days left  22–24         freeze 13–15 Oct, then record and submit
ceiling          $25,000 track 1st  +  $5,000 one mini  =  $30,000 cash
                 (+ $20,000 AWS credits, + up to 10% score bonus on the friction log)
```

Judged on four **equally weighted** criteria: Tech Implementation, Design, Potential Impact,
Quality of the Idea. Two stages: Stage 1 is pass/fail on whether the repo genuinely calls the track
technology; Stage 2 is the scoring. The friction-log bonus is assessed by Amazon's *internal* team
during Stage 1 and handed to the panel as a recommendation — which makes it the highest
points-per-hour item in the whole submission.

**This deadline lands first and carries the larger prize. It has priority until 15 October.**

---

## 1. Where this actually is, stated without flattery

**What is real and working today**

| | |
|---|---|
| MCP server | 17 tools + 2 resources over Streamable HTTP, spec `2025-11-25`. Verified end to end |
| Bedrock vision | **live**. Reads a panel off a real photograph; 7/9 on deliberately hard renders, 0 invented codes |
| the trust gate | refuses on mains voltage / cheaper-cause-unruled-out / <15% separation / no evidence |
| learning from a manual | reads a fault table off a photographed page and diagnoses a machine it has never seen |
| `faultgraph` | spun out, MIT, public — the Open Source mini challenge, claimed |
| spend ceiling | on-disk, pre-flight, fails closed. Added 20 Sep; before that, nothing bounded AWS spend |
| 18 suites, 191 checks | green |

**What is not**

- **It knows one machine properly.** One Bosch dishwasher, fully specified. Three other models
  carry a code with no causes behind it.
- **It has never seen a real kitchen.** `eval/photos/` is empty and the evaluation says so out loud.
- It forgets. `whats_due` exists as a tool with no product built on it. There is no household.
- It is reactive only. Something breaks, it helps. That is the smaller half of the problem.

---

## 2. The thesis, made bigger

Today's framing is "a repair copilot". That is too small, and it is reactive.

> **Your house has forty machines in it. Nobody knows anything about any of them.**
> Not the model number. Not where the manual went. Not what the blinking light means. Not when the
> filter was last changed, or whether this is the second time this has broken or the fourth.

The product is **the permanent, cited service record of a home**. Repair is the acute case. The
chronic case is that the knowledge does not exist anywhere — and Alexa+ is the only thing that is
always present, has a camera, listens, and remembers across sessions.

That reframing matters because it is the one product shape that *needs* Alexa+ rather than merely
running on it. A phone app cannot be in the room when the machine beeps.

```
  ┌─ every machine you own ──────── learned from its own manual, cited line by line
  │
  ├─ every repair you have done ─── what broke, what fixed it, what it cost, when
  │
  ├─ what is due ────────────────── "the dishwasher filter is 40 days overdue"
  │
  └─ what it is worth ──────────── "that is the third pump in two years"
```

### The verdict that wins the track

A repair assistant that occasionally tells you **to stop repairing** has a spine.

> *"That is the third drain pump in two years. Three pumps in two years is not a pump problem."*

Note what that sentence does **not** do: it does not invent a replacement price, and it does not
pretend to know the machine's resale value. It states a **fact from the household's own history**
and draws the obvious conclusion. Same architecture as the existing gate — rules decide, the model
explains — pointed at a bigger decision.

This is the strongest new idea available to us and it costs almost nothing to build, because the
history is already the thing we are storing.

---

## 3. The machine library — the data moat, and its honest bottleneck

One machine known properly is a demo. Two hundred is a product.

```
pipeline (mostly built already)

  manufacturer PDF  ──►  fault-table page  ──►  faultgraph.parse()  ──►  verified entry
     sourcing            page detection         already written,         spot-check by hand
     ← THE BOTTLENECK    scriptable             already tested
```

**The constraint is sourcing, not code.** `faultgraph` already reads four manufacturers' code
schemes, derives cheap observations from remedy conditions, and cites the line every cause came
from. Pointing it at 200 manuals is a data problem.

**What we do and do not publish.** We derive a fault graph and cite the manual. We do **not**
redistribute anybody's PDF. Every cause carries `source: { line, manual }` so a reader can check it
against their own copy. Manuals are taken from manufacturers' own public support pages.

```
target     150–200 machines across the 8 brands that cover most Western kitchens
floor       40 machines — still 40× today, still a real library
```

Each entry is only admitted if `faultgraph` recovered at least one code **with remedies**, so a
half-read manual never becomes a half-known machine. The existing `orphanCodes` reporting already
distinguishes "wrong page" from "right page, layout I cannot read".

---

## 4. Phases

### Phase 1 · The machine library pipeline (21–27 Sep)

- A `scripts/learn-manual.js` that takes a PDF or a directory of them, finds the fault-table pages,
  runs `faultgraph`, and writes a verified entry — or refuses and says which of the two failures it
  hit.
- Page detection: fault tables are findable by density of short alphanumeric tokens at line starts.
  Where that fails, Bedrock reads the page — and the spend ceiling already governs that.
- A **review queue**: every machine is spot-checked by a human before admission. A library of
  confidently wrong fault codes is worse than no library, and this product's entire argument is
  about not being confidently wrong.
- `data/README.md` already documents the shape: `cost: 0` (free) vs `cost: null` (unknown),
  `mains`, `likelihood`, `evidence`. New entries obey it or fail the tests.

**Done when:** 40 machines are in, `npm run questions` still walks every answer path on all of them
exhaustively, and the worst case is still bounded.

### Phase 2 · The household (28 Sep – 4 Oct)

- Machines: what you own, from a rating-plate photograph or a spoken model number.
- Repairs: every diagnosis that concluded, what fixed it, what it cost, when.
- Due: derived from the manual's own service intervals where stated, never invented.
- **`whats_due` becomes a product**, not a tool: "three things in this house need attention."
- This is Alexa+'s "state across sessions" criterion, met literally.

**Done when:** a second conversation about the same machine is visibly shorter than the first, and
the device can answer "what needs doing?" without being asked about a specific machine.

### Phase 3 · The replace-vs-repair verdict (5–8 Oct)

- Rules over the household's own history. Repeated identical failures; a repair whose known cost
  exceeds a stated fraction of a machine's known value *only where both are known*; age where the
  manual states a service life.
- **Refuses to guess.** Where replacement value is unknown — which is most of the time — it says
  the fact and stops: *"third pump in two years"*, not an invented number.
- Same gate architecture: rules decide, Nova explains, and the explanation cites the history.

**Done when:** a seeded household with three pump repairs produces the verdict, and a household
with one does not.

### Phase 4 · Surfaces and design (9–12 Oct)

Design is 25% of the score and our weakest axis. This is not polish; it is a quarter of the total.

- **The device** is the primary surface and already has a direction that works: dark chrome page,
  warm paper screen, Bricolage throughout, Newsreader reserved for the one sentence being spoken.
  Signature motion is the strike-through as a cause is eliminated.
- **The household view** — the service record, readable. Dense and typographic: a list of machines,
  a history per machine, what is due. This is the screen that makes it look like a product rather
  than a demo, and it must not become a dashboard of cards.
- Real brand assets from official press kits only. **Never a redrawn logo.**
- Banned: gradient hero, three-column feature grid, emoji-as-icon, big-number-small-label,
  `01 / 02 / 03` markers, tracked-out ALL-CAPS eyebrows.
- `~/hackathon-design` is the studio, and `node check.js` there verifies every colour and typeface
  it claims against this repository's real CSS. **The product wins; the mockup gets corrected.**

### Phase 5 · Freeze (13–15 Oct), then record and submit

- No new capability after freeze. Review, record, submit.
- Repo may stay **private** — sharing with `testing@devpost.com` and `@AmazonAppDev` satisfies the
  rule. Vidit's call.
- `docs/FRICTION-LOG.md` finalised. **Up to 10% of the score**, assessed by Amazon's internal team.
  Twelve entries exist; every genuine hour of friction from Phases 1–4 goes in as it happens, not
  reconstructed afterwards.
- `docs/PRODUCT-FEEDBACK.md` on every tool, API and SDK used — a stated requirement.
- Both mini challenges submitted: **AWS Builder** (Bedrock, live and measured) and **Open Source**
  (`faultgraph`, public, MIT). Only one can be won; both can be entered.

---

## 5. Cut order — what dies first

```
1st to go    the household web view       the device already shows history; the view is a nicety
2nd          replace-vs-repair verdict    strongest idea, but the gate already refuses well
3rd          library 200 → 40             40 machines is still 40× today
4th          `whats_due` as a product     falls back to being a tool that works
NEVER cut    the trust gate               it is the product
NEVER cut    the absence tests            "could not establish X" ≠ "X is absent" is the spine
NEVER cut    the friction log             it is up to 10% of the score for writing, not code
```

---

## 6. Risks, and what we do about each

**Manual sourcing is slower than hoped.** *Most likely failure.* → The floor is 40 machines and the
pipeline is the same either way. Cut breadth, never the verification step.

**A wrong fault code reaches the library.** *The dangerous one* — this product's whole claim is
that it does not guess. → Human spot-check before admission is non-negotiable, and
`manual/adversarial.test.js` already covers hostile and malformed pages.

**No appliance photographs.** → `eval/photos/` is empty and the evaluation **says so**, loudly, in
its own output. Scored on rendered panels today. Real photographs move this from "unproven" to
proven and they are the single highest-value thing Vidit can hand over.

**AgentCore stays refused.** `AmazonBedrockFullAccess` does not cover `bedrock-agentcore:*`. → The
memory layer is ours already; AgentCore is a "what's next" line, not a dependency.

**Running out of time because of the other hackathon.** → Amazon has priority until 15 Oct. Nebius
gets 15–22 Oct alone, in parallel with Vidit recording this one.

---

## 7. What the submission has to contain

| required | state |
|---|---|
| self-hosted MCP server, spec 2025-11-25+, Streamable HTTP | 17 tools + resources, verified |
| the repo genuinely *calls* the track technology in code | yes — Bedrock live, not a README mention |
| public repo **or** private + shared with reviewers | private is allowed; share at submission |
| text description | `docs/SUBMISSION.md` |
| ≤3 min public YouTube video showing the MCP server in action | `docs/DEMO-SCRIPT.md`, shot list numbered |
| product feedback on every tool/API/SDK used | `docs/PRODUCT-FEEDBACK.md` |
| tracks + minis | Alexa+ · AWS Builder · Open Source |
| what changed during the window | built in it |
| **friction log — up to 10% bonus** | `docs/FRICTION-LOG.md`, 12 entries |

---

## 8. Measurable targets

```
                             today              target          floor
machines known properly      1                  150–200         40
real appliance photos        0                  10              6
household memory             a tool             a product       the tool, wired
replace-vs-repair            none               shipping        cut if needed
MCP tools                    17                 20+             17
tests                        191                300+            keep green
eval: fault codes            7/9 on renders     7/9 on PHOTOS   scored honestly either way
```

The last row is the one that matters. Moving from rendered panels to real photographs is the
difference between a claim and a measurement, and it is blocked on six photographs.

---

## 9. What is needed from Vidit

See `docs/NEEDS.md` — one list, both projects, ordered by what blocks what.
