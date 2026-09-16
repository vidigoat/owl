/**
 * Every screen, actually rendered.
 *
 * The wiring test proves the interface connects to itself. This proves it *runs*: each screen is
 * driven through with a stubbed DOM and stubbed network, so a typo in a template literal or a
 * property read on an undefined object fails here rather than on camera.
 *
 * Run: node public/screens.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let passed = 0;
const it = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n       ', e.message);
    process.exitCode = 1;
  }
};

/* ── the smallest DOM that app.js will accept ─────────────────────── */
function element() {
  const el = {
    innerHTML: '',
    textContent: '',
    disabled: false,
    hidden: false,
    scrollTop: 0,
    scrollHeight: 0,
    offsetWidth: 0,
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    appendChild(child) { this.children.push(child); },
    scrollIntoView() {},
    querySelector: () => element(),
    querySelectorAll: () => [],
  };
  return el;
}

/* Responses shaped like the real endpoints, so the screens get real-looking data. */
const SPACE = [
  { id: 'filter', label: 'Blocked filter', prior: 0.72, cost: 0, evidence: 'manual: line 4' },
  { id: 'pump', label: 'Failed pump', prior: 0.28, cost: 38, evidence: 'manual: line 6' },
];
const TEST = {
  id: 't1',
  question: 'Can you hear the pump humming?',
  effort: 'free',
  outcomes: [
    { value: 'hums', say: 'it hums', consistentWith: ['filter'] },
    { value: 'silent', say: "it's silent", consistentWith: ['pump'] },
  ],
};

function respond(url) {
  if (url.includes('/api/session')) return { memory: [{ appliance: 'x', note: 'y', when: '—' }], part: {}, appliance: {}, fault: {} };
  if (url.includes('/api/see')) return { simulated: true, model: null, code: null, reason: 'no creds', note: 'Simulated read' };
  if (url.includes('/api/diagnosis/start')) return { known: true, meaning: 'Cannot drain', space: SPACE, bits: 0.86, tests: [TEST] };
  if (url.includes('/api/diagnosis/next')) return { test: TEST, bits: 0.86, effort: 'free', why: 'rules out most', done: false, stuck: false };
  if (url.includes('/api/diagnosis/observe')) return { space: [SPACE[1]], eliminated: [SPACE[0]], contradiction: false, bits: 0 };
  if (url.includes('/api/learn')) return { learned: true, codes: 1, coverage: '1 fault code recovered' };
  if (url.includes('/api/guide')) return { known: true, steps: [{ n: 1, say: 'Open the door', detail: 'x', pace: 10, hands: 'both' }], totalSeconds: 10, handsFree: true };
  if (url.includes('/api/checkout/begin')) {
    return { ok: true, sessionId: 's1', lineItems: [{ title: 'Drain pump', fitsModel: 'M', price: 38.42 }], totals: { subtotal: 38.42, tax: 3.36, shipping: 0, total: 41.78 }, eta: 'Tomorrow', insteadOf: { price: 179, label: 'Service call', eta: '7 days' }, saving: 137.22, say: 'Order it?' };
  }
  if (url.includes('/api/checkout/confirm')) return { ok: true, order: { orderId: 'o1' }, say: 'Ordered.' };
  if (url.includes('/api/confirm')) return { confirmed: false, unknown: true, simulated: true, reason: 'could not look' };
  if (url.includes('/api/remember')) return { saved: true, repeat: false, note: null, due: [] };
  if (url.includes('/api/verify')) return { abstain: false, upheld: true, confidence: 0.72, citation: 'manual: line 4', maySpend: false };
  if (url.includes('/api/part')) return { found: true, part: { name: 'Drain pump', price: 38.42, eta: 'Tomorrow', fitsModel: 'M', fitConfidence: 0.98 }, alternative: { price: 179, label: 'Service call', eta: '7 days' }, saving: 140 };
  return {};
}

function load() {
  const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const sandbox = {
    console,
    setTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    document: { querySelector: () => element(), createElement: () => element() },
    window: {
      matchMedia: () => ({ matches: true }), // reduced motion: skip animation waits
      // A spy, not a stub. Anything that speaks without being asked shows up here.
      speechSynthesis: { spoken: [], speak(u) { this.spoken.push(u); }, cancel() {} },
    },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    location: { search: '' }, // the capture hook stays off unless a test asks for it
    URLSearchParams,
    fetch: async (url) => ({ json: async () => respond(String(url)) }),
    encodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app.js' });
  return sandbox;
}

(async () => {
  console.log('every screen, rendered');

  await it('loads without throwing', () => {
    const s = load();
    assert.equal(typeof s.advance, 'function');
  });

  await it('walks the whole flow without a runtime error', async () => {
    const s = load();
    await new Promise((r) => setTimeout(r, 10)); // let boot() settle
    // idle → camera → space → question → (answer) → conclusion → guide → part → done
    for (let i = 0; i < 8; i++) await s.advance();
  });

  await it('renders the refusal screen', async () => {
    const s = load();
    await new Promise((r) => setTimeout(r, 10));
    await s.showRefusal();
  });

  await it('renders the teach screen and keeps going', async () => {
    const s = load();
    await new Promise((r) => setTimeout(r, 10));
    await s.teach();
    await s.advance();
  });

  await it('resets cleanly and can run again', async () => {
    const s = load();
    await new Promise((r) => setTimeout(r, 10));
    await s.advance();
    s.reset();
    await s.advance();
  });

  await it('never speaks unless somebody asked it to', async () => {
    // A device that starts talking the moment you open it is a device people close. Voice is off
    // until the toggle is pressed, and this walks the whole flow to prove nothing slips out.
    const s = load();
    await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 8; i++) await s.advance();
    await s.showRefusal();
    await s.teach();
    assert.equal(s.window.speechSynthesis.spoken.length, 0,
      'something spoke without the Speak toggle being on');
  });

  console.log(`\n${passed} passed`);
})();
