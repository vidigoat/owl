/**
 * tool: read_manual
 *
 * "I've never seen this machine. Show me its manual."
 *
 * `learn` takes the text of a fault table. Nobody has the text of a fault table. They have a
 * booklet in a drawer, or a sticker inside the door, or a PDF they are not going to copy and paste
 * at 9pm with a broken dishwasher.
 *
 * So this reads the page. Bedrock transcribes the fault table off a photograph, the existing parser
 * in manual/faultgraph.js turns it into a hypothesis space, and the machine is known — by a project
 * that has never heard of it, from a picture taken thirty seconds ago.
 *
 * The rule that makes this safe is the same one that governs the vision path everywhere else:
 * **transcribe, never interpret.** The model is asked to copy characters, not to explain what a
 * fault means or to supply a remedy it thinks is likely. Every cause this produces cites a line
 * that was physically on the page, and a page with no fault table on it recovers nothing and says
 * so — rather than producing a plausible-looking hypothesis space out of prose.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { parse } = require('../../manual/faultgraph');
const { learn, known } = require('../../data/service-data');

const run = promisify(execFile);

const name = 'read_manual';

const description =
  'Read an appliance service manual from a photograph of the page and learn that machine at ' +
  'runtime. Transcribes the fault table character for character; it does not interpret, invent a ' +
  'remedy, or fill in a code it could not read. A page with no fault table on it recovers nothing ' +
  'and says so.';

const MODEL_ID = process.env.BEDROCK_VISION_MODEL || 'us.amazon.nova-lite-v1:0';
const REGION = process.env.AWS_REGION || 'us-east-1';
const PROFILE = process.env.AWS_PROFILE || '';
const FORMATS = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.gif': 'gif' };

/**
 * Transcription, not comprehension.
 *
 * The temptation is to ask the model what the codes mean, and it would happily tell you — including
 * for a machine it has never seen, in a tone indistinguishable from the ones it has. Everything
 * downstream cites the manual, so a model-invented remedy would arrive wearing a citation to a line
 * that does not exist. Copying is the whole job.
 */
const PROMPT = `This is a page from an appliance service manual. Transcribe the FAULT CODE TABLE
from it, exactly as printed.

Rules:
- Copy the text. Do not explain it, do not rephrase it, do not tidy it up, and do not add a remedy
  that is not printed on the page.
- One code per block. Put the code first, then its meaning, then each remedy step on its own
  indented line, in the order the page lists them. That order is information.
- Codes look like E24, F21, OE, dE, 4C, 5E, H20.
- If a code or a line is not legible, leave it out. Do not guess at a character.
- If this page has no fault code table on it, reply with exactly: NO FAULT TABLE

Reply with the transcription and nothing else. No preamble, no commentary.`;

function invoke(base64, format) {
  return new Promise((resolve, reject) => {
    const stamp = `${process.pid}-${Date.now()}`;
    const bodyFile = path.join(os.tmpdir(), `ssoh-man-${stamp}.json`);
    const outFile = path.join(os.tmpdir(), `ssoh-man-${stamp}.out`);
    const clean = () => { fs.rmSync(bodyFile, { force: true }); fs.rmSync(outFile, { force: true }); };

    fs.writeFileSync(bodyFile, JSON.stringify({
      messages: [{ role: 'user', content: [{ image: { format, source: { bytes: base64 } } }, { text: PROMPT }] }],
      // Generous: a fault table is the longest thing this project ever asks a model to produce, and
      // a table cut off halfway is worse than no table — it looks complete.
      inferenceConfig: { maxTokens: 2000, temperature: 0 },
    }));

    const args = ['bedrock-runtime', 'invoke-model', '--model-id', MODEL_ID, '--region', REGION,
      '--content-type', 'application/json', '--cli-binary-format', 'raw-in-base64-out',
      '--body', `fileb://${bodyFile}`, outFile];
    if (PROFILE) args.push('--profile', PROFILE);

    execFile('aws', args, { maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) { clean(); return reject(new Error((stderr || err.message).trim().split('\n').pop())); }
      let raw;
      try { raw = fs.readFileSync(outFile, 'utf8'); } catch (e) { clean(); return reject(e); }
      clean();
      resolve(raw);
    });
  });
}

const notRead = (reason) => ({
  abstain: true,
  learned: false,
  simulated: true,
  reason,
  note: 'Nothing in this response was actually read off a page.',
});

/**
 * @param {object} arg
 * @param {string} [arg.imagePath]    a photograph of the manual page
 * @param {string} [arg.imageBase64]  the same, as bytes from a camera
 * @param {string} arg.model          which machine this manual belongs to
 * @param {string} [arg.brand]
 * @param {string} [arg.kind]
 */
async function read_manual({ imagePath, imageBase64, model, brand, kind } = {}) {
  if (!model) {
    return {
      abstain: true,
      learned: false,
      reason: 'I need to know which machine this manual is for before I can file what it says.',
      nextStep: 'Photograph the rating plate, or tell me the model number.',
    };
  }

  let base64;
  let format;
  if (imageBase64) {
    const m = /^data:image\/([a-z+]+);base64,(.*)$/is.exec(String(imageBase64));
    base64 = (m ? m[2] : String(imageBase64)).replace(/\s+/g, '');
    format = FORMATS[`.${(m?.[1] || '').toLowerCase()}`] || 'jpeg';
    if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return notRead('That did not decode as an image.');
  } else {
    if (!imagePath || !fs.existsSync(imagePath)) return notRead(`No image at ${imagePath}`);
    format = FORMATS[path.extname(imagePath).toLowerCase()] || 'jpeg';
    base64 = fs.readFileSync(imagePath).toString('base64');
  }

  let text;
  try {
    const envelope = JSON.parse(await invoke(base64, format));
    text = envelope?.output?.message?.content?.map((c) => c.text).filter(Boolean).join('\n') ?? '';
  } catch (e) {
    return notRead(e.message);
  }

  if (!text.trim() || /^\s*NO FAULT TABLE\s*$/i.test(text.trim())) {
    return {
      abstain: true,
      learned: false,
      transcribed: text.trim() || null,
      reason: 'There is no fault code table on that page.',
      nextStep: 'It is usually a page headed "Error codes" or "Troubleshooting", often near the back.',
    };
  }

  // The same parser the pasted-text path uses. A photograph is a different way of getting the
  // characters, not a different kind of knowledge, and it must not get its own private rules.
  const graph = parse({ model, text, sourceName: `${brand || ''} service manual`.trim() });
  const codes = Object.keys(graph.codes || {});

  if (!codes.length) {
    return {
      abstain: true,
      learned: false,
      transcribed: text.slice(0, 600),
      reason: 'I read the page, but could not get a fault table out of it.',
      coverage: graph.coverage,
      note: 'Transcribed text is included above so you can see what it actually saw.',
    };
  }

  learn({ model, brand: brand || null, kind: kind || null, codes: graph.codes, source: `${brand || ''} service manual`.trim() });

  return {
    learned: true,
    model,
    codes,
    codeCount: codes.length,
    coverage: graph.coverage,
    readFromPhotograph: true,
    known: known(model),
    // What it actually saw, so a person can check the transcription against the page in their hand
    // rather than taking a fault table on trust.
    transcribed: text.slice(0, 1200),
  };
}

module.exports = { name, description, read_manual, PROMPT, MODEL_ID };
