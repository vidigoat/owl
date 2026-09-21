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
| learn a new manual | `pdftotext` and `pdftoppm` are not on the host | `pdf.available()` reports false and the reader says the cheap path is unavailable |

The last one matters for what a visitor sees: the **review bench** will show the machines already in
`data/admitted/` and an empty queue, because nothing can be read on the host. That is the honest
state, and the bench says so rather than showing a fabricated candidate.

## What it can do

The whole diagnosis loop, the trust gate, the hypothesis space, the question chooser, and the
library — all of that is arithmetic over committed data and needs nothing but Node.

## Credentials

Set nothing. With an `AWS_PROFILE`/`AWS_ACCESS_KEY_ID` pair the vision tools work, but they spend
real money per call and the spend ceiling cannot persist on a serverless disk — so the deliberate
choice is to leave them off and let the tools abstain, which is a behaviour worth showing anyway.
