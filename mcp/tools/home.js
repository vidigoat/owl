/**
 * tool: home  —  what the household remembers.
 *
 * The repair receipt is what makes the second conversation short. It is also what lets the
 * assistant speak first — "your fridge filter is six months old" — instead of waiting for
 * something to break, which is the difference between a tool you open and one that lives with you.
 *
 * Backed by a JSON file so a restart does not wipe the house's history. This is where AgentCore
 * Memory slots in when credentials land: same four functions, same shapes, different store.
 */

const fs = require('node:fs');
const path = require('node:path');

const STORE = process.env.HOME_STORE || path.join(__dirname, '..', '..', 'data', 'home.json');

/** 1st, 2nd, 3rd, 4th — this line gets read aloud, so "the 2th time" will not do. */
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/** Consumables that come due on a schedule, in days. */
const DUE_AFTER = { 'water filter': 180, 'fridge filter': 180, 'lint filter': 30, 'dishwasher filter': 90 };

/*
 * Where there is nowhere durable to write — the hosted server's bundle is read-only — the house is
 * kept in this process for the conversation, and every answer says so. It used to answer
 * `saved: true` for a write that had failed, and the agent then told the person their repair was
 * recorded; the next question about the machine's history came back empty. Found by asking the
 * deployed server to remember a repair, 24 September.
 */
let sessionState = null;
// A shared store (mcp/household-store.js), attached by the MCP server around a household tool on
// a deployment that has one. While attached, a write is held here and saved by persist().
let shared = null;
let dirty = false;

function read() {
  if (sessionState) return JSON.parse(JSON.stringify(sessionState));
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return { appliances: {}, receipts: [] };
  }
}

/*
 * The store gained a third list after the first two shipped. A file written before it exists has no
 * `open`, and every reader that touches it would otherwise have to remember to default it. Doing it
 * once, here, means the rest of the file can treat `state.open` as always an array.
 */
function withOpen(state) {
  if (!Array.isArray(state.open)) state.open = [];
  return state;
}

/** 'durable' when it will outlast this conversation, 'session' when only this process holds it. */
function write(state) {
  if (shared) {
    sessionState = JSON.parse(JSON.stringify(state));
    dirty = true;
    return 'durable'; // provisionally — persist() confirms it, or the server says otherwise
  }
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(state, null, 2));
    sessionState = null;
    return 'durable';
  } catch {
    // Not worth crashing a repair over — but not worth pretending about either.
    sessionState = JSON.parse(JSON.stringify(state));
    return 'session';
  }
}

/** Load the house from a shared store before a household tool runs. False: carry on with what this process holds. */
async function hydrate(store) {
  try {
    sessionState = await store.load();
    shared = store;
    dirty = false;
    return true;
  } catch {
    shared = null;
    return false;
  }
}

/** Save what a tool wrote. False means it is not kept — held in this process's memory at most. */
async function persist() {
  const store = shared;
  shared = null;
  if (!store || !dirty) return true;
  dirty = false;
  try {
    sessionState = await store.save(sessionState);
    return true;
  } catch {
    return false;
  }
}

const SESSION_ONLY = 'Not kept: this host has nowhere durable to keep a household\'s history. It is held in this server\'s memory only, so it may already be gone by the next question.';

/** Record an appliance the household owns. */
/*
 * What may be written into somebody's house.
 *
 * This file persists, and what it persists is read back to the person on their own screen. After a
 * night of fuzzing, the household here held two hundred "repairs" — every one of them junk: model
 * numbers that were `'; DROP TABLE x --`, `{{7*7}}`, a right-to-left override character, and one that
 * was ten thousand commas. Not one real receipt. Types had been coerced the night before, which
 * stopped the crashes and let every string through.
 *
 * So a model number has to look like one — letters, digits and the few separators manufacturers
 * use, at most forty characters — and free text is trimmed, stripped of control and bidirectional
 * formatting characters, and bounded. Anything else is refused by name, never quietly stored.
 */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,39}$/;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9 :._-]{0,19}$/;
// Control characters, and the Unicode bidi/format controls that can make a line read backwards.
const INVISIBLE = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

