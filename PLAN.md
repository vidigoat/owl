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

## 1b. Status, 21 September — what the plan met, and what it got wrong

Phases 1 to 3 are built. The thing the plan got wrong is more interesting than the things it got
right, so it goes first.

**The plan assumed fault codes exist.** Every phase is written around "a code on a panel". Measured
against ten current Bosch US dishwasher manuals fetched from Bosch's own site: **zero fault codes,
in any of them.** Ten to thirteen pages each of `Fault | Cause and troubleshooting`, keyed on a
described symptom. The 2019 European manual this project was built against has ten code mentions;
the 2024 US ones have none. Fetching a `RH` *self-repair hints* document to find them — 482 pages
for a fridge-freezer — turned up zero as well; it is a disassembly guide.

Nothing Bosch publishes to owners carries fault codes any more. For current machines the symptom
table is not a fallback, it is the only door. `manual/symptoms.js` reads it, and the entry point
needs rethinking rather than defending: *"all the lights are flashing"* is what somebody says out
loud, and `E:22` is not.

| phase | stated | where it got to |
|---|---|---|
| 1 · library pipeline | 40 machines | **Route solved.** `source-manuals.js` does sitemap → product page → typed document list; the ID-scanning that yielded language duplicates is dead. 12 machines on the bench (103 symptoms, 144 causes) across dishwashers, a washer and a refrigerator. Target unmet, and the reason is the finding above, not the pipeline. |
| 1b · review | "a review queue" | **Built as a screen**, not a queue. Evidence on the left, parse on the right, admission per code. It caught a real error on its first use — the manual prints `E:16`, the model read `E18`. |
| 2 · the household | shorter second conversation | **Recurrence** added: the same fault on the same machine on separate occasions, with dates and confirmed-fix counts, and no conclusion drawn from them. |
| 3 · replace-vs-repair | a verdict | **Built as a refusal.** It reports what is known and names the figure it cannot have — what the machine is worth — and answers the moment somebody supplies it. It never returns a verdict, and a test asserts that in every state. |
| 4 · surfaces | design | Partly. The bench and the library view exist; the device screens are unchanged. |

**Deployable.** The server is a handler now rather than a `listen()` call, `api/index.js` re-exports
it, and a test asserts the hosted copy is the same object. Not deployed — that is a public URL and
Vidit's call.

267 checks across 23 suites, green. Spend $0.015 of a $0.50 ceiling.

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

## 4. Phases — rewritten 21 September, because the ground moved

Phases 1 to 3 are built and the plan they were written against was wrong about the one thing it
assumed hardest. What follows is the work that is actually left, not the work that was imagined.

### Phase 1 · The machine library — **done, and the target was the wrong target**

Sourcing is solved. `scripts/source-manuals.js` goes sitemap → product page → typed document list,
which is how you get English editions instead of the language duplicates that defeated ID-scanning.
Bosch alone exposes 259 non-accessory product pages across seven appliance categories; 27 manuals
were fetched in an evening under a bandwidth cap.

**The target of "40 machines" was set when a machine meant a fault-code table.** It does not any
more, and the honest replacement is two numbers rather than one:

```
machines the library can answer for      18   (4 by hand, 14 read and checked)
of those, answerable BY CODE              5
of those, answerable BY DESCRIPTION      14
```

A machine known only by description is fully known — for machines sold now it is the only way it
can be known. Chasing 40 by counting either kind is fine; chasing 40 *fault-code* machines would
mean chasing documentation manufacturers have stopped publishing.

**Still to do here:** Whirlpool and LG. Both routes are verified and written down in
`docs/NEEDS.md` — Whirlpool is one JSON endpoint covering two brands, LG is a server-rendered page
plus a file id. Both need a browser engine for the HTML step, which is the only reason they are not
done. Samsung is excluded on purpose: its robots.txt forbids both halves of the route.

### Phase 2 · The household — **done, narrowly**

`whats_due` reports two kinds of thing and keeps them apart: a consumable past its stated interval,
and a fault that has come back. Recurrence is counted by **occasion, not by receipt** — a single
diagnosis writes several, and walking the demo twice writes a dozen; run against the real store it
first reported one fault thirty-two times.

It draws no conclusion. What a recurrence *means* is not derivable from three timestamps, and a
test asserts the returned object carries no verdict, severity or advice.

**Still to do:** nothing required. The stated bar — a second conversation visibly shorter than the
first — is met by the library answering at all.

### Phase 3 · The replace-vs-repair verdict — **done as a refusal, which is the better product**

It needs three numbers and there are one and a half: the repair cost (known when a part is verified
for that exact model), the machine's behaviour (free, from the household's own history), and what
the machine is *worth* — which no manual contains and this will not guess.

So it names the missing figure and answers the moment somebody supplies it. It never returns a
verdict, and a test asserts that in every state including both extremes. The threshold it compares
against is stated as a policy of the tool, with its number, and is an argument.

### Phase 4 · Surfaces — **half done, and the half that is left is the smaller half**

Built: the review bench, the library view, the describe screen with speech and a spoken walkthrough,
and two doors on the device given equal weight instead of one buried among seven buttons.

**Still to do, in order of what a reviewer would notice:**

1. **Per-cause admission.** Admission is per symptom, so one truncated cause costs the two good ones
   above it — that happened twice tonight and both times the right call was to throw away work.
   Nested checkboxes under each symptom. Half a day.
2. **The household view.** Still the screen that turns a demo into a product: machines, history per
   machine, what is due. Dense and typographic, and it must not become a dashboard of cards.
3. **Drift on the fleet page's sibling** — not applicable here; skip.

