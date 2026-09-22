#!/usr/bin/env node
/**
 * Build the household the hosted demo shows.
 *
 *   node scripts/make-home-demo.js
 *
 * ── Why this is a script and not a JSON file ────────────────────────────────
 *
 * `data/home.json` is somebody's home — which machines they own, what has broken, what they paid.
 * It is gitignored and kept out of every deploy, so a hosted page has nothing to show, and a page
 * with nothing on it cannot demonstrate the one thing this feature is for: that the second
 * conversation is shorter than the first.
 *
 * So the demo household is written HERE, by driving the real tool. Every field in the file is
 * something `home.js` produced from an event — not a hand-typed object shaped to look like its
 * output, which is how a demo starts claiming things the code cannot actually do. If `receipt()`
 * changes shape, this file changes with it or this script stops running.
 *
 * The machines are real models out of `data/admitted/`, and the faults are real faults out of
 * their own manuals. What is invented is only that one household owns all three of them.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'public', 'home-demo.json');

// A temporary store, so building the demo cannot touch whatever is in data/home.json.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'home-demo-'));
process.env.HOME_STORE = path.join(scratch, 'home.json');

const home = require('../mcp/tools/home');

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

/*
 * Three machines and eight months.
 *
 * The shape matters more than the contents: one machine with a fault that came back, one with a
 * filter that is now overdue, and one that has never gone wrong — because a household where
 * everything is broken is not a household, and the quiet machine is what makes the other two
 * readable.
 */
const MACHINES = [
  { model: 'SHE3AR75UC', brand: 'Bosch', kind: 'Dishwasher', nickname: 'the dishwasher' },
  { model: 'B24CB50ESS', brand: 'Bosch', kind: 'Refrigerator', nickname: 'the fridge' },
  { model: 'BI710C1B1B', brand: 'Siemens', kind: 'Oven', nickname: 'the warming drawer' },
];

const EVENTS = [
  // The dishwasher, three times in five months. The dates are the finding; what they MEAN is not
  // something three timestamps can tell anybody, and home.js deliberately does not say.
  {
    model: 'SHE3AR75UC',
    code: 'E24',
    cause: 'Blocked filter or drain path',
    action: 'Cleared the filter and the well underneath it',
    part: null,
    cost: 0,
    at: ago(214),
  },
  {
    model: 'SHE3AR75UC',
    code: 'E24',
    cause: 'Blocked filter or drain path',
    action: 'Cleared the filter again',
    part: null,
    cost: 0,
    at: ago(96),
  },
  {
    model: 'SHE3AR75UC',
    code: 'E24',
    cause: 'Blocked filter or drain path',
    action: 'Cleared the filter; the drain hose was also kinked behind the machine',
    part: null,
    cost: 0,
    at: ago(31),
  },
  // The fridge filter, changed two hundred and ten days ago. DUE_AFTER says a fridge filter is a
  // 180-day part, so the page can say it is overdue without anybody deciding that it is.
  {
    model: 'B24CB50ESS',
    code: null,
    cause: 'Scheduled replacement',
    action: 'Replaced the fridge filter',
    part: 'fridge filter',
    cost: 42.5,
    at: ago(210),
  },
];

for (const m of MACHINES) home.remember(m);
for (const e of EVENTS) home.receipt(e);

const state = JSON.parse(fs.readFileSync(process.env.HOME_STORE, 'utf8'));

fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      // Said in the file itself, so nothing downstream has to remember to label it.
      demo: true,
      describes: 'a household made up for the hosted demo — the machines and the faults are real',
      builtBy: 'scripts/make-home-demo.js',
      builtAt: new Date().toISOString(),
      ...state,
    },
    null,
    2
  )}\n`
);

// Counted BEFORE the scratch store is removed — the first version reported it afterwards and
// cheerfully printed "0 due, 0 recurring" about a household it had just built with both.
const overdue = home.due({}).count;
const repeats = home.recurring({}).length;

fs.rmSync(scratch, { recursive: true, force: true });

console.log(`\n  ${MACHINES.length} machines, ${EVENTS.length} receipts → ${path.relative(process.cwd(), OUT)}`);
console.log(`  ${overdue} consumable${overdue === 1 ? '' : 's'} overdue, ${repeats} fault${repeats === 1 ? '' : 's'} that came back\n`);