const clean = (v, max = 300) => {
  if (v == null) return undefined;
  const s = String(v).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};

function refuseModel(model) {
  if (typeof model !== 'string') return 'a model number is text, and this was not';
  const m = clean(model, 80);
  if (!m) return 'a model number is needed';
  if (!MODEL_RE.test(m)) return `"${m.slice(0, 40)}" does not look like a model number`;
  // A plain object's built-in names are never a machine: "constructor" passed the pattern above,
  // and reading it back before it was ever remembered returned JavaScript's Object function.
  if (['constructor', 'prototype', '__proto__', 'hasOwnProperty', 'toString', 'valueOf'].includes(m)) return `"${m}" is not a model number`;
  return null;
}

/** The household's own record for a model, never something inherited from Object. */
const ownAppliance = (state, model) => (Object.prototype.hasOwnProperty.call(state.appliances, model) ? state.appliances[model] : undefined);

function remember({ model, brand, kind, nickname } = {}) {
  const bad = refuseModel(model);
  if (bad) return { remembered: false, reason: `Not remembered: ${bad}.` };
  model = clean(model, 40);
  brand = clean(brand, 40);
  kind = clean(kind, 40);
  nickname = clean(nickname, 60);
  const state = read();
  state.appliances[model] = {
    model,
    brand: brand || ownAppliance(state, model)?.brand,
    kind: kind || ownAppliance(state, model)?.kind,
    nickname: nickname || ownAppliance(state, model)?.nickname,
    firstSeen: ownAppliance(state, model)?.firstSeen || new Date().toISOString(),
  };
  const kept = write(state);
  return kept === 'durable' ? { remembered: true, model } : { remembered: true, model, kept, keptFor: SESSION_ONLY };
}

/**
 * Record what actually happened: the fault, what it turned out to be, what was done, what it cost.
 * This is the thing worth keeping — a list of appliances is a spreadsheet; a history of repairs is
 * what lets it say "we did this last March and it came back".
 */
function receipt({ model, code, cause, action, part, cost, confirmed, at } = {}) {
  const state = read();

  /*
   * What goes in has to be the shape of what comes out.
   *
   * A receipt is written by an HTTP route, which is fed by a client, which may send anything. One
   * POST with a non-string `part` was enough to make `due()` throw for every subsequent call —
   * `(r.part || '').toLowerCase is not a function` — so a single malformed request permanently
   * broke the household view for a household that had done nothing wrong. This file persists, and
   * anything that persists has to refuse bad input at the door rather than at every reader.
   */
  const bad = refuseModel(model);
  if (bad) return { saved: false, reason: `Not saved: ${bad}.` };
  model = clean(model, 40);
  code = clean(code, 20);
  // Maintenance has no fault code, and people write that as a dash. That is "no code", not a bad one.
  if (code && /^[-–—\s]*$|^(none|n\/a)$/i.test(code)) code = undefined;
  if (code && !CODE_RE.test(code)) return { saved: false, reason: `Not saved: "${code}" does not look like a fault code.` };
  cause = clean(cause);
  action = clean(action);
  part = clean(part, 120);
  cost = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost < 100000 ? cost : undefined;
  if (!action && !cause) return { saved: false, reason: 'Not saved: a repair needs at least what was wrong or what was done.' };

  /*
   * When it happened, not when it was typed in.
   *
   * This used to stamp `new Date()` unconditionally, which meant a repair could only ever be
   * recorded at the moment it was recorded. That is wrong twice over. Somebody telling the
   * assistant "the same thing happened back in March" had March silently rewritten to today; and
   * both of the things this file computes — whether a consumable is overdue, and whether a fault
   * has come back — are arithmetic on these dates and nothing else. A store where every receipt
   * says "now" cannot answer either question, and answers them confidently anyway.
   *
   * An unparseable date falls back to now rather than being written as `Invalid Date`, which
   * poisons every comparison downstream with NaN and reports nothing as ever being due.
   */
  const when = at ? new Date(at) : new Date();
  const stamped = Number.isNaN(when.getTime()) ? new Date() : when;

  const entry = {
    model,
    code,
    cause,
    action,
    part: part || null,
    cost: cost ?? null,
    confirmed: Boolean(confirmed),
    at: stamped.toISOString(),
  };
  state.receipts.push(entry);
  // A finished repair closes the open one it finishes: the receipt is the record of what was done,
  // and leaving the "waiting for a part" note behind would have it offered again after it was done.
  const closed = closeOpen(withOpen(state), model, code);
  const kept = write(state);

  // Has this exact fault happened before on this machine? That changes the advice next time.
  const repeats = state.receipts.filter((r) => r.model === model && r.code === code).length;
  return {
    // Saved means it will be there next time. Anything less is said as not kept.
    saved: kept === 'durable',
    ...(kept === 'durable' ? {} : { kept, keptFor: SESSION_ONLY }),
    entry,
    repeat: repeats > 1,
    ...(closed ? { closedOpenRepair: true } : {}),
    note: repeats > 1 ? `This is the ${ordinal(repeats)} time ${code} has happened on this machine.` : null,
  };
}

