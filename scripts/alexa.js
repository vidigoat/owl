#!/usr/bin/env node
/**
 * Talk to the simulated Alexa+.
 *
 *   npm run alexa                        a conversation, typed — the agent is live, you are the person
 *   npm run alexa -- --demo              a whole repair, with the person's lines scripted
 *   npm run alexa -- --url <mcp url>     against any MCP server — e.g. the deployed one:
 *                                        https://second-set-of-hands.vercel.app/mcp
 *
 * Every Alexa+ line and every tool call is live: an Amazon Nova model on Bedrock, choosing tools
 * from the MCP server over Streamable HTTP. In --demo only the PERSON is scripted — the lines a
 * person with a broken dishwasher would say — and the output says so, because a demo that does not
 * say which half is canned is a demo nobody should trust.
 *
 * Needs AWS credentials with Bedrock access (AWS_PROFILE=bedrock here). A whole repair costs about
 * two cents on Nova 2 Lite, metered by mcp/budget.js before each call and printed at the end.
 */

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

const { Alexa } = require('../agent/alexa');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] || true : null;
};

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', bold: '\x1b[1m', teal: '\x1b[36m', amber: '\x1b[33m', red: '\x1b[31m', green: '\x1b[32m', off: '\x1b[0m' }
  : { dim: '', bold: '', teal: '', amber: '', red: '', green: '', off: '' };

const DEMO = [
  'My Bosch dishwasher is showing E24. The model is SHE3AR75UC.',
  "No — it's completely silent.",
  'Yes, order it.',
  'Yes.',
];

function show(said, r) {
  console.log(`\n  ${C.bold}you${C.off}      ${said}`);
  for (const s of r.steps) {
    if (s.private) continue;
    const filled = s.filled.length ? `${C.dim}  ← client supplied ${s.filled.join(', ')}${C.off}` : '';
    const tone = s.isError ? C.red : /UPHELD|cart:|ordered|"ok":true/.test(s.answer) ? C.green : /refused|abstains/.test(s.answer) ? C.amber : C.dim;
    console.log(`  ${C.dim}  ${s.tool.padEnd(17)}${C.off}${tone}${s.answer.slice(0, 110)}${C.off}${filled}`);
  }
  console.log(`  ${C.teal}${C.bold}alexa+${C.off}   ${C.teal}${r.say}${C.off}  ${C.dim}(${r.rounds} round${r.rounds === 1 ? '' : 's'} · $${r.cost.toFixed(4)})${C.off}`);
}

async function main() {
  let url = flag('url');
  let server = null;
  if (!url || url === true) {
    const port = Number(process.env.MCP_PORT) || 8794;
    server = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')], {
      env: { ...process.env, MCP_PORT: String(port) },
      stdio: 'ignore',
    });
    process.on('exit', () => server.kill());
    url = `http://127.0.0.1:${port}/mcp`;
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(url, { method: 'GET' });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  const alexa = new Alexa({ url });
  try {
    await alexa.connect();
  } catch (e) {
    console.error(`\n  ${C.red}Could not reach the MCP server at ${url}: ${e.message}${C.off}\n`);
    process.exit(1);
  }

  console.log(`\n  ${C.bold}SIMULATED ALEXA+${C.off}  ${C.dim}${alexa.model} on Bedrock, driving an MCP server over Streamable HTTP${C.off}`);
  console.log(`  ${C.dim}server  ${url}  ·  ${alexa.client.server?.name} · spec ${alexa.client.protocol} · ${alexa.tools.length - 1} tools${C.off}`);

  if (args.includes('--demo')) {
    console.log(`  ${C.amber}The person's lines are scripted. Everything Alexa+ says and every tool it calls is live.${C.off}`);
    for (const said of DEMO) {
      try {
        show(said, await alexa.turn(said));
      } catch (e) {
        console.error(`\n  ${C.red}${e.message}${C.off}`);
        break;
      }
    }
    finish(alexa);
    return;
  }

  console.log(`  ${C.dim}Say what the machine is doing. Ctrl-C to stop.${C.off}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `\n  ${C.bold}you${C.off}      ` });
  rl.prompt();
  rl.on('line', async (line) => {
    if (!line.trim()) return rl.prompt();
    rl.pause();
    try {
      const r = await alexa.turn(line);
      // The echo of their own line is already on screen from the prompt.
      process.stdout.write('\x1b[1A\x1b[2K');
      show(line, r);
    } catch (e) {
      console.error(`\n  ${C.red}${e.message}${C.off}`);
    }
    rl.resume();
    rl.prompt();
  });
  rl.on('close', () => finish(alexa));
}

function finish(alexa) {
  console.log(`\n  ${C.dim}conversation: $${alexa.cost.toFixed(4)} · ${alexa.tokens.in.toLocaleString()} tokens in, ${alexa.tokens.out.toLocaleString()} out${C.off}\n`);
  process.exit(0);
}

main();
