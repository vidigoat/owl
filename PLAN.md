# Plan

Amazon Developer Hackathon, Alexa+ track. Submissions close **23 Oct 2026, 12:00 PT**
(24 Oct, 00:30 IST). Judging 9–20 Nov. Winners ~3 Dec.

Target: **$25,000** track first place, plus **$5,000** from one mini challenge (AWS Builder), plus the
friction-log bonus of up to 10% on the score. A project can take one track prize and one mini prize, so
$30,000 is the ceiling.

## Runway

This is the earlier deadline and the larger prize, so it has priority over the Nebius entry.

| week | what has to be true by the end of it |
|---|---|
| 0 · to 21 Sep | AWS account with Bedrock access, `alexa-ai` authenticated, $150 credits requested, hello-world MCP add-on answering |
| 1 · 22–28 Sep | vision reads a real fault code and model plate from a photo; `diagnose` returns ranked causes |
| 2 · 29 Sep–5 Oct | the trust gate refuses the ambiguous case; guided steps paced correctly; memory writes a repair receipt |
| 3 · 6–12 Oct | part lookup by model, Wallet checkout flow, `confirm_fix` re-reads the panel |
| 4 · 13–19 Oct | device experience polished, README written, product feedback and friction log complete |
| 5 · 20–21 Oct | video recorded, **submit 21 Oct** with two days of slack before the deadline |

## Scoring levers, in order of value

1. **The video.** Judges are not required to run anything. Under three minutes, real capture, and it has
   to open on the cost of the problem, not on the architecture.
2. **The refusal.** Show it. It is the one thing no competing project has.
3. **Friction log.** Up to 10% on the final score, and it costs nothing if written while building.
4. **The mini challenge.** AWS Builder is a $5,000 add-on for work the project needs anyway (Bedrock
   vision, AgentCore memory).

## Submission checklist

- [ ] MCP server called at runtime — imported and invoked, not just described
- [ ] Streamable HTTP, spec `2025-11-25` or later
- [ ] Public repo, MIT licence visible on the repo page, README with run instructions
- [ ] Demo video under three minutes, public, English
- [ ] Product feedback for every tool used
- [ ] Track and mini challenge both selected on the form
- [ ] Friction log attached
- [ ] Note explaining what was built during the submission window

## What "done" means here

Someone who has never seen this should watch the video and understand, without being told: the machine
is broken, the assistant can see it, it checked before it spent money, the person fixed it themselves,
and the part is on the way. If the video needs narration to explain what is happening on screen, the
product is not finished.
