#!/usr/bin/env node
/**
 * The page's "measured, not claimed" section, computed from the reports the measurements wrote.
 *
 *   node scripts/evidence.js        # docs/*.json → public/evidence.json
 *
 * Each figure is derived here from a committed report, with the report it came from and the date it
 * was measured. scripts/evidence.test.js fails if public/evidence.json ever disagrees with what this
 * computes, so the page cannot keep quoting a measurement that has since been re-run.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', f), 'utf8'));
const n = (x) => x.toLocaleString('en-US');
const day = (iso) => String(iso).slice(0, 10);

function evidence() {
  const agent = read('agent-eval.json');
  const buy = read('no-bad-buy.json');
  const lat = read('latency.json');
  const pdf = read('pdf-compare.json');
  const cov = read('coverage.json');
  const proc = read('procedures.json');
  return {
    items: [
      {
        figure: `${agent.passed} / ${agent.scenarios}`,
        label: 'live agent scenarios passed',
        detail: `Amazon Nova 2 Lite choosing Owl's tools itself, ${n(agent.turns)} turns, ${agent.violations === 0 ? 'no rule broken' : `${agent.violations} rules broken`}.`,
        source: 'docs/agent-eval.json',
        measured: day(agent.measured),
      },
      {
        figure: n(buy.badBuys),
        label: 'parts sold on a guess',
        detail: `Every cause of every machine swept — ${n(buy.causesSwept)} causes on ${n(buy.machines)} machines — checked independently of the gate.`,
        source: 'docs/no-bad-buy.json',
        measured: day(buy.measured),
      },
      {
        figure: `${lat.worstServerP95Ms} ms`,
        label: 'slowest tool, p95, on the server',
        detail: `Each tool the agent uses, called ${lat.calls} times against the deployed MCP server.`,
        source: 'docs/latency.json',
        measured: day(lat.measured),
      },
      {
        figure: `${pdf.worstWordRecall}%`,
        label: 'worst-case word recall of its own PDF reader',
        detail: `Against poppler, over ${n(pdf.pages)} pages of ${pdf.manuals} manuals, with no dependencies.`,
        source: 'docs/pdf-compare.json',
        measured: day(pdf.measured),
      },
      {
        figure: `${cov.total.answers} of ${cov.total.listed}`,
        label: 'Bosch and Siemens appliances answered',
        detail: `Every major-appliance page those makers list, visited; ${cov.total.manuals} manuals read behind them.`,
        source: 'docs/coverage.json',
        measured: day(cov.measured),
      },
      {
        figure: n(proc.steps),
        label: 'repair steps re-found word for word',
        detail: `Manufacturer procedures followed from ${n(proc.references)} page references; anything not on the page is dropped.`,
        source: 'docs/procedures.json',
        measured: day(proc.measured),
      },
    ],
  };
}

module.exports = { evidence };

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'public', 'evidence.json'), `${JSON.stringify(evidence(), null, 2)}\n`);
  console.log('  public/evidence.json written');
}
