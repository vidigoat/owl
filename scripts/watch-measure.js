#!/usr/bin/env node
/**
 * What watching cost and how fast it answered, from real looks — local/watch-measure.jsonl, which
 * the local server writes one line per look (timings, cost, verdict; never a frame).
 *
 *   npm run watch:measure
 *
 * The figures the submission quotes about watching come from here or are not quoted.
 */
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'local', 'watch-measure.jsonl');
if (!fs.existsSync(file)) {
  console.log('\n  No looks recorded yet. Run `npm start`, open a repair, press "watch me do it", and do a step.\n');
  process.exit(0);
}
// Per line, not all-or-nothing: the app appends a row each time someone presses "watch me do it",
// and a run killed mid-append leaves a truncated last line. Losing every measurement to one bad
// line would make this report nothing exactly when the app had just crashed.
const rows = fs.readFileSync(file, 'utf8').split('\n').reduce((acc, l) => {
  if (l.trim()) { try { acc.push(JSON.parse(l)); } catch { /* skip a partial line */ } }
  return acc;
}, []);
const looked = rows.filter((r) => r.verdict !== 'unavailable');
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const ms = looked.map((r) => r.ms).filter(Number.isFinite);
const cost = looked.map((r) => r.costUsd).filter(Number.isFinite);
const tally = rows.reduce((t, r) => ((t[r.verdict] = (t[r.verdict] || 0) + 1), t), {});
const out = {
  looks: rows.length,
  answered: looked.length,
  unavailable: rows.length - looked.length,
  msP50: pct(ms, 0.5),
  msP90: pct(ms, 0.9),
  costPerLookUsd: cost.length ? cost.reduce((a, b) => a + b, 0) / cost.length : null,
  totalCostUsd: cost.reduce((a, b) => a + b, 0),
  models: [...new Set(looked.map((r) => r.model).filter(Boolean))],
  verdicts: tally,
  downgradedDone: rows.filter((r) => r.downgradedFrom === 'done').length,
  heldBackForPower: rows.filter((r) => r.heldBack === 'mains').length,
  why: [...new Set(rows.filter((r) => r.reason).map((r) => r.reason))].slice(0, 5),
};
console.log(JSON.stringify(out, null, 2));
