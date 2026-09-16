# Media manifest

Every image the README references lives here. Nothing is committed until it is a real capture of a
real run — no mockups, no composites, nothing staged that the software cannot actually do.

**These are taken automatically.** `npm run capture` starts the server, drives headless Chrome to
each moment by pressing the same buttons a person would, and writes the files below. There is no
back door into a state the software cannot reach on its own, which is how the "real captures only"
rule below stays true without anybody having to remember it.

`flow.gif` is generated too, by `npm run gif` — but not as a screen recording. It shoots the run one
step at a time and stitches the frames, so frame N is the device after exactly N presses. Nothing
can be trimmed out of the middle, and no frame can show a state the software could not reach.

The only thing still wanting a human is `terminal.png`, which is a screenshot of `npm run demo`.

| file | the exact moment | how to get there | status |
|---|---|---|---|
| `hero.png` | the question filling the screen, hypothesis space beneath it | `npm run capture` | **captured** |
| `collapse.png` | a cause greyed out and struck through, right after an answer | `npm run capture` | **captured** |
| `refusal.png` | the amber NOT UPHELD card | `npm run capture` | **captured** |
| `teach.png` | the LG manual on screen, mid-ingest | `npm run capture` | **captured** |
| `learned.png` | the space built from that manual, with the citation line | `npm run capture` | **captured** |
| `checkout.png` | the itemised total beside the $179 alternative | `npm run capture` | **captured** |
| `guide.png` | the hands-free repair steps, one at a time | `npm run capture` | **captured** |
| `terminal.png` | `npm run demo` output, whole loop in one screen | `npm run demo`, then screenshot | TODO |
| `flow.gif` | the full loop end to end, no cuts | `npm run gif` | **captured** |

## Which of these matter most

If only three get taken: **`refusal.png`**, **`collapse.png`**, **`terminal.png`**. Those are the
three things no competing project can show — it declining to sell, the space shrinking because of
something a person did, and the whole procedure running against a machine nobody coded for.

## Rules

- Real captures only. If a frame requires credentials we do not have, it does not get taken — and
  the simulated-read badge stays visible in any shot where the vision step did not really run.
- Crop tight. No desktop, no tabs, no personal data, no reflections.
- GIFs under 5 MB so GitHub plays them inline.
- If a screenshot ever stops matching the software, delete it rather than leave it.
