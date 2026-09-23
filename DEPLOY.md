# Deploying the demo URL

```bash
npx vercel --prod
```

No build step, no dependencies, no framework to configure. `vercel.json` routes everything to
`api/index.js`, which is one line: `module.exports = require('../server')`. The hosted site runs the
same handler `npm start` runs — not a second copy adapted for a host, because that is how a demo URL
quietly stops showing what the repository actually does, without anybody deciding it should. A test
asserts the two are the same object.

## What the hosted version deliberately cannot do

Each of these degrades to a stated refusal, never to a plausible answer.

| | why | what it says instead |
|---|---|---|
| read a rating plate or a fault panel | Bedrock vision needs AWS credentials, and the demo has none | the vision tools abstain and say they were not configured |
| the camera | needs a device with one | the device screen falls back to the typed model number |
| record spend | the ledger needs a writable disk, and a serverless function has none | refuses to spend rather than spending unmetered |
| photograph a page a PDF cannot be read from | `pdftoppm` is not on the host | the scan path abstains and says the page could not be rendered |

**Reading a manual is no longer on that list.** It was the worst thing on it — the one capability
this project is for, unavailable to anybody who had only the URL, because `pdftotext` is a binary
and the host has none. `manual/pdf-read.js` reads the PDF format directly with no dependencies, so
the hosted review bench now has a drop target: give it a manufacturer's PDF and the fault table
comes back with the page each cause is printed on, in a few hundred milliseconds.

It is not a claim that it works — it is measured. `npm run pdf:compare` runs the built-in reader and
poppler over every manual on the machine and scores them against each other on the thing that
matters, which is whether `readSymptoms` recovers the same rows:

```
30 manuals · 1,881 pages · page count identical on every one
98.4–100% of poppler's words on every manual
87.5% of poppler's parsed rows recovered word for word
```

poppler still goes first where it exists, and which reader answered travels with every result.
`server.test.js` runs the read twice — once as this machine, once with the binary reader switched
off — because proving the hosted path on a laptop that has poppler proves the wrong thing.

## What it can do

The whole diagnosis loop, the trust gate, the hypothesis space, the question chooser, and the
library — all of that is arithmetic over committed data and needs nothing but Node.

## Credentials

Set nothing, and the tools abstain and the talk page plays its recording — a behaviour worth
showing anyway.

The live agent on `/talk.html` spends real money per turn, and the file ledger in `mcp/budget.js`
cannot hold a ceiling on a serverless host: every instance has its own disk. So on a deployment the
agent needs a **shared** ledger — `mcp/shared-budget.js`, one DynamoDB item every instance reserves
against in a single conditional write — and refuses to talk with credentials but no
`HANDS_LEDGER_TABLE`. `scripts/hosted-setup.sh` makes the table, a least-privilege IAM user and the
Vercel variables in one confirmed step, and `--undo` removes them. The vision tools stay off on the
host either way: they shell out to the AWS CLI, which a serverless function does not have.
