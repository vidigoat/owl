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
const fs = require('node:fs');
const path = require('node:path');

const MODEL_ID = process.env.BEDROCK_VISION_MODEL || 'us.amazon.nova-lite-v1:0';
const REGION = process.env.AWS_REGION || 'us-east-1';
const PROFILE = process.env.AWS_PROFILE || null;

/* Deliberately rigid. The model is told to refuse rather than guess, and to answer in a shape we
 * can validate — anything else is treated as a failed read. */
const PROMPT = `You are reading a photograph of a home appliance.

Return ONLY minified JSON, no prose, in exactly this shape:
{"model":"<model number or null>","code":"<fault code or null>","confidence":<0..1>}

Rules:
- "model" is the manufacturer's model number from the rating plate, copied character for character.
- "code" is the fault or error code shown on the display, e.g. E24, OE, 4C. Null if no code is shown.
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

/** Pull the JSON object out of whatever the model wrapped it in. */
function parseReading(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      model: parsed.model || null,
      code: parsed.code ? String(parsed.code).toUpperCase().replace(/\s/g, '') : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    };
  } catch {
    return null;
  }
}

function invokeBedrock(base64, format) {
  return new Promise((resolve, reject) => {
    const args = [
      'bedrock-runtime',
      'invoke-model',
      '--model-id', MODEL_ID,
      '--region', REGION,
      '--content-type', 'application/json',
      '--cli-binary-format', 'raw-in-base64-out',
      '--body', JSON.stringify(bodyFor(base64, format)),
      '/dev/stdout',
    ];
    if (PROFILE) args.push('--profile', PROFILE);

    execFile('aws', args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()));
      resolve(stdout);
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

/**
 * Read one photograph.
 * Always resolves — a failure to reach Bedrock is a simulated read, clearly labelled, never a crash.
 */
async function see({ imagePath, expect = {} }) {
  const format = FORMATS[path.extname(imagePath || '').toLowerCase()] || 'jpeg';

  if (!imagePath || !fs.existsSync(imagePath)) {
    return simulatedRead(`No image at ${imagePath}`);
  }

  let base64;
  try {
    base64 = fs.readFileSync(imagePath).toString('base64');
  } catch (e) {
    return simulatedRead(e.message);
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
    return simulatedRead(e.message, expect);
  }
}

module.exports = { name: 'see', see, parseReading, simulatedRead, PROMPT, MODEL_ID };
