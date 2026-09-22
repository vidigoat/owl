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
const { Budget } = require('../budget');

/** One per process, built lazily so importing this module never touches the filesystem. */
let _budget;
const budget = () => (_budget ||= new Budget());
const os = require('node:os');
const path = require('node:path');
const { localImage } = require('./local-file');
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
/*
 * Read the table AS A TABLE.
 *
 * The first version asked for a transcription of the page and got exactly that — the page, in
 * visual line order. Real fault tables are three columns (Fault | Reason | Remedial action) and
 * every cell wraps, so line order interleaves the columns:
 *
 *     Fault code E:07 is lit.
 *     Intake opening (on right inside of      ← reason, line 1
 *     Arrange utensils so that the intake     ← remedy, line 1
 *     appliance) covered by utensils.         ← reason, line 2
 *
 * which parsed into the cause "Intake opening (on right inside of" — truncated mid-phrase — and a
 * fabricated-looking one beginning "Agent or descaler". Both were faithful transcriptions of what
 * the pixels said and both were useless.
 *
 * Reassembling a wrapped cell is not interpretation. The row exists on the page; the line breaks
 * are an artefact of column width. "Transcribe, never interpret" still holds — the model may not
 * add, rephrase or tidy a remedy, and that instruction is stated more firmly here than before,
 * precisely because this one asks it to rearrange.
 */
const PROMPT = `This is a page from an appliance service manual. Transcribe the FAULT CODE TABLE
from it, exactly as printed.

This table has COLUMNS — usually Fault, then Reason, then Remedial action — and the text inside a
cell WRAPS onto several lines. Read it as a table, one row at a time. Join the wrapped lines of a
cell back into one line. Do not read straight across the page, or the columns will interleave and
every entry will be cut in half.

MERGED CELLS. Manufacturers draw one reason cell, or one remedy cell, across several consecutive
fault codes, with no horizontal rule through it. Decide which codes a cell covers by where the
horizontal rules actually are, then repeat that cell's words in full for every code it covers. Do
not slide the reasons up: if three codes share two reason cells, the shared one belongs to the
codes above it, not below. Every fault code printed in the first column gets its own entry, even
when it shares every cell with its neighbour.

Rules:
- Copy the words. Do not explain, rephrase, tidy, summarise, or add a remedy the page does not
  print. Joining a cell's own wrapped lines is the ONLY rearranging allowed.
- If one code lists several separate reasons, that is several entries under the same code.
- Codes look like E24, E:07, F21, OE, dE, 4C, 5E, H20. Keep the code exactly as printed.
- If a cell or a code is not legible, leave it out. Never guess at a character.
- Ignore page numbers, headers, footers and cross-references like "see page 38".
- If this page has no fault code table on it, reply with exactly: NO FAULT TABLE

OUTPUT FORMAT. Every entry is exactly three lines, each on its own line, with a blank line between
entries:

<fault code>
REASON: <the whole reason cell, on one line>
REMEDY: <the whole remedial-action cell, on one line>

Reply with the entries and nothing else. No preamble, no commentary.`;

/**
 * One Bedrock call, one budget check, one place failures are handled.
 *
 * `prompt` defaults to the fault-code one. read_symptoms.js passes its own rather than growing a
 * second call path beside this: the spend ceiling has to see every image that goes out, and a
 * second copy of this function is a second thing to forget to meter.
 */
