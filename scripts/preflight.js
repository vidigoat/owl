#!/usr/bin/env node
/**
 * Everything that can only be checked against real AWS.
 *
 *   npm run preflight
 *
 * The code in this repository is tested. What is not tested — because it cannot be, without
 * credentials — is the handful of assumptions about AWS: that the CLI is installed, that the
 * profile can reach Bedrock at all, that the model id exists in that region, that an image comes
 * back as a reading this parser accepts.
 *
 * Every one of those is cheap to get wrong and expensive to discover wrong on demo day, so this
 * runs them for a fraction of a cent and says exactly which one is not ready.
 *
 * It reads. It writes nothing and orders nothing.
 */

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');

const run = promisify(execFile);
const { MODEL_ID, parseReading, PROMPT } = require('../mcp/tools/see');

const REGION = process.env.AWS_REGION || 'us-east-1';
const PROFILE = process.env.AWS_PROFILE || '';
const PHOTOS = path.join(__dirname, '..', 'eval', 'photos');

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', green: '', amber: '', bold: '', off: '' };

const results = [];
const ok = (what, detail = '') => { results.push(true); console.log(`  ${C.green}✓${C.off} ${what}${detail ? `  ${C.dim}${detail}${C.off}` : ''}`); };
const no = (what, why) => { results.push(false); console.log(`  ${C.red}✗${C.off} ${what}\n      ${C.dim}${why}${C.off}`); };
const skip = (what, why) => console.log(`  ${C.amber}–${C.off} ${what}\n      ${C.dim}${why}${C.off}`);

const aws = (args) => run('aws', PROFILE ? [...args, '--profile', PROFILE] : args, { maxBuffer: 16 * 1024 * 1024 });
const short = (e) => String(e.stderr || e.message).split('\n').find((l) => l.trim()) || String(e.message);

async function cli() {
  console.log(`\n${C.bold}AWS CLI${C.off}`);
  try {
    const { stdout } = await run('aws', ['--version']);
    ok('installed', stdout.trim().split(' ')[0]);
  } catch {
    no('aws is not on PATH', 'Everything below needs it. `brew install awscli`, then re-run.');
    return false;
  }

  try {
    const { stdout } = await aws(['sts', 'get-caller-identity', '--output', 'json']);
    const id = JSON.parse(stdout);
    ok('credentials work', `${id.Arn}`);
    // Worth saying out loud: this is the account any hackathon credit will be billed against.
    console.log(`      ${C.dim}account ${id.Account}${PROFILE ? ` · profile ${PROFILE}` : ' · default profile'} · region ${REGION}${C.off}`);
  } catch (e) {
    no('credentials', `${short(e)}\n      Set AWS_PROFILE, or run \`aws configure\`.`);
    return false;
  }
  return true;
}

