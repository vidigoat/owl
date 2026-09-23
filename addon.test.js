/**
 * The Alexa+ add-on package, held to the constraints Amazon publishes for it.
 *
 *   node addon.test.js
 *
 * `addon.json` is what `alexa-ai deploy` uploads. Every limit here is from the MCP toolkit
 * quickstart (lengths, the six icon sizes, a 600x900 carousel); every URL it names has to be a file
 * this repository actually serves, at the size it claims — a manifest pointing at an icon that is
 * 240 pixels when it says 241 is a certification failure found by somebody else. And the privacy
 * page is checked against the code, because a privacy policy that drifts from the behaviour is the
 * worst kind of stale document.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

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

const addon = JSON.parse(fs.readFileSync(path.join(__dirname, 'addon.json'), 'utf8'));
const en = addon.storeListing.locales['en-US'];
const HOST = 'https://second-set-of-hands.vercel.app/';
const local = (uri) => {
  assert.ok(uri.startsWith(HOST), `${uri} is not served by this project`);
  return path.join(__dirname, 'public', uri.slice(HOST.length));
};
/** A PNG's size, from its IHDR chunk. */
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is not a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

console.log('the add-on package');

it('the required fields are there, within the published limits', () => {
  assert.equal(addon.manifestVersion, '1.0');
  assert.deepEqual(addon.storeListing.distributionCountries, ['US']);
  assert.ok(en.name.value.length <= 30, `name is ${en.name.value.length} characters`);
  assert.ok(en.shortDescription.length <= 123, `short description is ${en.shortDescription.length}`);
  assert.ok(en.fullDescription.length <= 4000);
  assert.ok(en.examplePhrases.length >= 3 && en.examplePhrases.length <= 4);
  en.examplePhrases.forEach((p) => assert.ok(p.length <= 200));
  en.examplePhrases.forEach((p) => assert.match(p, /Second Set of Hands/, `"${p}" does not name the add-on`));
});

it('the MCP endpoint is the deployed Streamable HTTP server', () => {
  const [mcp] = addon.integrations;
  assert.equal(mcp.type, 'MCP');
  assert.equal(mcp.config.endpoints.default.type, 'HTTPS');
  assert.equal(mcp.config.endpoints.default.uri, `${HOST}mcp`);
});

it('all six icon sizes, each a PNG of exactly that size', () => {
  const want = ['72x72', '64x64', '88x88', '126x126', '180x180', '241x241'];
  assert.deepEqual(en.mediaAssets.icons.light.map((i) => i.size).sort(), [...want].sort());
  for (const i of en.mediaAssets.icons.light) assert.equal(pngSize(local(i.uri)), i.size, i.uri);
});

it('at least one carousel image, 600x900, with alt text under 250 characters', () => {
  assert.ok(en.mediaAssets.carouselImages.length >= 1);
  for (const c of en.mediaAssets.carouselImages) {
    assert.equal(c.size, '600x900');
    assert.equal(pngSize(local(c.uri)), '600x900', c.uri);
    assert.ok(c.altText && c.altText.length <= 250);
  }
});

it('the privacy policy and terms are pages this site serves', () => {
  for (const u of [en.privacyAndCompliance.privacyPolicyUrl, en.privacyAndCompliance.termsOfUseUrl]) {
    assert.ok(fs.existsSync(local(u)), `${u} is not a file in public/`);
  }
});

it('the privacy policy says what the code does', () => {
  const policy = fs.readFileSync(path.join(__dirname, 'public', 'privacy.html'), 'utf8');
  // "dropped after 30 idle minutes" — agent/live.js is where that is decided.
  const src = fs.readFileSync(path.join(__dirname, 'agent', 'live.js'), 'utf8');
  const idle = Number(/IDLE_MS = (\d+) \* 60 \* 1000/.exec(src)[1]);
  assert.match(policy, new RegExp(`after ${idle} idle minutes`));
  // "Ordering is simulated. No payment is taken" — nothing in the checkout reaches a payment API.
  const checkout = fs.readFileSync(path.join(__dirname, 'mcp', 'tools', 'order_part.js'), 'utf8');
  assert.doesNotMatch(checkout, /fetch\(|https:\/\/|require\(['"]node:https/, 'the checkout talks to the network, and the policy says no payment is taken');
  assert.match(policy, /Ordering is simulated/);
});

console.log(`\n${passed} passed`);
