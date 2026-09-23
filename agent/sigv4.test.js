/**
 * SigV4, against the vectors AWS publishes for it.
 *
 *   node agent/sigv4.test.js
 *
 * A signer that is wrong does not fail loudly. It produces a signature that looks exactly like a
 * right one and is rejected with a 403 that says nothing about which of four hashes went astray. So
 * the signer is checked against AWS's own SigV4 test suite first — the same inputs, the same
 * expected canonical request, the same expected signature — before it is allowed near Bedrock.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sign, credentials, parseIni, rfc3986 } = require('./sigv4');

let passed = 0;
const it = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n       ', e.message);
    process.exitCode = 1;
  }
};

console.log('sigv4');

/* The credentials every vector in the AWS suite is signed with. Public test values, not a secret. */
const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const SCOPE = { region: 'us-east-1', service: 'service' };
const AT = new Date('2015-08-30T12:36:00Z');

it('get-vanilla: the canonical request, string to sign and signature AWS publishes', () => {
  const r = sign({ method: 'GET', url: 'https://example.amazonaws.com/' }, CREDS, SCOPE, AT);
  assert.equal(
    r.canonicalRequest,
    'GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n' +
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(
    r.stringToSign,
    'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n' +
      'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63'
  );
  assert.equal(r.signature, '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  assert.equal(
    r.headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
  );
});

it('get-vanilla-query-order-key-case: query parameters are sorted into the canonical form', () => {
  const r = sign({ method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1' }, CREDS, SCOPE, AT);
  assert.match(r.canonicalRequest, /^GET\n\/\nParam1=value1&Param2=value2\n/);
  assert.equal(r.signature, 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
});

it('a Bedrock model id is encoded twice in the canonical URI, once in the request', () => {
  /*
   * `us.amazon.nova-2-lite-v1:0` carries a colon. The request path has `%3A`; the canonical
   * request must have `%253A`. Encoding once yields a signature that is internally consistent and
   * rejected — the classic SigV4 afternoon.
   */
  const url = `https://bedrock-runtime.us-east-1.amazonaws.com/model/${encodeURIComponent('us.amazon.nova-2-lite-v1:0')}/converse`;
  const r = sign({ method: 'POST', url, body: '{}' }, CREDS, { region: 'us-east-1', service: 'bedrock' }, AT);
  const uri = r.canonicalRequest.split('\n')[1];
  assert.equal(uri, '/model/us.amazon.nova-2-lite-v1%253A0/converse');
});

it('a session token is signed and sent, for temporary credentials', () => {
  const r = sign({ url: 'https://example.amazonaws.com/' }, { ...CREDS, sessionToken: 'TOKEN' }, SCOPE, AT);
  assert.equal(r.headers['x-amz-security-token'], 'TOKEN');
  assert.match(r.headers.authorization, /SignedHeaders=host;x-amz-date;x-amz-security-token/);
});

it('the body is part of the signature, so a changed body is a different signature', () => {
  const a = sign({ method: 'POST', url: 'https://example.amazonaws.com/', body: '{"a":1}' }, CREDS, SCOPE, AT);
  const b = sign({ method: 'POST', url: 'https://example.amazonaws.com/', body: '{"a":2}' }, CREDS, SCOPE, AT);
  assert.notEqual(a.signature, b.signature);
});

it('RFC 3986 encoding covers the characters encodeURIComponent leaves alone', () => {
  assert.equal(rfc3986("a!b'c(d)e*f"), 'a%21b%27c%28d%29e%2Af');
});

it('credentials come from the environment first, then the shared file, and never half of either', () => {
  const env = { AWS_ACCESS_KEY_ID: 'A', AWS_SECRET_ACCESS_KEY: 'S' };
  assert.equal(credentials({ env }).source, 'environment');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigv4-'));
  const file = path.join(dir, 'credentials');
  fs.writeFileSync(file, '[default]\naws_access_key_id = D\naws_secret_access_key = DS\n\n[bedrock]\naws_access_key_id = B\naws_secret_access_key = BS\n');
  const fromFile = credentials({ profile: 'bedrock', env: { AWS_SHARED_CREDENTIALS_FILE: file } });
  assert.equal(fromFile.accessKeyId, 'B');
  assert.equal(fromFile.source, 'profile bedrock');

  // Only a key id and no secret is not a credential; it is a misconfiguration.
  assert.equal(credentials({ env: { AWS_ACCESS_KEY_ID: 'A', AWS_SHARED_CREDENTIALS_FILE: path.join(dir, 'nope') } }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

it('the shared-file parser reads [profile name] and comments the way the AWS tools do', () => {
  const ini = parseIni('# note\n[profile work]\nregion = us-east-1 ; trailing\n[default]\nx=1\n');
  assert.equal(ini.work.region, 'us-east-1');
  assert.equal(ini.default.x, '1');
});

console.log(`\n${passed} passed`);