/** What the house owns, and what it has been through. */
function history({ model } = {}) {
  const state = read();
  return {
    appliance: ownAppliance(state, model) || null,
    receipts: state.receipts.filter((r) => r.model === model),
  };
}

/*
 * A fault that keeps coming back.
 *
 * The household's own history answers a question no manual can: whether this has happened before.
 * A dishwasher throwing E24 once is a blocked filter. The same machine throwing E24 three times in
 * four months is a different fact about a different problem, and it is the only thing here that can
 * be known without a service call or a price list.
 *
 * Reported as a count and the dates, and nothing more. What it MEANS — that a part is failing, that
 * the machine is near its end, that this is worth a technician — is not derivable from three
 * timestamps, and saying any of it would be the confident guess this project is built to refuse.
 * The dates are the finding. The owner, or whoever they call, draws the conclusion.
 *
 * `within` is a window, not a threshold on the machine's whole life: two identical faults four
 * years apart are two faults, not a pattern.
 */
const RECURRENCE_WINDOW_DAYS = 365;

/*
 * `state` is optional, and it is the reason this is a parameter rather than a read.
 *
 * The hosted demo's household is not the one on disk — it is a file built by
 * scripts/make-home-demo.js and shipped with the site. Recomputing "what is overdue" and "what
 * came back" for it anywhere else would be a second copy of the only arithmetic in this file, and
 * two implementations of one rule eventually disagree about somebody's fridge.
 */
function recurring({ today = new Date(), within = RECURRENCE_WINDOW_DAYS, state = read() } = {}) {
  const seen = new Map();

  for (const r of state.receipts) {
    if (!r.model || !r.code) continue;
    const days = Math.floor((today - new Date(r.at)) / 86400000);
    if (!Number.isFinite(days) || days > within || days < 0) continue;

    const key = `${r.model}\u0000${r.code}`;
    if (!seen.has(key)) seen.set(key, { model: r.model, code: r.code, byDay: new Map() });

    /*
     * One occasion per day, not one per receipt.
     *
     * A single diagnosis writes several receipts — a guided step, a part, a confirmation — and
     * walking the demo twice writes a dozen. Run against the real household store this counted 32
     * occurrences of E24 over five days, every one of them seconds apart, and reported it as a
     * machine failing thirty-two times. It was the same fault, looked at twice.
     *
     * A recurrence has to mean separate OCCASIONS, and a calendar day is the coarsest defensible
     * boundary that a person would also draw. The confirmed flag survives the collapse: if any
     * receipt that day says the repair was confirmed, that day was a confirmed fix.
     */
    const day = String(r.at).slice(0, 10);
    const bucket = seen.get(key).byDay;
    const existing = bucket.get(day);
    if (existing) {
      existing.confirmed = existing.confirmed || Boolean(r.confirmed);
      existing.daysAgo = Math.min(existing.daysAgo, days);
    } else {
      bucket.set(day, { at: r.at, daysAgo: days, confirmed: Boolean(r.confirmed) });
    }
  }

  return [...seen.values()]
    .map((x) => ({ ...x, occurrences: [...x.byDay.values()] }))
    .filter((x) => x.occurrences.length > 1)
    .map((x) => {
      const occ = x.occurrences.sort((a, b) => a.daysAgo - b.daysAgo);
      return {
        model: x.model,
        code: x.code,
        times: occ.length,
        daysSinceFirst: occ[occ.length - 1].daysAgo,
        daysSinceLast: occ[0].daysAgo,
        /*
         * How many of those repairs the owner actually confirmed as fixed. A fault that recurred
         * after three CONFIRMED fixes is a stronger fact than one that recurred after three
         * attempts nobody ever said worked — and conflating them would turn "we never finished the
         * job" into "the machine is failing".
         */
        confirmedFixes: occ.filter((o) => o.confirmed).length,
        occurrences: occ,
      };
    })
    .sort((a, b) => b.times - a.times || a.daysSinceLast - b.daysSinceLast);
}

