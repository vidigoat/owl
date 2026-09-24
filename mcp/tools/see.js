/**
 * tool: see  —  read a fault code and a model plate off a photograph.
 *
 * This is the claim the whole product rests on: point the camera at the machine and it knows what
 * it is looking at. So two things matter more than elegance here.
 *
 * First, it must never invent a reading. A hallucinated model number sends someone to buy the wrong
 * part; a hallucinated fault code sends them to dismantle a working machine. When the model is not
 * sure, `unsure` comes back and the caller has to handle it.
 *
 * Second, every response says which path produced it. `simulated: true` is not a detail to bury —
 * a demo that cannot distinguish a real read from a canned one is a magic trick, and the README,
 * the interface and the video all have to be able to tell the difference.
 *
 * Bedrock is reached through the AWS CLI rather than an SDK: this project has no dependencies, the
 * CLI is already installed, and it picks up whatever profile the operator configured.
 */

const { execFile } = require('node:child_process');
const { Budget } = require('../budget');

/** One per process, built lazily so importing this module never touches the filesystem. */
let _budget;
const budget = () => (_budget ||= new Budget());
const fs = require('node:fs');
const path = require('node:path');
const { localImage } = require('./local-file');
const os = require('node:os');

const MODEL_ID = process.env.BEDROCK_VISION_MODEL || 'us.amazon.nova-lite-v1:0';
const REGION = process.env.AWS_REGION || 'us-east-1';
const PROFILE = process.env.AWS_PROFILE || null;

/* Deliberately rigid. The model is told to refuse rather than guess, and to answer in a shape we
 * can validate — anything else is treated as a failed read. */
/**
 * The two fields are easy to confuse and the confusion is expensive.
 *
 * The first real Bedrock run read `F21` off a washer's display and returned it as the MODEL. The
 * vision was perfect; the classification was not. A model number in the code field sends the whole
 * diagnosis down a fault tree that does not exist, and a fault code in the model field silently
 * looks up the wrong machine. So the prompt now says where each one physically lives, rather than
 * only what each one is.
 */
const PROMPT = `You are reading a photograph of a home appliance.

Return ONLY minified JSON, no prose, in exactly this shape:
{"model":"<model number or null>","code":"<fault code or null>","confidence":<0..1>}

The two fields come from two different places. Do not put one in the other.

- "code" is what the LIT DISPLAY is showing right now — a short fault code, usually 2-4 characters,
  often in a different colour from everything around it: E24, OE, 4C, F21, dE, UE. If a display is
  showing a fault code, it goes in "code", even if the machine's brand is the only other text you
  can see. Null if the display shows no fault (a clock, a temperature, a cycle name, or nothing).
- "model" is the manufacturer's model number PRINTED ON A STICKER OR RATING PLATE — a long
  alphanumeric string, typically 8-14 characters, next to words like MODEL, SERIAL, FD, or voltage
  and wattage ratings. It is never on the lit display. Null if you cannot see a rating plate.

More rules:
- A short code on a display is never a model number. A long string on a printed label is never a
  fault code.
- If there is no lit display in the picture at all — a photograph of just a sticker or rating plate,
  for instance — then "code" is null. Numbers printed on a label are never fault codes, however
  short they look. FD, E-NR, SERIAL and voltage figures are label text, not faults.
- Numbers that are obviously a temperature, a clock, a cycle time, or a setting are NOT fault codes.
- If you cannot read something with confidence, use null. Do not guess. Do not infer a plausible
  model number from the brand or the appearance of the machine.
- confidence is your confidence in the fields you did fill in.`;

const FORMATS = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.gif': 'gif' };

function bodyFor(base64, format) {
  return {
    messages: [
      {
        role: 'user',
        content: [{ image: { format, source: { bytes: base64 } } }, { text: PROMPT }],
      },
    ],
    inferenceConfig: { maxTokens: 300, temperature: 0 },
  };
}

