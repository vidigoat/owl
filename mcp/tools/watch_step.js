/**
 * tool: watch_step  —  look at the person doing the step, and say what the camera can see.
 *
 * Until this tool, "the AI borrows your hands" was a figure of speech: the assistant read out a
 * step and waited for somebody to say "done". Now it watches. Two frames — the moment the step
 * began, and now — and the manual's own words for the step, and one of six answers:
 *
 *   done         the change the step asks for is visible (the filter is out; the cover is off)
 *   not-yet      the right part, not finished
 *   wrong-part   the hands are on something else — the inlet hose, not the drain hose
 *   cant-see     too dark, blurred, or out of frame: it says so instead of guessing
 *   danger       something in frame is a hazard: a lit display with a panel off, water on wiring
 *   unavailable  no answer from the model in time, or no model on this host — the repair carries
 *                on by voice, exactly as it did before this tool existed
 *
 * ── What it is careful about, in order ─────────────────────────────────────
 *
 * 1. It never waves a person on with a shaky read. "done" needs the model to say what it saw and
 *    to be at least 70% sure; anything less is reported as `cant-see`, which costs a second
 *    question and never a mistake. The absence of evidence is not treated as evidence of success.
 *
 * 2. Mains work is never signed off by a camera. A step the manual's own wording marks as mains
 *    (faultgraph's isMains) cannot come back `done` until the person has said the power is off at
 *    the wall — a picture of a socket does not show whether it is live.
 *
 * 3. Danger is asymmetric. A false "stop" costs a few seconds; a missed one can cost a hand. So a
 *    hazard is passed through at 40% confidence, where "done" needs 70%.
 *
 * 4. The model's words never become instructions. What the person hears is composed here, from the
 *    verdict and a short description of what was seen — never free text from the model, which could
 *    otherwise invent a procedure the manual does not contain. The step to follow is always the
 *    manual's sentence.
 *
 * 5. Nothing is kept. Frames arrive, are sent to Bedrock, and are dropped; there is no store.
 *
 * 6. When nothing was looked at — no credentials, the ceiling reached, a timeout — the answer is
 *    `unavailable`, which no rule can turn into `done`. There is no canned answer at all.
 */

const { isMains } = require('../../manual/faultgraph');
const { converse } = require('../../agent/bedrock');
const { credentials } = require('../../agent/sigv4');
const { deploymentLedger } = require('../shared-budget');

/*
 * Bedrock over signed HTTPS (agent/bedrock.js), not the AWS CLI that `see` uses: a serverless host
 * has no CLI, and watching is the one thing a judge on the hosted URL should be able to try. The
 * same Converse call the agent makes — two images and a prompt instead of a conversation — metered
 * by the same ledger rule: a shared DynamoDB ledger on a deployment, and on a deployment without
 * one, no look at all.
 */
/*
 * Nova 2 Lite, chosen by measurement (scripts/watch-probe.js, docs/watch-probe.json). With the rules
 * in this file applied, on the six probes: Nova Lite 3 unsafe of 6 — it called a manual's drawing
 * and an app screenshot "appliance" and said "done" — Nova Pro 2 of 6, Nova 2 Lite 0 of 6 in four
 * runs out of four. It is the slower (about 4 s a look) and dearer (about $0.0004) of the two Lites;
 * a watcher that is fast and wrong about "done" is worse than none.
 */
const WATCH_MODEL = process.env.HANDS_WATCH_MODEL || 'us.amazon.nova-2-lite-v1:0';