/**
 * What needs attention in this house. This is what lets it speak first.
 *
 * Two kinds of finding, kept apart because they are different claims. A consumable past its stated
 * interval is a schedule. A fault that keeps returning is a pattern in this household's own
 * history. `count` remains the number of consumables due, so nothing that already reads it starts
 * counting something else.
 */
function due({ today = new Date(), state = read() } = {}) {
  const out = [];

  state.receipts.forEach((r) => {
    // Defensive as well, because a state file written by an older build is not reachable by the
    // guard above — and a reader that throws over one bad row loses every good one with it.
    const part = typeof r?.part === 'string' ? r.part : '';
    const window = Object.entries(DUE_AFTER).find(([name]) => part.toLowerCase().includes(name));
    if (!window) return;
    const days = Math.floor((today - new Date(r.at)) / 86400000);
    if (days >= window[1]) {
      out.push({ model: r.model, part: r.part, daysSince: days, dueAfter: window[1] });
    }
  });

  const repeats = recurring({ today, state });
  // Unfinished repairs whose part was due by now: the house should hear about these first — an
  // ordered part arriving is the moment to speak, not a breakdown. "Ready" is "due by now", never
  // "delivered": the person confirms arrival, resumeRepair's line asks rather than asserts.
  const ready = withOpen(state).open
    .filter((o) => o.expectedBy && new Date(o.expectedBy) <= today)
    .map((o) => ({ ...o, say: sayResume(o, today) }));
  return { due: out, count: out.length, recurring: repeats, resumable: ready, attention: out.length + repeats.length + ready.length };
}

/*
 * ── A repair that is not finished yet ────────────────────────────────────────
 *
 * The receipt above is for a repair that is DONE. This is for one that is not: the commonest reason
 * a repair stops half-way is a part on order, and between ordering it and its arriving there is a
 * gap of days and, on a device, a different conversation entirely. Without somewhere to write "we
 * were on step 3, waiting for the drain pump", the second conversation starts from nothing and the
 * person redoes the diagnosis they already did.
 *
 * So an open repair records where they got to and what they are waiting for. It is keyed on
 * model + code, because the same fault is the same repair — pausing twice updates, it does not
 * fork. It carries no claim the part has ARRIVED: a delivery estimate is not a delivery, and this
 * project does not assert what it cannot see. `expectedBy` (an ISO date, when the caller has one)
 * only ever moves an open repair from "on order" to "due by now — has it arrived?", which is a
 * question, not a statement.
 */
const openKey = (model, code) => `${model}\u0000${code || ''}`;

