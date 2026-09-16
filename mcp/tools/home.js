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

function read() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return { appliances: {}, receipts: [] };
  }
}

function write(state) {
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false; // a memory that cannot be written is not an error worth crashing a repair over
  }
}

/** Record an appliance the household owns. */
function remember({ model, brand, kind, nickname }) {
  const state = read();
  state.appliances[model] = {
    model,
    brand: brand || state.appliances[model]?.brand,
    kind: kind || state.appliances[model]?.kind,
    nickname: nickname || state.appliances[model]?.nickname,
    firstSeen: state.appliances[model]?.firstSeen || new Date().toISOString(),
  };
  write(state);
  return { remembered: true, model };
}

/**
 * Record what actually happened: the fault, what it turned out to be, what was done, what it cost.
 * This is the thing worth keeping — a list of appliances is a spreadsheet; a history of repairs is
 * what lets it say "we did this last March and it came back".
 */
function receipt({ model, code, cause, action, part, cost, confirmed }) {
  const state = read();
  const entry = {
    model,
    code,
    cause,
    action,
    part: part || null,
    cost: cost ?? null,
    confirmed: Boolean(confirmed),
    at: new Date().toISOString(),
  };
  state.receipts.push(entry);
  write(state);

  // Has this exact fault happened before on this machine? That changes the advice next time.
  const repeats = state.receipts.filter((r) => r.model === model && r.code === code).length;
  return {
    saved: true,
    entry,
    repeat: repeats > 1,
    note: repeats > 1 ? `This is the ${ordinal(repeats)} time ${code} has happened on this machine.` : null,
  };
}

/** What the house owns, and what it has been through. */
function history({ model }) {
  const state = read();
  return {
    appliance: state.appliances[model] || null,
    receipts: state.receipts.filter((r) => r.model === model),
  };
}

/** Consumables now due. This is what lets it speak first. */
function due({ today = new Date() } = {}) {
  const state = read();
  const out = [];

  state.receipts.forEach((r) => {
    const window = Object.entries(DUE_AFTER).find(([name]) => (r.part || '').toLowerCase().includes(name));
    if (!window) return;
    const days = Math.floor((today - new Date(r.at)) / 86400000);
    if (days >= window[1]) {
      out.push({ model: r.model, part: r.part, daysSince: days, dueAfter: window[1] });
    }
  });

  return { due: out, count: out.length };
}

module.exports = { name: 'home', remember, receipt, history, due, ordinal, STORE, DUE_AFTER };