Still banned, and still the difference between designed and assembled: gradient hero, three-column
feature grid, emoji-as-icon, big-number-small-label, `01 / 02 / 03` markers, tracked-out ALL-CAPS
eyebrows. Real brand assets from official press kits only. **Never a redrawn logo.**

### Phase 5 · Freeze (13–15 Oct), then record and submit

- No new capability after freeze. Review, record, submit.
- **Deploy first.** `npx vercel --prod`, one command, no config; `DEPLOY.md` states what the hosted
  version cannot do and what it says instead. Not run — a deploy publishes a URL and that is
  Vidit's call.
- Repo may stay **private**: sharing with `testing@devpost.com` and `@AmazonAppDev` satisfies the
  rule.
- `docs/FRICTION-LOG.md` finalised. **Up to 10% of the score.** Written as it happens, never
  reconstructed.
- `docs/PRODUCT-FEEDBACK.md` on every tool, API and SDK used — a stated requirement.
- Both mini challenges: **AWS Builder** (Bedrock, live and measured) and **Open Source**
  (`faultgraph`, public, MIT, 86 checks, now reading both kinds of table).

---

## 5. Cut order — what dies first

```
1st to go    the household view          the device already shows history; the view is a nicety
2nd          per-cause admission         per-symptom works; it just wastes good rows sometimes
3rd          Whirlpool and LG            18 machines is already 3.6× the morning's library
4th          the spoken walkthrough      the steps are on screen and numbered either way
NEVER cut    the review bench            it caught E:16 read as E18 on its first use
NEVER cut    the absence tests           "could not establish X" ≠ "X is absent" is the spine
NEVER cut    the trust gate              mains work is refused at the gate; that is the product
NEVER cut    the friction log            up to 10% of the score, for writing rather than code
```

---

## 6. Risks, and what we do about each

**~~Manual sourcing is slower than hoped.~~** **Solved.** The route is sitemap → product page →
typed document list, it is polite and capped, and it fetched 27 manuals in an evening. What it
found instead is the risk below.

**The entry point does not match what manufacturers publish.** *The real one, and it was invisible
until measured.* Ten current Bosch manuals contain no fault codes between them. → Already answered:
the library reads and answers by described symptom, the device has a door for it, and both are on
the first screen rather than buried. The residual risk is a reviewer who tries the code path on a
current machine and finds nothing — which is why the hero paragraph now says so before they can.

**A wrong reading reaches the library.** *The dangerous one* — this product's whole claim is about
not being confidently wrong. → Nothing is admitted without a person; admission is per row; every
rejection is recorded rather than deleted; a row the parser could not read cleanly is **flagged**
rather than presented as fact. The bench caught a misread fault code on its first use and a
mislabelled symptom on its last.

**A parser that is wrong in a way nothing notices.** *The one that nearly got through.* Nine parser
bugs were found tonight by READING candidates, not by running tests — page furniture read as
symptoms, columns that move between pages, causes swallowed into remedies, a table with no idea
where it ended. Every one was silent; several produced output that looked perfectly well formed.
→ Reviewing is the detector, and it is now also the habit. A sweep for odd-looking rows across every
machine runs in one command and finds one flagged row where it used to find junk on half of them.

**Bedrock spend runs away.** → A persistent ceiling on disk that refuses before it spends, not
after; every image that goes out passes through one metered call. Tonight's total: **$0.024 of
$0.50**, including reading 27 manuals and escalating a dozen pages to vision.

## 7. What the submission has to contain

| required | state |
|---|---|
| self-hosted MCP server, spec 2025-11-25+, Streamable HTTP | 19 tools + resources, verified |
| the repo genuinely *calls* the track technology in code | yes — Bedrock live, not a README mention |
| public repo **or** private + shared with reviewers | private is allowed; share at submission |
| text description | `docs/SUBMISSION.md` |
| ≤3 min public YouTube video showing the MCP server in action | `docs/DEMO-SCRIPT.md`, shot list numbered |
| product feedback on every tool/API/SDK used | `docs/PRODUCT-FEEDBACK.md` |
| tracks + minis | Alexa+ · AWS Builder · Open Source |
| what changed during the window | built in it |
| **friction log — up to 10% bonus** | `docs/FRICTION-LOG.md`, 12 entries |
| a working URL | one command away; **not deployed** — that is Vidit's call |

---

## 8. Measurable targets — restated 21 September

The old table counted one thing and the world turned out to have two in it.

```
                            this morning    tonight        target       floor
machines the library knows        5            18          150–200        40
  · by fault code                 4             5             —            —
  · by described symptom          1            14             —            —
symptoms recovered                0           121             —            —
causes, each citing a page       11           208             —            —
readings rejected and kept        0            11          (a health sign, not a target)
manuals fetched from source       1            27          hundreds      dozens
MCP tools                        17            19            20+          17
tests (this repo)               201           297           keep green
faultgraph (public, MIT)         50            86           keep green
Bedrock spend               $0.0021       $0.0241       under $0.50   hard ceiling
real appliance photographs        0             0             10            6
```

**Two rows are the honest scoreboard now.**

*Machines by described symptom* went from 1 to 14 in an evening, and that is the number that scales:
the manuals exist in the hundreds, the route to them works, and the reader is free and offline for
all but the collided rows.

*Readings rejected and kept* is the one nobody would think to put on a scoreboard. Eleven readings
were looked at and refused, and each one is recorded on the machine's row rather than deleted. A
library with zero rejections has either perfect inputs or no reviewer, and it is never the first.

The photographs row is unchanged and still blocked, and it is still not blocking: `npm run eval`
scores the vision reader on rendered panels at 7/9 codes and 0 invented, and moving to real
photographs turns a measurement into a better measurement rather than turning a claim into one.

## 9. What is needed from Vidit

See `docs/NEEDS.md` — one list, both projects, ordered by what blocks what.