function invoke(base64, format, prompt = PROMPT) {
  return new Promise((resolve, reject) => {
    const stamp = `${process.pid}-${Date.now()}`;
    const bodyFile = path.join(os.tmpdir(), `ssoh-man-${stamp}.json`);
    const outFile = path.join(os.tmpdir(), `ssoh-man-${stamp}.out`);
    const clean = () => { fs.rmSync(bodyFile, { force: true }); fs.rmSync(outFile, { force: true }); };

    fs.writeFileSync(bodyFile, JSON.stringify({
      messages: [{ role: 'user', content: [{ image: { format, source: { bytes: base64 } } }, { text: prompt }] }],
      // Generous: a fault table is the longest thing this project ever asks a model to produce, and
      // a table cut off halfway is worse than no table — it looks complete.
      inferenceConfig: { maxTokens: 3000, temperature: 0 },
    }));

    // The same ceiling as see.js. A manual page is a photograph too, and this path can be driven in
    // a loop by a caller dropping images — see mcp/budget.js.
    budget().check({ label: 'a Bedrock manual transcription', images: 1, maxTokens: 1400 });

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
async function read_manual({ imagePath, imageBase64, model, brand, kind, transcribe } = {}) {
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
  } else if (imagePath) {
    // Same boundary as `see`: a path from a caller is not a path this may read. See local-file.js.
    const at = localImage(imagePath);
    if (!at.ok) return notRead(at.reason);
    if (!fs.existsSync(at.path)) return notRead(`No image at ${imagePath}`);
    format = FORMATS[path.extname(at.path).toLowerCase()] || 'jpeg';
    base64 = fs.readFileSync(at.path).toString('base64');
  } else if (!transcribe) {
    // No bytes and nothing to turn bytes into characters. Said plainly rather than thrown: this
    // tool is called by a model, and a stack trace is not an answer it can act on.
    return notRead('No image at undefined');
  }

  let text;
  try {
    /*
     * `transcribe` is an injection point, and it exists for one reason: everything after this line
     * decides what a person is TOLD, and none of it should need a camera and an AWS account to
     * test. It is not a mock of the model's judgement — the model's only job here is turning pixels
     * into characters, and a test supplying characters directly is testing the same code path with
     * the same input the model would have produced.
     */
    if (transcribe) {
      text = await transcribe({ base64, format });
    } else {
      const envelope = JSON.parse(await invoke(base64, format));
      text = envelope?.output?.message?.content?.map((c) => c.text).filter(Boolean).join('\n') ?? '';

      /*
       * Record what it cost.
       *
       * This checked the ceiling before the call and then never recorded the spend — so the ledger
       * under-reported, and a run of manual transcriptions could pass a limit it had already
       * exceeded. Found by transcribing a real Bosch manual page and watching the ledger not move.
       *
       * A guard that counts only half the spending is a guard that eventually does not guard.
       */
      const usage = envelope?.usage;
      if (usage) budget().record(budget().costOf(usage), { tool: 'read_manual' });
    }
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
    /*
     * Two ways to get here, and they need opposite things from somebody holding a booklet.
     *
     * With orphan codes, the transcription found things that look like fault codes and no remedies
     * under them — which almost always means a two-column table, the remedy to the right of the
     * code. That person is looking at the right page. "Try the fault-code page" sends them hunting
     * for something already in their hand, and this is spoken aloud.
     */
    const layout = graph.orphanCodes > 0;
    return {
      abstain: true,
      learned: false,
      transcribed: text.slice(0, 600),
      reason: layout
        ? `I read the page and found ${graph.orphanCodes} fault code${graph.orphanCodes === 1 ? '' : 's'}, ` +
          'but no remedies underneath them. This looks like the right page in a layout I cannot read.'
        : 'I read the page, but could not get a fault table out of it.',
      // What to do next, which differs entirely between the two. Named `nextStep` to match every
      // other refusal in this file — a second field meaning the same thing is how a caller ends up
      // rendering one of them and silently dropping the other.
      nextStep: layout
        ? 'If the remedies are in a column to the right of the codes, photograph that column too, or read it to me.'
        : 'Look for the page headed "fault codes", "error codes" or "troubleshooting".',
      coverage: graph.coverage,
      orphanCodes: graph.orphanCodes,
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

// `invoke` is exported so read_symptoms.js can use the same Bedrock path, the same budget
// check and the same failure handling rather than growing a second one beside it.
module.exports = { name, description, read_manual, invoke, PROMPT, MODEL_ID };
