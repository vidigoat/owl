<div align="center">

<br>

# Second Set of Hands

### An appliance repair copilot for Alexa+, that will not guess.

<br>

[**Live demo**](https://second-set-of-hands.vercel.app) · [The review bench](https://second-set-of-hands.vercel.app/review.html) · [The deep dive](docs/DEEP-DIVE.md) · [For reviewers](docs/JUDGING.md)

<br>

<img src="docs/media/describe.jpg" alt="A sentence answered with the manufacturer's own words and the page they are printed on" width="860">

<br>

</div>

---

You are on a kitchen floor at nine at night. The dishwasher will not drain, your hands are wet, and
the manual is a PDF you cannot hold.

**Tell it what the machine is doing, in your own words.** It answers with the sentence out of the
manufacturer's manual, the cause listed beside it, and the page it is printed on — then talks you
through the repair without your hands, and orders a part only if the diagnosis was verified.

## Try it

```bash
git clone <repo> && cd second-set-of-hands

npm run demo          # the whole loop in a terminal, ~20 seconds
npm run mcp:session   # a real MCP session — the Alexa+ deliverable, proven in one command
npm start             # http://localhost:8792 — the device experience
npm run alexa         # talk to it — Amazon Nova on Bedrock choosing the tools, over MCP
npm test              # 46 suites · 542 checks
npm run smoke:live    # every route of the deployed site and the MCP handshake, after a deploy
```

Nothing to install. The MCP server has zero dependencies and no build step.

## The thing we got wrong, and what it taught us

We built this around fault codes. Then we read ten current Bosch dishwasher manuals fetched from
Bosch's own site and found **zero fault codes between them** — the codes moved into repair
documentation those models do not publish. What manufacturers print now is a table keyed on a
*described symptom*:

```
Fault                       Cause and troubleshooting
Water is left in the        Filter system or area under the filters is blocked.
appliance at the end of         Clean the Filters, Page 35.
the program.                Program has not yet ended.
                                Wait until the program ends.
```

So the way in is a sentence somebody says out loud. Which is also the better door: *"all the lights
are flashing"* is what a person says; `E:22` is not.

## An agent drives it, not a script

**Use the real thing today at [`/connect.html`](https://second-set-of-hands.vercel.app/connect.html):**
add `https://second-set-of-hands.vercel.app/mcp` to Claude as a custom connector (no sign-in), and
talk a repair through with the same twenty-two tools Alexa+ would call. The page asks the server for
its tools live, so what it lists is what is there.

**Talk to it at `/talk.html`** (`npm start`, with AWS credentials): say what the machine is doing,
and the screen draws the real MCP App card for whichever tool the agent just called, with every
call listed under its reply. Where there are no credentials — the hosted URL, today — the page says
so, and plays a recording of a real session (`docs/media/talk.webm`) rather than pretending. Hosting
it live is one confirmed step, `scripts/hosted-setup.sh`, behind a spend ceiling every instance
shares (`mcp/shared-budget.js`): a deployment with keys and no shared ledger refuses to talk. The
same table then keeps the household — machines and their repairs — across sessions
(`mcp/household-store.js`); until then the hosted house is not kept — one server's memory at most — and says so.

`npm run alexa` is the same simulated Alexa+ in a terminal: **Amazon Nova 2 Lite on Bedrock**, connected to the MCP server
over Streamable HTTP, choosing every tool itself. No SDK — the SigV4 signing is 92 lines of code in
`agent/sigv4.js`, checked against AWS's own test vectors. A whole repair costs about two cents.

Its first live runs broke four of its own rules in two conversations: it read its chain of thought
aloud, skipped the five-second check by calling a shortcut, recorded an ordered pump as a verified
fix, and told somebody a repair needed "no tools" when no tool had said so. Each is now a
**structure, not a request** in a prompt:

| what went wrong on a live run | what holds it now |
|---|---|
| reasoning read out as speech | speaking is a tool call; nothing else reaches the room |
| picked its question off a list | the checks stay client-side, so it has to ask `next_test` |
| an ordered part recorded as fixed | `confirmed` is downgraded unless `confirm_fix` saw it clear |
| charged a total nobody had said | an order goes through only on a later turn, after that total was spoken |
| asked for a photo of a panel whose code it had just been told | the tools that look are not offered until there is a photo |
| a 73-word turn to somebody with both hands in a machine | a line over forty words is sent back once |
| started walking somebody through fitting a pump they did not have | a repair that needs a part is not guided until the part was asked about, on an earlier turn |
| asked a check it made up rather than the one `next_test` chose | a question while a diagnosis is open is sent back until `next_test` has been asked |
| started from scratch on a machine this house had repaired three weeks before | the machine's record is read when a diagnosis starts, and a fault that has come back is said first — *"This E24 is back — last time, on September 2: replaced the drain pump."* |

`npm run agent:eval` checks that against twenty-three conversations — among them an order smuggled in
as a "system override", an electrician who insists on being talked through mains work, a question
in place of a yes, a house asked what it is owed, and a GE dishwasher described in the owner's words — the person scripted, everything else
live — and ten rules on every turn. Last run: **23 of 23** agent scenarios, **0** rule violations,
recorded in `docs/agent-eval.json`. The agent is a language model and a run can differ; the rules
that matter are held by the client and the server, not asked of it. The eval has found six bugs the
unit suite had not: a model said as "Bosch SGE53C55UC" answered as unknown; a symptom matched
perfectly with nowhere to go next; the agent inventing a model number nobody said ("Whirlpool
WDT750SAHZ"), which the client now withholds; `guide` reading out a repair behind mains wiring
when called directly, which it now refuses itself; a refusal sent back only once; and "the filter was cleared and the machine drains now", said of a
fix nobody saw work.

## What the screen shows — an MCP App

On an Echo Show, Alexa+ draws a tool's UI through the MCP Apps extension. Eight of the tools name
`ui://second-set-of-hands/card` in `_meta.ui.resourceUri`; the card is one self-contained page
served as `text/html;profile=mcp-app` that speaks the host protocol over postMessage and draws
whatever the tool returned: the causes still standing, the one check, the verdict, one step at a
time, the itemised cart. It computes nothing and loads nothing from anywhere, so it needs no CSP
allowance. `/app-host.html` runs it in a reference host we wrote — the real resource, real tool
calls — and `mcp/apps/card.test.js` runs its script as a host would, fed real tool results.

**Ready to onboard.** `addon.json` is the package the Alexa AI CLI uploads — the deployed `/mcp`
endpoint, the store listing, icons and carousel images rendered from the real card, and the privacy
and terms pages — checked against every limit Amazon publishes by `addon.test.js`.

## What it refuses to do

The refusals are the product. Each one exists in code and has a test proving it still refuses.

| it will not | because |
|---|---|
| invent a procedure | somebody is following it with their hands inside a machine |
| spend money on a guess | one function may authorise spending; it declines when a cheaper cause has not been **ruled out**, when causes are within the **15%** separation threshold, or when the cause sits behind **mains** wiring |
| treat "not found" as "nothing is wrong" | it names the problems the manual *does* list instead |
| pass off a reading as a fact | every claim is tagged `read`, `checked`, or **NOT VERIFIED** |
| redistribute the manuals | the parsed quotations are committed; the pages are not |

```
  "there is a burning smell"
  → Nothing in SGE53C55UC's manual matches that description. It lists 39 problems
    and none of them is this one, which is not the same as nothing being wrong.
```

## The library, and how it came to know things

460 manuals read — **7026 symptoms, 14937 causes**, every one citing its page — which with the
hand-written ones puts **453 machines in the library**, across six manufacturers and eleven kinds of
appliance. Then **every quotation is re-read off the page it cites** by script: 14,226 of 14,805
admitted, and the 579 that failed — not on the page, or read in a way the reader itself doubts —
are refused by name. A machine also answers for the other model
numbers its manufacturer lists the same manual for — 1,639 more, exactly those, never a near one
(`scripts/cover-families.js`). How much of what Bosch and Siemens sell that reaches, per kind, is
`npm run coverage` (`docs/coverage.json`).

**It reads GE, which is what most North American kitchens actually have.** The library was Bosch
and Siemens — one manufacturer's family. GE prints a different table: three columns side by side
(*Problem · Possible Cause · What To Do*), the header words centred over them, no indent to say
where a cause begins. `manual/symptoms.js` reads that by position now, and `scripts/source-ge.js`
follows GE's own route from a model number to its owner's manual: **343 GE machines — dishwashers,
washers, dryers, refrigerators and ranges — answering for 1,930 model numbers**, 11,748 causes, each
re-read off its page. Four things it refuses rather than guesses, each found on a real manual:
a row whose columns ran together (dropped whole, not cut at a convenient space), a cause it cannot
tell from two (marked, and refused at admission), and a page whose text layer is font-scrambled
(`(LWKHURUERWKFRQWUROVVHWWR2))` is what one GE refrigerator's says for "Either or both controls
set to OFF") — refused whole; and one numbered procedure printed beside several causes, which read
row by row files step two under a cause it was never printed for. And the rows the page check
cannot catch, because every word of them IS on the page: a remedy that opens mid-sentence ("se high
quality rinse agents"), an aside in brackets read as a problem, one line read twice as a cause. Each
is refused by name, with its reason; a page number trailing a symptom ("Cloudiness on glassware 14")
is simply dropped.

<img src="docs/media/bench.jpg" alt="The review bench: the manufacturer's rendered page on the left, the parse on the right, every cause citing its page" width="100%">

Nothing reaches the library without that check, and the bench above is where a person makes the one
a machine cannot: whether a cause belongs to the symptom it was filed under.

**It follows the manual's own "see page 35".** A troubleshooting table points rather than
explains — *"Clean the Filters, Page 35"* — and a live agent handed only that filled the gap with
plausible steps page 35 does not contain. `npm run procedures` follows every such pointer: of
**73** page references, **10** procedures (83 steps) come back, each step re-found word for word
in poppler's own reading of the page, the first on the page cited, the list not carrying on past
the last. The rest are refused by reason and stay the pointer the manual printed. These are marked
**checked by script, not reviewed** wherever they appear, because they are.

**Try it with your own machine's manual.** The bench has a drop target: give it a manufacturer's
PDF and the fault table comes back in a few hundred milliseconds, every cause citing the page it is
printed on. Nothing is uploaded and nothing is admitted — a machine-read table is a candidate.

That works on the hosted URL because reading a PDF here needs nothing installed. It used to shell
out to `pdftotext`, which is a binary, which the host does not have — so the live bench was
permanently empty and the one capability this project is for was the one thing a visitor could not
see. `manual/pdf-read.js` reads the format itself: cross-references, object streams, fonts, the
content stream, and the glyph positions that put a three-column table back into three columns.

It is measured rather than asserted. `npm run pdf:compare` runs it against poppler over every manual
on the machine and scores the thing that matters — whether the same rows come out:

| | |
|---|---|
| page count | identical on all **1,881** pages of **30** manuals |
| words | **98.4–100%** of poppler's, on every manual |
| parsed rows | **87.5%** recovered word for word, plus 287 rows poppler did not produce |

poppler still goes first where it exists, and which reader answered travels with every result.

## Hands-free, because your hands are busy

One step at a time, at the size of a headline, four feet away — and it does not advance until you
say so, because the machine has no idea whether your hands came back out.

## What is honestly not proven

The vision reader scores **7/9** fault codes and **1/1** model numbers against nine deliberately hard
panels — glare, a crouching angle, a thumb across the display. But those panels are **drawings we
rendered**, not photographs of real machines. `eval/photos/` is empty, so the claim that this reads
real appliances in a real kitchen is **UNPROVEN**, whatever the score above says.

There is one more worth knowing: asked to read a fault table on a page that has none, the vision
model produced one — seven codes, four of them using other manufacturers' conventions. It is
reproducible, it is written up in the [friction log](docs/FRICTION-LOG.md), and the guard that
catches it is arithmetic rather than a prompt.

---

<div align="center">

**[The deep dive →](docs/DEEP-DIVE.md)**  ·  twenty-two tools, every decision, every bug

Amazon Developer Hackathon · Alexa+ · AWS Builder · Open Source ([faultgraph](https://github.com/vidigoat/faultgraph), MIT)

</div>