/**
 * The model does not always answer in JSON null.
 *
 * Asked for a fault code on a healthy machine it sometimes writes the *string* "null", or "none",
 * or "N/A". Uppercasing that produced `code: "NULL"` — a fault code that does not exist, on a
 * machine that is fine, which then failed to look up and reported a misread display. The absence
 * has to survive as an absence.
 */
function blank(v) {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'null' || s === 'none' || s === 'n/a' || s === 'na' || s === 'unknown' || s === '-';
}

/** Pull the JSON object out of whatever the model wrapped it in. */
function parseReading(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      model: blank(parsed.model) ? null : String(parsed.model).trim(),
      code: blank(parsed.code) ? null : String(parsed.code).toUpperCase().replace(/\s/g, ''),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    };
  } catch {
    return null;
  }
}

/**
 * Call Bedrock through the AWS CLI.
 *
 * The response body goes to a temp file rather than /dev/stdout. It used to go to stdout, and the
 * first time this ever reached AWS it failed on every image: the CLI writes the model's response
 * body to the output path AND its own metadata to stdout, so stdout held two JSON documents
 * concatenated and `JSON.parse` died on the second one. A file has exactly one writer.
 *
 * The request body also goes to a file. An image is megabytes of base64 and argv is not.
 */
function invokeBedrock(base64, format) {
  return new Promise((resolve, reject) => {
    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bodyFile = path.join(os.tmpdir(), `ssoh-req-${stamp}.json`);
    const outFile = path.join(os.tmpdir(), `ssoh-res-${stamp}.json`);
    const clean = () => { fs.rmSync(bodyFile, { force: true }); fs.rmSync(outFile, { force: true }); };

    try {
      fs.writeFileSync(bodyFile, JSON.stringify(bodyFor(base64, format)));
    } catch (e) {
      return reject(e);
    }

    /*
     * The ceiling, checked BEFORE the call rather than regretted after it.
     *
     * Every invocation below bills a real AWS account — the owner's production one, since a
     * separate IAM user isolates permissions and not billing. Nothing used to stop a loop, a stuck
     * retry, or a tab left refreshing. A product whose headline feature is refusing to spend your
     * money without being sure should not spend its owner's without a limit.
     */
    try {
      budget().check({ label: 'a Bedrock vision call', images: 1 });
    } catch (e) {
      clean();
      return reject(e);
    }

    const args = [
      'bedrock-runtime',
      'invoke-model',
      '--model-id', MODEL_ID,
      '--region', REGION,
      '--content-type', 'application/json',
      '--cli-binary-format', 'raw-in-base64-out',
      '--body', `fileb://${bodyFile}`,
      outFile,
    ];
    if (PROFILE) args.push('--profile', PROFILE);

    execFile('aws', args, { maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        clean();
        return reject(new Error((stderr || err.message).trim().split('\n').pop()));
      }
      let out;
      try {
        out = fs.readFileSync(outFile, 'utf8');
      } catch (e) {
        clean();
        return reject(e);
      }
      clean();

      /*
       * Record what it cost, from the usage Bedrock reports, before the caller is told it worked.
       *
       * Recorded from the REAL usage block rather than the pre-flight estimate — the estimate
       * deliberately runs high so the ceiling errs toward refusing, and using it here would make
       * the ledger drift steadily above what was actually billed. An unparseable response costs 0
       * rather than NaN, which would poison every later comparison against the ceiling.
       */
      try {
        const usage = JSON.parse(out)?.usage;
        if (usage) budget().record(budget().costOf(usage), { tool: 'see' });
      } catch {
        /* the caller is about to fail on this same body; do not mask that with a ledger error */
      }

      resolve(out);
    });
  });
}

/**
 * Every path that did not actually look at a photograph goes through here.
 *
 * There used to be three of these written out separately and one of them forgot the note — which is
 * precisely how a canned reading ends up presented as a real one. One helper, one shape, no way to
 * leave the label off.
 */
