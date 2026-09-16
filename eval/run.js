#!/usr/bin/env node
/**
 * The vision evaluation.
 *
 * The central claim is "point it at the machine and it reads the fault". This turns that claim into
 * two numbers, measured against real photographs, and prints them whether they are flattering or not.
 *
 *   node eval/run.js
 *
 * Expected answers come from the filenames, following the convention in eval/photos/README.md:
 *
 *   bosch-dishwasher-panel-e24.jpg     -> expects code E24
 *   lg-washer-plate-wm3900hwa.jpg      -> expects model WM3900HWA
 *   samsung-fridge-panel-clean.jpg     -> expects NO code (must not hallucinate one)
 *
 * A read that could not actually be performed is counted separately and never as a pass. An eval
 * that scores simulated reads is not an eval.
 */

const fs = require('node:fs');
const path = require('node:path');
const { see } = require('../mcp/tools/see');

const DIR = path.join(__dirname, 'photos');
const IMAGE = /\.(jpe?g|png|webp)$/i;

/** Pull the expected answer out of the filename. */
function expectationFor(file) {
  const base = path.basename(file).replace(IMAGE, '').toLowerCase();
  const parts = base.split('-');
  const kind = parts.includes('plate') ? 'plate' : parts.includes('panel') ? 'panel' : 'unknown';
  const last = parts[parts.length - 1];

  if (kind === 'panel') {
    if (last === 'clean' || last === 'none') return { kind, code: null, expectsNoCode: true };
    return { kind, code: last.toUpperCase() };
  }
  if (kind === 'plate') return { kind, model: last.toUpperCase() };
  return { kind };
}

const pct = (n, d) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

async function main() {
  if (!fs.existsSync(DIR)) {
    console.log('No eval/photos directory. Nothing measured.');
    process.exit(0);
  }

  const files = fs.readdirSync(DIR).filter((f) => IMAGE.test(f));

  if (files.length === 0) {
    console.log('\n  No photographs in eval/photos — nothing has been measured.\n');
    console.log('  This is the one thing that cannot be built without you. See eval/photos/README.md.');
    console.log('  Until there are photographs here, any claim about reading fault codes is unproven.\n');
    process.exit(0);
  }

  console.log(`\n  ${files.length} photograph${files.length === 1 ? '' : 's'}\n`);

  const tally = { codeTried: 0, codeRight: 0, modelTried: 0, modelRight: 0, simulated: 0, hallucinated: 0 };

  for (const file of files) {
    const expected = expectationFor(file);
    const result = await see({ imagePath: path.join(DIR, file) });

    if (result.simulated) {
      tally.simulated++;
      console.log(`  ${file.padEnd(42)} SIMULATED — not counted (${result.reason.slice(0, 40)})`);
      continue;
    }

    let verdict = '';

    if (expected.expectsNoCode) {
      tally.codeTried++;
      if (result.code === null) {
        tally.codeRight++;
        verdict = 'correctly saw no fault code';
      } else {
        tally.hallucinated++;
        verdict = `HALLUCINATED a code: ${result.code}`;
      }
    } else if (expected.code) {
      tally.codeTried++;
      const right = result.code === expected.code;
      if (right) tally.codeRight++;
      verdict = right ? `code ${result.code}` : `code ${result.code ?? 'null'} — expected ${expected.code}`;
    }

    if (expected.model) {
      tally.modelTried++;
      const right = (result.model || '').toUpperCase().includes(expected.model);
      if (right) tally.modelRight++;
      verdict += right ? `  model ${result.model}` : `  model ${result.model ?? 'null'} — expected ${expected.model}`;
    }

    console.log(`  ${file.padEnd(42)} ${verdict}`);
  }

  console.log('\n  ── results ──');
  console.log(`  fault code read correctly   ${tally.codeRight}/${tally.codeTried}  ${pct(tally.codeRight, tally.codeTried)}`);
  console.log(`  model number read correctly ${tally.modelRight}/${tally.modelTried}  ${pct(tally.modelRight, tally.modelTried)}`);
  if (tally.hallucinated > 0) {
    console.log(`\n  ${tally.hallucinated} invented a fault code on a healthy machine. That number must be zero.`);
  }
  if (tally.simulated > 0) {
    console.log(`\n  ${tally.simulated} could not be read at all (no Bedrock credentials) and are excluded.`);
    console.log('  These numbers describe only the photographs that were genuinely processed.');
  }
  console.log();
}

main();