async function viaConverse({ images, prompt: text, maxTokens, timeoutMs }, { creds = credentials(), env = process.env, fetchImpl = globalThis.fetch, budget: given } = {}) {
  if (!creds) {
    const e = new Error('Vision is not set up on this host: there are no AWS credentials for Bedrock here.');
    e.code = 'NO_CREDENTIALS';
    throw e;
  }
  const budget = given || deploymentLedger(creds, env);
  if (budget === null) {
    const e = new Error('This deployment has AWS credentials but no shared spend ledger, so it will not look.');
    e.code = 'NO_LEDGER';
    throw e;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || TIMEOUT_MS);
  try {
    const r = await converse(
      {
        messages: [{ role: 'user', content: [...images.map((i) => ({ image: { format: i.format, source: { bytes: i.base64 } } })), { text }] }],
        maxTokens,
        model: WATCH_MODEL,
        temperature: 0,
      },
      { creds, ...(budget ? { budget } : {}), fetchImpl: (url, opts) => fetchImpl(url, { ...opts, signal: ctrl.signal }) }
    );
    return JSON.stringify({ output: { message: r.message }, cost: r.cost, model: r.model });
  } catch (e) {
    if (e.name === 'AbortError') {
      const t = new Error(`Bedrock took longer than ${Math.round((timeoutMs || TIMEOUT_MS) / 1000)} s`);
      t.code = 'TIMEOUT';
      throw t;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Why it could not look, in words for the page — never an internal. */
function whyUnavailable(e) {
  if (e.code === 'NO_CREDENTIALS' || e.code === 'NO_LEDGER' || e.code === 'TIMEOUT') return e.message;
  if (e.code === 'BUDGET' || /Budget stop/.test(e.message)) return 'The spending ceiling for vision is reached on this host.';
  if (e.status) return `Bedrock refused the request (HTTP ${e.status}).`;
  return 'Bedrock could not be reached.';
}

/*
 * A step that is ABOUT the power — "disconnect the appliance from the power supply", "switch off at
 * the wall" — is held back the same way. isMains is about causes behind mains voltage; this is
 * about the one fact a camera can never establish, which is whether a socket is live.
 */
const POWER_STEP = /\b(power supply|at the wall|unplug|disconnect|switch(?:ed)? (?:it |the \w+ )?off|isolat\w*|fuse|breaker|socket|mains)\b/i;

const VERDICTS = new Set(['done', 'not-yet', 'wrong-part', 'cant-see', 'danger']);
const DONE_AT = 0.7;
const DANGER_AT = 0.4;
const TIMEOUT_MS = Number(process.env.HANDS_WATCH_TIMEOUT_MS) || 8000;
/** 5 MB of base64 per frame: a phone frame downscaled for watching is a few hundred kB. */
const MAX_FRAME = 5 * 1024 * 1024;

function prompt(step) {
  const notes = (step.notes || []).filter(Boolean).map((n) => `  - ${n}`).join('\n');
  return `You are watching someone repair a home appliance, to tell them whether a step is done.

The step, in the manufacturer's words:
  "${String(step.text).slice(0, 400)}"
${notes ? `The manual's notes on it:\n${notes}\n` : ''}
The FIRST image was taken when they started this step. The SECOND is now.

Return ONLY minified JSON, no prose, in exactly this shape:
{"scene":"appliance|screen|paper|other","verdict":"done|not-yet|wrong-part|cant-see|danger","seen":"<what changed, 12 words max>","part":"<the part their hands are on, 6 words max, or null>","hazard":"<the hazard, 12 words max, or null>","confidence":<0..1>}

First, "scene": what the SECOND image physically shows. "appliance" only if it is a photograph of a
real machine or its parts. "screen" if it shows a phone, tablet, computer or TV screen, or an app.
"paper" if it shows a printed page, a manual, a drawing or a diagram. "other" for anything else.

Rules:
- Words, drawings and diagrams are never evidence that a step was done. If the image shows text or a
  picture ABOUT the step, that is "screen" or "paper", not the step being done.
- "done" only if the SECOND image shows the result the step asks for, and it differs from the first.
  If you cannot see the result, it is not done.
- "wrong-part" if their hands are clearly on a different part from the one the step names.
- "cant-see" if the relevant part is dark, blurred, blocked or out of frame. Prefer this to guessing.
- "danger" if you see a hazard: a lit display or running machine while a panel is open or hands are
  inside, water on or near wiring, exposed wires, a hand near a heating element.
- Describe only what is in the images. Do not give instructions. Do not name model numbers.`;
}

/*
 * What was seen is read aloud, so it must stay a description. Twelve words is room enough for an
 * instruction — "filter still in. Now unscrew the four torx screws on the base" — and the first
 * version of this tool would have said exactly that into somebody's ear. So only the first
 * sentence is kept, and a description that reads like an instruction is dropped altogether: the
 * person then hears the generic line and the manual's step, and nothing the model made up.
 */
const IMPERATIVE = /^(now |then |next |first |please )?(unscrew|screw|remove|pull|push|turn|twist|lift|open|close|replace|clean|check|disconnect|unplug|plug|tighten|loosen|insert|take|put|press|hold|cut|drain|tilt|switch|reconnect|refit|fit|detach|attach|slide|rotate|use|try|make sure|be sure)\b|\b(you should|you need|you must|you can|make sure|be sure|now (?:unscrew|remove|pull|turn|take|lift|open)|then (?:unscrew|remove|pull|turn|take|lift|open))\b/i;
function describeOnly(s) {
  if (!s) return null;
  const first = s.split(/(?<=[.!?;])\s+/)[0].replace(/[.!?;:]+$/, '').trim();
  if (!first || IMPERATIVE.test(first)) return null;
  return first;
}

/** The model's answer, strictly — anything outside the shape is a failed read, not a guess. */
function parseWatch(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const verdict = String(j.verdict || '').toLowerCase().trim();
  if (!VERDICTS.has(verdict)) return null;
  const words = (v, n) => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    if (!s || /^(null|none|n\/a|unknown)$/i.test(s)) return null;
    // Short by construction: this is read aloud, and a paragraph from a model is where
    // instructions creep in.
    return s.split(' ').slice(0, n).join(' ').replace(/[.;:]+$/, '').slice(0, 120);
  };
  const confidence = Number(j.confidence);
  const scene = ['appliance', 'screen', 'paper', 'other'].includes(String(j.scene || '').toLowerCase().trim()) ? String(j.scene).toLowerCase().trim() : null;
  return {
    scene,
    verdict,
    seen: describeOnly(words(j.seen, 12)),
    part: describeOnly(words(j.part, 6)),
    hazard: describeOnly(words(j.hazard, 12)),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  };
}

/**
 * From what the model saw to what the person hears, with the rules above applied. Pure, so every
 * rule is tested without a camera or an AWS account.
 */
function decide(read, step, { powerConfirmed = false } = {}) {
  const mains = Boolean(step.mains) || isMains(String(step.text || '')) || POWER_STEP.test(String(step.text || ''));
  const out = { scene: read.scene ?? null, verdict: read.verdict, seen: read.seen, part: read.part, hazard: read.hazard, confidence: read.confidence, mains };

  if (read.verdict === 'danger') {
    if (read.confidence >= DANGER_AT) return { ...out, say: `Stop. ${sentence(read.hazard) || 'Something in view looks unsafe'} — take your hands out until it's safe.` };
    // A faint hazard is still worth a question, never silence.
    return { ...out, verdict: 'cant-see', downgradedFrom: 'danger', say: 'Hold on — I can\'t tell if that\'s safe. Is the machine off?' };
  }
  if (read.verdict === 'done') {
    /*
     * Only a real machine can be done. Measured, not imagined: shown two of this app's own screens
     * (which carry the step's words), Nova Lite said "filter removed from machine" and Nova 2 Lite
     * "door open, bottom rack pulled out" — both reading the text as if it were the repair. A
     * camera pointed at the manual, or at this screen, is not a repair.
     */
    if (read.scene !== 'appliance') {
      return { ...out, verdict: 'cant-see', downgradedFrom: 'done', notAppliance: read.scene, say: read.scene === 'screen' || read.scene === 'paper' ? 'That looks like a screen or a page, not the machine. Point the camera at the machine.' : 'I can\'t see the machine. Point the camera at it.' };
    }
    if (!read.seen || read.confidence < DONE_AT) {
      return { ...out, verdict: 'cant-see', downgradedFrom: 'done', say: 'I can\'t quite see it. Hold it up to the camera, or tell me when it\'s done.' };
    }
    if (mains && !powerConfirmed) {
      return { ...out, verdict: 'not-yet', heldBack: 'mains', say: 'That looks right — but a camera can\'t tell whether the power is off. Tell me it\'s off at the wall before we go on.' };
    }
    return { ...out, say: `That's it — ${read.seen}.` };
  }
  if (read.verdict === 'wrong-part') {
    return { ...out, say: `Wait — that looks like ${read.part || 'a different part'}. This step is: ${step.text}` };
  }
  if (read.verdict === 'not-yet') return { ...out, say: read.seen ? `Not yet — ${read.seen}.` : 'Not yet. Take your time.' };
  return { ...out, say: 'I can\'t see it clearly. Bring it a little closer to the camera, or into the light.' };
}

/** Read aloud after "Stop." — so it starts like a sentence. */
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function unavailableAnswer(reason, extra = {}) {
  return {
    ok: false,
    verdict: 'unavailable',
    reason,
    say: 'I can\'t see right now — tell me when it\'s done.',
    ...extra,
  };
}

const frame = (f) => {
  const m = /^data:image\/([a-z+]+);base64,(.*)$/is.exec(String(f || ''));
  const raw = (m ? m[2] : String(f || '')).replace(/\s+/g, '');
  const format = m?.[1] === 'png' ? 'png' : m?.[1] === 'webp' ? 'webp' : 'jpeg';
  return { base64: raw, format };
};

/**
 * Watch one step. Always resolves: a failure to see is an answer ("unavailable"), never a crash,
 * because the person on the floor does not care why the camera is not helping.
 */
/*
 * Below this much change between the two thumbnails (mean grey difference, 0–255, measured by the
 * page), nothing visible happened, and "done" is not an answer a model is allowed to give.
 */
const NO_CHANGE = 2;

async function watchStep({ step, before, now, powerConfirmed = false, sceneChange = null, invoke = viaConverse } = {}) {
  if (!step || typeof step.text !== 'string' || !step.text.trim()) return unavailableAnswer('No step to watch: pass the step the person is on, in the manual\'s words.');
  const a = frame(before);
  const b = frame(now);
  for (const f of [a, b]) {
    if (!f.base64) return unavailableAnswer('Two frames are needed: the start of the step, and now.');
    if (f.base64.length > MAX_FRAME) return unavailableAnswer('A frame was too large to send (over 5 MB).');
    if (!/^[A-Za-z0-9+/=]+$/.test(f.base64)) return unavailableAnswer('A frame did not decode as an image.');
  }
  /*
   * Nothing changed, so nothing is done — decided here, before any model is asked.
   *
   * Measured, not assumed: given the same manual illustration twice and the step "remove the
   * filter system", Nova 2 Lite answered "done", 100% sure. Nova Lite did not. A rule that depends
   * on which model is behind it is not a rule, so identical frames are answered without a call,
   * and a page that measured no change keeps any model from saying otherwise.
   */
  if (a.base64 === b.base64) {
    return { ok: true, verdict: 'not-yet', unchanged: true, ms: 0, costUsd: 0, say: 'Nothing has changed yet. Take your time.', mains: false };
  }
  // Not measured is not "no change": Number(null) is 0, and read that way every look from a client
  // that does not measure would have been refused.
  const measured = typeof sceneChange === 'number' && Number.isFinite(sceneChange);
  const still = measured && sceneChange < NO_CHANGE;
  const started = Date.now();
  let raw;
  try {
    raw = await invoke({ images: [a, b], prompt: prompt(step), maxTokens: 160, timeoutMs: TIMEOUT_MS, tool: 'watch_step' });
  } catch (e) {
    const reason = whyUnavailable(e);
    return unavailableAnswer(reason, { ms: Date.now() - started });
  }
  let text = '';
  let spent = null;
  try {
    const env = JSON.parse(raw);
    text = env?.output?.message?.content?.map((c) => c.text).filter(Boolean).join(' ') ?? '';
    spent = { costUsd: env.cost ?? null, model: env.model ?? null };
  } catch { /* falls through to the unreadable answer below */ }
  const read = parseWatch(text);
  if (!read) return unavailableAnswer('The model did not answer in a shape that can be trusted.', { ms: Date.now() - started });
  // What it cost and which model looked travel with every answer — "a watched repair costs under a
  // cent" is a number read off real calls, not an estimate.
  const decided = decide(read, step, { powerConfirmed });
  if (still && decided.verdict === 'done') {
    return { ok: true, ms: Date.now() - started, ...(spent || {}), ...decided, verdict: 'not-yet', downgradedFrom: 'done', unchanged: true, say: 'It doesn\'t look like anything has moved yet. Tell me when it\'s done.' };
  }
  return { ok: true, ms: Date.now() - started, ...(spent || {}), ...decided };
}

module.exports = { name: 'watch_step', NO_CHANGE, watchStep, viaConverse, parseWatch, decide, prompt, POWER_STEP, WATCH_MODEL, DONE_AT, DANGER_AT, TIMEOUT_MS };
