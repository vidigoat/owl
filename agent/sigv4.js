/**
 * AWS Signature Version 4, with nothing installed.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Everything in this project that reaches Bedrock did it by shelling out to the AWS CLI — `see.js`,
 * `read_manual.js` — which is a binary, which is on this laptop and is not on the host that serves
 * the demo URL. That is the same trap `pdftotext` set, and it would have closed the same way: the
 * agent that makes this an Alexa+ experience rather than a scripted one would have worked on the
 * machine it was written on and nowhere a judge could reach.
 *
 * SigV4 is four hashes and an HMAC chain; Node ships both. This is the whole algorithm, checked
 * against the vector AWS publishes for it (`get-vanilla`, in `agent/sigv4.test.js`), so a signature
 * that is wrong fails here rather than as a 403 from Bedrock with no explanation.
 *
 * ── The one detail that costs people an afternoon ───────────────────────────
 *
 * The canonical URI is URI-encoded TWICE for every service except S3. A Bedrock model id contains
 * `:` — `us.amazon.nova-2-lite-v1:0` — so the request path carries `%3A`, and the canonical request
 * must carry `%253A`. Encoding once produces a signature that is internally consistent, looks right,
 * and is rejected.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, which is stricter than encodeURIComponent about `!'()*`. */
const rfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Sign one request.
 *
 * @param {object} req      { method, url, headers, body }
 * @param {object} creds    { accessKeyId, secretAccessKey, sessionToken? }
 * @param {object} scope    { region, service }
 * @param {Date}   [now]
 * @returns {object} headers to send, including Authorization and X-Amz-Date
 */
function sign({ method = 'GET', url, headers = {}, body = '' }, creds, { region, service }, now = new Date()) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);

  const payloadHash = sha256(body || '');
  const all = {
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
    host: u.host,
    'x-amz-date': amzDate,
  };
  if (creds.sessionToken) all['x-amz-security-token'] = creds.sessionToken;

  const signedNames = Object.keys(all).sort();
  const canonicalHeaders = signedNames.map((k) => `${k}:${all[k].replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = signedNames.join(';');

  // Twice for everything but S3 — see the note at the top of this file.
  const canonicalUri =
    service === 's3'
      ? u.pathname
      : u.pathname
          .split('/')
          .map((seg) => rfc3986(decodeURIComponent(seg)))
          .map((seg) => rfc3986(seg))
          .join('/') || '/';

  const canonicalQuery = [...u.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const out = { ...headers, 'x-amz-date': amzDate };
  if (creds.sessionToken) out['x-amz-security-token'] = creds.sessionToken;
  out.authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: out, canonicalRequest, stringToSign, signature };
}

/**
 * Credentials, from where the AWS tools look for them — environment first, then the shared file.
 *
 * Only static keys are read. A profile that relies on SSO or an assumed role needs the SDK's token
 * machinery, and pretending to support it would mean failing somewhere less obvious than here.
 */
function credentials({ profile = process.env.AWS_PROFILE || 'default', env = process.env } = {}) {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN || undefined,
      source: 'environment',
    };
  }
  const file = env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const section = parseIni(text)[profile];
  if (!section?.aws_access_key_id || !section?.aws_secret_access_key) return null;
  return {
    accessKeyId: section.aws_access_key_id,
    secretAccessKey: section.aws_secret_access_key,
    sessionToken: section.aws_session_token || undefined,
    source: `profile ${profile}`,
  };
}

function parseIni(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, '').trim();
    if (!line) continue;
    const head = /^\[(?:profile\s+)?([^\]]+)\]$/.exec(line);
    if (head) {
      cur = out[head[1].trim()] = {};
      continue;
    }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (kv && cur) cur[kv[1].trim()] = kv[2].trim();
  }
  return out;
}

module.exports = { sign, credentials, parseIni, rfc3986 };
