/**
 * Owl's speaking voice: Amazon Polly.
 *
 * The device page used the browser's built-in speech, which on most machines is the robotic system
 * voice — fine for a test, wrong for a product whose whole job is to be listened to with your hands
 * inside an appliance. Polly's generative voices sound like a person reading, and they are Amazon's,
 * like the rest of the stack.
 *
 * One request per spoken line, signed with the same SigV4 helper the Bedrock calls use, so this
 * project still installs nothing. A line is spoken by a generative voice when the region offers it
 * and by the neural one otherwise; if Polly cannot be reached at all, the caller gets an error and
 * the page falls back to the browser's own voice rather than going silent.
 */

const { sign, credentials } = require('./sigv4');

const REGION = process.env.OWL_VOICE_REGION || process.env.AWS_REGION || 'us-east-1';
const VOICE = process.env.OWL_VOICE || 'Ruth';
// A spoken reply is a sentence or three. Anything longer is not a line to read aloud.
const MAX_CHARS = 600;

/** Recently spoken lines, kept so the same sentence twice is one Polly call. */
const cache = new Map();
const CACHE_MAX = 60;

function tidy(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Speech for one line, as MP3 bytes.
 *
 * @param {string} text
 * @param {object} [o]
 * @param {Function} [o.fetch]   injected in tests
 * @param {object} [o.creds]     injected in tests
 * @returns {Promise<Buffer>}
 */
async function speak(text, { fetch: doFetch = globalThis.fetch, creds = credentials() } = {}) {
  const line = tidy(text);
  if (!line) throw Object.assign(new Error('Nothing to say.'), { status: 400 });
  if (line.length > MAX_CHARS) throw Object.assign(new Error('Too long to read aloud.'), { status: 413 });
  if (!creds) throw Object.assign(new Error('No AWS credentials for the voice.'), { status: 503 });
  if (cache.has(line)) return cache.get(line);

  const url = `https://polly.${REGION}.amazonaws.com/v1/speech`;
  const ask = async (engine) => {
    const body = JSON.stringify({ Engine: engine, OutputFormat: 'mp3', Text: line, TextType: 'text', VoiceId: VOICE });
    const { headers } = sign({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body }, creds, { region: REGION, service: 'polly' });
    const res = await doFetch(url, { method: 'POST', headers, body });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`Polly answered ${res.status}`), { status: res.status, detail });
    }
    return Buffer.from(await res.arrayBuffer());
  };

  // Neural first: it answers in about half the time of the generative engine, and a device that
  // pauses before it speaks feels broken. OWL_VOICE_ENGINE=generative trades that for warmth.
  const first = process.env.OWL_VOICE_ENGINE === 'generative' ? 'generative' : 'neural';
  const second = first === 'neural' ? 'generative' : 'neural';
  let audio;
  try {
    audio = await ask(first);
  } catch (e) {
    // A voice or region without that engine is a 400; the other one reads nearly as well.
    if (e.status !== 400) throw e;
    audio = await ask(second);
  }

  cache.set(line, audio);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return audio;
}

module.exports = { speak, tidy, MAX_CHARS };