function pauseRepair({ model, code, causeId, cause, atStep, ofSteps, waitingFor, expectedBy } = {}) {
  const bad = refuseModel(model);
  if (bad) return { paused: false, reason: `Not saved: ${bad}.` };
  model = clean(model, 40);
  code = clean(code, 20);
  if (code && /^[-–—\s]*$|^(none|n\/a)$/i.test(code)) code = undefined;
  if (code && !CODE_RE.test(code)) return { paused: false, reason: `Not saved: "${code}" does not look like a fault code.` };
  causeId = clean(causeId, 60);
  cause = clean(cause);
  waitingFor = clean(waitingFor, 120);
  // A step number that is read back to a person has to be a real one. A step "3 of 2", or a
  // fractional or negative step, is worse than no step — it would send them to a step that is not
  // there. Kept only when it is a whole number that fits inside the total, when a total is given.
  const total = Number.isInteger(ofSteps) && ofSteps > 0 && ofSteps <= 100 ? ofSteps : null;
  let step = Number.isInteger(atStep) && atStep >= 1 && atStep <= 100 ? atStep : null;
  if (step && total && step > total) step = null;
  // A delivery estimate, kept only if it is a real date; a phrase like "tomorrow by 9pm" is not one
  // and is not stored as one. An unparseable date is dropped, never written as Invalid Date.
  let expected = null;
  if (expectedBy != null) {
    const d = new Date(expectedBy);
    if (!Number.isNaN(d.getTime())) expected = d.toISOString();
  }
  if (!waitingFor && step == null) {
    return { paused: false, reason: 'Not saved: a paused repair needs at least a step reached or what it is waiting for.' };
  }

  const state = withOpen(read());
  const key = openKey(model, code);
  const existing = state.open.find((o) => openKey(o.model, o.code) === key);
  const entry = {
    model,
    code: code || null,
    causeId: causeId || existing?.causeId || null,
    cause: cause || existing?.cause || null,
    atStep: step ?? existing?.atStep ?? null,
    ofSteps: total ?? existing?.ofSteps ?? null,
    waitingFor: waitingFor || existing?.waitingFor || null,
    expectedBy: expected || existing?.expectedBy || null,
    startedAt: existing?.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (existing) state.open[state.open.indexOf(existing)] = entry;
  else state.open.push(entry);
  const kept = write(state);
  return {
    paused: kept === 'durable',
    ...(kept === 'durable' ? {} : { kept, keptFor: SESSION_ONLY }),
    open: entry,
    say: sayResume(entry),
  };
}

/** How an open repair is offered back, in one spoken line. Never claims the part is here. */
function sayResume(o, today = new Date()) {
  const where = o.atStep && o.ofSteps ? ` We stopped at step ${o.atStep} of ${o.ofSteps}.`
    : o.atStep ? ` We stopped at step ${o.atStep}.` : '';
  if (!o.waitingFor) return `Your ${o.model} repair is unfinished.${where} Pick it up?`;
  const due = o.expectedBy && new Date(o.expectedBy) <= today;
  const part = due
    ? `The ${o.waitingFor} for your ${o.model} was due by now`
    : `You have a ${o.waitingFor} on order for your ${o.model}`;
  return `${part}.${where} ${due ? 'Has it arrived? Want to finish?' : 'Want to carry on when it comes?'}`;
}

/**
 * The unfinished repairs, most recently touched first — for one machine, or the whole house. `ready`
 * marks the ones whose part was due by now, so the assistant can lead with those without claiming
 * anything has been delivered.
 */
function resumeRepair({ model, today = new Date() } = {}) {
  const state = withOpen(read());
  let open = state.open;
  if (model != null) {
    const m = clean(model, 40);
    open = open.filter((o) => o.model === m);
  }
  const enriched = open
    .map((o) => ({ ...o, ready: Boolean(o.expectedBy && new Date(o.expectedBy) <= today), say: sayResume(o, today) }))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || new Date(b.updatedAt) - new Date(a.updatedAt));
  return { open: enriched, count: enriched.length };
}

/**
 * A repair is finished, so it is no longer open. Called when a receipt is written for the same
 * machine and fault: the record of what was done replaces the note of what was left to do. Returns
 * whether anything was cleared, so a caller can say "that closes the one you had open".
 */
function closeOpen(state, model, code) {
  const key = openKey(model, code);
  const before = state.open.length;
  state.open = state.open.filter((o) => openKey(o.model, o.code) !== key);
  return before - state.open.length;
}

module.exports = { name: 'home', remember, receipt, history, due, recurring, pauseRepair, resumeRepair, sayResume, ordinal, hydrate, persist, SESSION_ONLY, STORE, DUE_AFTER, RECURRENCE_WINDOW_DAYS };