/** Why it could not look, as a fact about this host — "spawn aws ENOENT" is an internal, not a reason. */
function unavailable(e) {
  // The code is lost when invokeBedrock re-wraps the error, so the message is read too.
  if (e && (e.code === 'ENOENT' || /spawn aws ENOENT|aws: (command )?not found/i.test(String(e.message)))) return 'Vision is not set up on this host: it reads photographs through the AWS CLI, which is not installed here.';
  return e && e.message ? e.message : 'The photograph could not be read.';
}

function simulatedRead(reason, expect = {}) {
  return {
    ok: false,
    simulated: true,
    reason,
    model: expect.model ?? null,
    code: expect.code ?? null,
    note: 'Simulated read — nothing in this response was actually seen.',
  };
}

/** 20 MB of base64 is a generous phone photo and a firm ceiling on what a caller can push in. */
const MAX_BASE64 = 20 * 1024 * 1024;

/**
 * Read one photograph.
 *
 * Two ways in, because there are two callers. The evaluation harness has files on disk and passes
 * `imagePath`. A person holding a phone in front of their own dishwasher has bytes and no path, so
 * the device passes `imageBase64` — that path is what makes this a camera rather than a fixture.
 *
 * Always resolves — a failure to reach Bedrock is a simulated read, clearly labelled, never a crash.
 */
async function see({ imagePath, imageBase64, imageFormat, expect = {} }) {
  let base64;
  let format;

  if (imageBase64) {
    // Accept a data: URL or bare base64; a browser hands over the former.
    const m = /^data:image\/([a-z+]+);base64,(.*)$/is.exec(String(imageBase64));
    const raw = m ? m[2] : String(imageBase64);
    format = imageFormat || FORMATS[`.${(m?.[1] || '').toLowerCase()}`] || (m?.[1] === 'png' ? 'png' : 'jpeg');
    if (raw.length > MAX_BASE64) return simulatedRead('Image too large to send (over 20 MB).');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return simulatedRead('That did not decode as an image.');
    base64 = raw.replace(/\s+/g, '');
  } else {
    /*
     * A path from a caller is not a path this may read.
     *
     * `POST /api/see` hands the request body straight to this function, and `tools/call` hands a
     * remote client's arguments straight to it, so `{"imagePath":"/etc/passwd"}` was read off the
     * disk, base64'd, and would have been posted to Bedrock. The deployment has no AWS credentials
     * today, so the call fails before anything leaves — which is luck rather than design.
     */
    const at = localImage(imagePath);
    if (!at.ok) return simulatedRead(imagePath ? at.reason : `No image at ${imagePath}`);

    format = FORMATS[path.extname(at.path).toLowerCase()] || 'jpeg';
    if (!fs.existsSync(at.path)) {
      return simulatedRead(`No image at ${imagePath}`);
    }
    try {
      base64 = fs.readFileSync(at.path).toString('base64');
    } catch (e) {
      return simulatedRead(unavailable(e));
    }
  }

  try {
    const raw = await invokeBedrock(base64, format);
    const envelope = JSON.parse(raw);
    // Nova returns the text under output.message.content[].text
    const text =
      envelope?.output?.message?.content?.map((c) => c.text).filter(Boolean).join(' ') ??
      envelope?.content?.map((c) => c.text).filter(Boolean).join(' ') ??
      '';

    const reading = parseReading(text);
    if (!reading) {
      return { ok: false, simulated: false, reason: 'Model did not return a readable answer.', raw: text.slice(0, 200), model: null, code: null };
    }

    return {
      ok: true,
      simulated: false,
      via: MODEL_ID,
      ...reading,
      unsure: reading.model === null || reading.code === null,
    };
  } catch (e) {
    // No credentials, no Bedrock access, no network. Say so rather than pretending.
    return simulatedRead(unavailable(e), expect);
  }
}

module.exports = { name: 'see', see, parseReading, simulatedRead, PROMPT, MODEL_ID };
