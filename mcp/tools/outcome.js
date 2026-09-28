/**
 * What happened when a stranger actually used this on a real machine.
 *
 * The whole project is built to be used by someone who is not us, on an appliance we have never
 * seen. This is the only record that says whether that happened and whether it worked — a repair a
 * real person finished is the evidence a demo can never be. So the kit (public/fix.html) writes one
 * outcome here at the end of a session: what the machine was, which cause was tried, how far they
 * got, and whether it fixed it.
 *
 * Three rules, and they are the reason this is its own tiny module rather than a field on something
 * else:
 *
 *   1. NO identity, ever. Not a name, not an email, not an IP, not a photo. A repair outcome is a
 *      fact about an appliance and a fault, and nothing here needs to know who was holding the
 *      phone. Anything that looks like contact detail is refused at the door.
 *   2. NOTHING without consent. The kit shows what will be recorded and records only after the
 *      person agrees. A call without `consent: true` is refused, not quietly kept.
 *   3. Durable, or say it was not. Where there is somewhere to write, the outcome is appended and
 *      kept. Where there is not — a read-only host with no shared store — it is not pretended to be
 *      saved: the record is emitted to the server log and the caller is told `kept: false`. The
 *      same honesty the household store keeps about "saved".
 */

const fs = require('node:fs');
const path = require('node:path');

const STORE = process.env.OUTCOME_STORE || path.join(__dirname, '..', '..', 'data', 'outcomes.jsonl');

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,39}$/;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9 :._-]{0,29}$/;
const INVISIBLE = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;
// Anything that smells of a person, refused so it can never be stored: an email, a phone number, an
// @handle, a URL. This is a repair outcome, not a contact form.
const CONTACTISH = /@|https?:\/\/|\b\d{3}[-.\s]?\d{3,}\b|\+\d[\d\s-]{6,}/;
const OUTCOMES = new Set(['fixed', 'not-fixed', 'gave-up', 'escalated']);

const clean = (v, max = 80) => {
  if (v == null) return undefined;
  // A value whose own toString throws (a hostile object) must not take the whole call down.
  let s;
  try { s = String(v); } catch { return undefined; }
  s = s.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};

/**
 * Record one repair outcome. Returns { recorded, kept } — recorded is whether it was accepted,
 * kept is whether it will outlast this process.
 */
function record(input, { store = STORE, log = console } = {}) {
  const { model, code, causeId, outcome, stepsCompleted, ofSteps, consent } = (input && typeof input === 'object') ? input : {};
  if (consent !== true) return { recorded: false, reason: 'Not recorded: this is only kept when the person has agreed to it.' };

  const m = clean(model, 60);
  if (!m || !MODEL_RE.test(m)) return { recorded: false, reason: 'Not recorded: a model number is needed, and this did not look like one.' };
  if (['constructor', 'prototype', '__proto__'].includes(m)) return { recorded: false, reason: 'Not recorded: that is not a model number.' };

  let c = clean(code, 30);
  if (c && /^[-–—\s]*$|^(none|n\/a)$/i.test(c)) c = undefined;
  if (c && !CODE_RE.test(c)) return { recorded: false, reason: `Not recorded: "${c}" does not look like a fault code.` };

  if (!OUTCOMES.has(outcome)) return { recorded: false, reason: `Not recorded: the outcome must be one of ${[...OUTCOMES].join(', ')}.` };

  const cause = clean(causeId, 60);
  // Belt and braces: no field a person could have typed their identity into is stored, whatever the
  // client sent. model, code, causeId are validated shapes above; the rest are numbers and an enum.
  for (const v of [m, c, cause]) if (v && CONTACTISH.test(v)) return { recorded: false, reason: 'Not recorded: that looked like contact detail, and this never stores who you are.' };

  const done = Number.isInteger(stepsCompleted) && stepsCompleted >= 0 && stepsCompleted <= 200 ? stepsCompleted : null;
  const total = Number.isInteger(ofSteps) && ofSteps > 0 && ofSteps <= 200 ? ofSteps : null;

  const entry = {
    at: new Date().toISOString(),
    model: m,
    code: c || null,
    causeId: cause || null,
    outcome,
    stepsCompleted: done,
    ofSteps: total,
  };

  try {
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.appendFileSync(store, `${JSON.stringify(entry)}\n`);
    return { recorded: true, kept: true, entry };
  } catch {
    // Nowhere durable to write (a read-only host, no shared store). Do not pretend it was saved —
    // put it where the operator can still see it, and tell the caller it was not kept.
    try { log.log(`[outcome:not-kept] ${JSON.stringify(entry)}`); } catch { /* logging must never throw */ }
    return { recorded: true, kept: false, entry, note: 'Recorded for this session only — this host has nowhere durable to keep it.' };
  }
}

/** The outcomes so far: how many strangers finished a repair, and on what. For the proof, not for show. */
function summary({ store = STORE } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(store, 'utf8').trim().split('\n').filter(Boolean); } catch { return { total: 0, byOutcome: {}, models: 0 }; }
  const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byOutcome = rows.reduce((t, r) => ((t[r.outcome] = (t[r.outcome] || 0) + 1), t), {});
  return { total: rows.length, byOutcome, models: new Set(rows.map((r) => r.model)).size, fixed: byOutcome.fixed || 0 };
}

module.exports = { name: 'outcome', record, summary, STORE, OUTCOMES };