async function bedrock() {
  console.log(`\n${C.bold}Bedrock${C.off}`);

  // 1. Can this identity see Bedrock at all? This is the check that has been failing.
  let available = null;
  try {
    const { stdout } = await aws(['bedrock', 'list-foundation-models', '--region', REGION, '--output', 'json']);
    available = (JSON.parse(stdout).modelSummaries || []).map((m) => m.modelId);
    ok('the profile can reach Bedrock', `${available.length} models visible in ${REGION}`);
  } catch (e) {
    const why = short(e);
    no('cannot list models', /AccessDenied|not authorized/i.test(why)
      ? `${why}\n      This identity has no Bedrock permission. A separate Bedrock-only IAM user is the\n      cleanest fix — it also keeps hackathon credit off any production account.`
      : why);
  }

  // 2. Does the model id we use actually exist here? Region-specific and easy to get wrong.
  if (available) {
    const base = MODEL_ID.replace(/^(us|eu|apac)\./, ''); // inference-profile ids carry a prefix
    if (available.includes(MODEL_ID) || available.includes(base)) {
      ok(`model ${MODEL_ID}`, 'present in this region');
    } else {
      const nova = available.filter((m) => /nova/i.test(m)).slice(0, 4);
      no(`model ${MODEL_ID}`, nova.length
        ? `not in ${REGION}. Nova models that ARE here: ${nova.join(', ')}`
        : `not in ${REGION}, and no Nova model was found. Set BEDROCK_VISION_MODEL.`);
    }
  }

  // 3. The only check that proves the whole path: a real image, read back as a reading.
  const photos = fs.existsSync(PHOTOS)
    ? fs.readdirSync(PHOTOS).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    : [];
  if (!photos.length) {
    return skip('a real vision call', `no images in eval/photos/. Drop in one photo of an appliance panel\n      and re-run — that is the only way to prove the reading path end to end.`);
  }

  const file = path.join(PHOTOS, photos[0]);
  try {
    const body = JSON.stringify({
      messages: [{
        role: 'user',
        content: [
          { image: { format: path.extname(file).slice(1).replace('jpg', 'jpeg'), source: { bytes: fs.readFileSync(file).toString('base64') } } },
          { text: PROMPT },
        ],
      }],
    });
    const tmp = path.join(require('node:os').tmpdir(), `ssoh-preflight-${Date.now()}.json`);
    const out = `${tmp}.out`;
    fs.writeFileSync(tmp, body);

    await aws(['bedrock-runtime', 'converse', '--model-id', MODEL_ID, '--region', REGION,
               '--cli-input-json', `file://${tmp}`, '--cli-binary-format', 'raw-in-base64-out', out]);

    const text = JSON.parse(fs.readFileSync(out, 'utf8')).output?.message?.content?.[0]?.text ?? '';
    const reading = parseReading(text);
    fs.rmSync(tmp, { force: true });
    fs.rmSync(out, { force: true });

    if (!reading) no('a real vision call', `the model replied, but not as a reading this parser accepts:\n      ${text.slice(0, 160)}`);
    else ok('a real vision call', `${photos[0]} → ${JSON.stringify(reading).slice(0, 90)}`);
  } catch (e) {
    no('a real vision call', short(e));
  }
}

async function memory() {
  console.log(`\n${C.bold}AgentCore memory${C.off}`);

  // Probe the permission rather than only the env var. AmazonBedrockFullAccess does NOT cover
  // bedrock-agentcore — they are separate services with separate action prefixes, which is exactly
  // the kind of thing that is discovered at the wrong moment.
  try {
    await aws(['bedrock-agentcore-control', 'list-memories', '--region', REGION, '--output', 'json']);
    ok('the profile can reach AgentCore');
  } catch (e) {
    const why = short(e);
    if (/AccessDenied|not authorized/i.test(why)) {
      skip('AgentCore is not permitted for this identity',
        'AmazonBedrockFullAccess does not include bedrock-agentcore:* — they are separate services.\n' +
        '      Add an inline policy allowing bedrock-agentcore:* if you want real household memory.\n' +
        '      Until then memory is file-backed behind the same interface, and the UI says "local".');
    } else if (/Invalid choice|argument command/i.test(why)) {
      skip('AgentCore', `this AWS CLI does not know the bedrock-agentcore-control command (${why.slice(0, 60)})`);
    } else {
      skip('AgentCore', why);
    }
    return;
  }

  if (!process.env.AGENTCORE_MEMORY_ID) {
    return skip('AGENTCORE_MEMORY_ID', 'reachable, but no memory id set — still using the local store');
  }
  ok('configured', process.env.AGENTCORE_MEMORY_ID);
}

(async () => {
  console.log(`${C.bold}OWL preflight${C.off}  ${C.dim}— the assumptions only real AWS can check${C.off}`);
  if (await cli()) await bedrock();
  await memory();

  const failed = results.filter((r) => !r).length;
  console.log(`\n${'─'.repeat(70)}`);
  if (!results.length) console.log(`${C.amber}Nothing could be checked.${C.off} The demo still runs — every simulated read is labelled as one.`);
  else if (failed) {
    console.log(`${C.red}${failed} of ${results.length} checks failed.${C.off} The demo still runs on the simulated reader, which says so on screen.`);
    process.exitCode = 1;
  } else console.log(`${C.green}All ${results.length} checks passed.${C.off} The vision path works end to end.`);
})();
