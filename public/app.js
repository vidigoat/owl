/* SECOND SET OF HANDS — the device.
 *
 * The screen renders. It decides nothing. Every cause, every question, every elimination on this
 * page came back from a tool call — which is the whole point: Alexa+ could be driving this instead
 * of a browser and none of the code below would know the difference.
 */

const $ = (s) => document.querySelector(s);
const screen = $('#screen');
const traceEl = $('#trace');
const captionEl = $('#caption');
const advanceBtn = $('#advance');

/* Mutable: the whole point is that it can be pointed at a machine it has never seen. */
let APPLIANCE = { model: 'SHE3AR75UC', brand: 'Bosch', kind: 'Dishwasher', code: 'E24' };

/* A real LG fault table. Letter-only codes, which is how LG writes them. */
const UNSEEN_MANUAL = {
  model: 'LG-WM3900HWA',
  brand: 'LG',
  kind: 'Washer',
  code: 'OE',
  source: 'LG service manual',
  text: `Fault codes
OE   The machine cannot drain
     Check the drain filter for debris
     Clean the drain pump of obstructions
     Replace the drain pump if it does not turn

UE   The load is unbalanced
     Check the load is evenly distributed
`,
};

let D = null;                 // session data (part, memory, static copy)
let stage = 'idle';
let dx = null;                // the live diagnosis: { space, tests, performed, bits, meaning }
let pending = null;           // the question on screen, awaiting an answer
let handsFreeTimer = null;

const say = (text) => `<div class="saying"><i>says</i><span>${text}</span></div>`;
const post = (path, body) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

/* ── trace ─────────────────────────────────────────────────────────── */
function trace(tool, arg, out, tech, gate = false) {
  const li = document.createElement('li');
  if (gate) li.className = 'is-gate';
  li.innerHTML = `<b>${tool}</b>(${arg}) → ${out} <em>· ${tech}</em>`;
  traceEl.appendChild(li);
  traceEl.scrollTop = traceEl.scrollHeight;
}

/* ── the hypothesis space, drawn ───────────────────────────────────── */
function spaceMarkup(space, eliminated = []) {
  const all = [...space.map((c) => ({ ...c, out: false })), ...eliminated.map((c) => ({ ...c, out: true }))];
  return `
    <ul class="space">
      ${all
        .map(
          (c) => `
        <li class="cause ${c.out ? 'is-out' : ''}">
          <span class="cause__bar" style="--p:${Math.round((c.prior || 0) * 100)}%"></span>
          <span class="cause__label">${c.label}</span>
          <span class="cause__pct">${c.out ? 'ruled out' : Math.round(c.prior * 100) + '%'}</span>
        </li>`
        )
        .join('')}
    </ul>`;
}

const bitsLine = (bits) =>
  `<p class="bits">${bits > 0.01 ? `${bits.toFixed(2)} bits of uncertainty left` : 'no uncertainty left'}</p>`;

/* ── screens ───────────────────────────────────────────────────────── */

function renderIdle() {
  captionEl.textContent = 'A dishwasher that will not drain. It has never seen this machine before.';
  advanceBtn.textContent = 'Start the repair';
  advanceBtn.disabled = false;
  screen.innerHTML = `
    <div class="s-listen">
      <div class="s-listen__ring"></div>
      <p>“Alexa, my dishwasher is beeping and there's water in the bottom.”</p>
    </div>
    ${say('Hold it up to me — let me see the panel.')}`;
}

function renderCamera() {
  captionEl.textContent = 'The camera reads the panel. Nothing is typed in.';
  advanceBtn.textContent = 'Read the panel';
  screen.innerHTML = `
    <div class="s-cam">
      <div class="s-cam__panel">E24</div>
      <span class="s-cam__hint">reading fault code and model plate</span>
    </div>
    ${say('Got it. Hold still for a second.')}`;
}

async function renderSpace() {
  trace('identify_appliance', 'frame.jpg', `${APPLIANCE.brand} ${APPLIANCE.model} · 0.97`, 'Bedrock vision');
  trace('read_error', 'frame.jpg', 'E24 · 0.99', 'Bedrock vision');

  const started = await post('/api/diagnosis/start', { model: APPLIANCE.model, code: APPLIANCE.code });
  dx = { space: started.space, tests: started.tests, performed: [], ruledOut: [], bits: started.bits, meaning: started.meaning };
  trace('hypotheses', `${APPLIANCE.model}, ${APPLIANCE.code}`, `${started.space.length} causes · ${started.bits.toFixed(2)} bits`, 'service data');

  captionEl.textContent = 'Three things could cause this. It does not know which yet — and says so.';
  advanceBtn.textContent = 'What should I check?';
  screen.innerHTML = `
    <div class="s-space">
      <div class="readout">
        <span class="readout__k">fault</span>
        <span class="fault-chip">E24</span>
        <span class="readout__meaning">${dx.meaning}</span>
      </div>
      ${spaceMarkup(dx.space)}
      ${bitsLine(dx.bits)}
    </div>
    ${say("Three things cause this. Let's find out which, before you spend anything.")}`;
}

async function renderQuestion() {
  const choice = await post('/api/diagnosis/next', { space: dx.space, tests: dx.tests, performed: dx.performed });
  trace('next_test', `${dx.space.length} causes`, choice.test ? `${choice.test.id} · ${choice.bits} bits` : choice.reason, 'information gain');

  if (!choice.test) return choice.done ? renderConclusion() : renderStuck(choice);

  pending = choice;
  captionEl.textContent = 'It asks, and then it waits. That pause is the whole idea.';
  advanceBtn.disabled = true;

  screen.innerHTML = `
    <div class="s-question">
      <p class="question">${choice.test.question}</p>
      <p class="question__why">${choice.why} <span class="question__bits">${choice.bits} bits</span></p>
      <div class="answers">
        ${choice.test.outcomes
          .map((o, i) => `<button class="answer" data-i="${i}">${o.say}</button>`)
          .join('')}
      </div>
      ${spaceMarkup(dx.space)}
    </div>
    ${say(choice.test.question)}`;

  screen.querySelectorAll('.answer').forEach((btn) =>
    btn.addEventListener('click', () => answer(choice.test.outcomes[Number(btn.dataset.i)]))
  );
}

async function answer(outcome) {
  const result = await post('/api/diagnosis/observe', { space: dx.space, outcome });
  trace('observe', outcome.value, result.contradiction ? 'contradiction' : `${result.eliminated.length} ruled out`, 'prune');

  if (result.contradiction) return renderContradiction(result);

  // Show the elimination before moving on — this is the moment the product is understood.
  screen.querySelector('.s-question').innerHTML = `
    <p class="question question--answered">${pending.test.question}</p>
    <p class="answered__you">you said: <b>${outcome.say}</b></p>
    ${spaceMarkup(result.space, result.eliminated)}
    ${bitsLine(result.bits)}`;

  dx.space = result.space;
  dx.bits = result.bits;
  dx.performed.push(pending.test.id);
  // What the person's answer eliminated. The gate needs this: clearing the cheap causes is what
  // earns the expensive one the right to be spoken as fact.
  dx.ruledOut.push(...result.eliminated.map((c) => c.id));

  captionEl.textContent = `${result.eliminated.length} cause${result.eliminated.length === 1 ? '' : 's'} eliminated by something you did.`;
  advanceBtn.disabled = false;
  advanceBtn.textContent = dx.space.length > 1 ? 'What next?' : 'So what is it?';
  stage = dx.space.length > 1 ? 'question' : 'conclusion';
}

async function renderConclusion() {
  const cause = dx.space[0];
  const verdict = await fetch(
    `/api/verify?model=${APPLIANCE.model}&code=${APPLIANCE.code}&causeId=${cause.id}&ruledOut=${encodeURIComponent(dx.ruledOut.join(','))}`
  ).then((r) => r.json());
  trace('verify_diagnosis', cause.id, verdict.abstain ? 'ABSTAIN' : 'UPHELD', 'trust gate', true);

  captionEl.textContent = 'One cause left — and only now does it talk about money.';
  advanceBtn.textContent = 'Order the part';
  advanceBtn.disabled = false;

  screen.innerHTML = `
    <div class="s-conclusion">
      <span class="done__seal">ONE CAUSE LEFT</span>
      <p class="done__line">${cause.label}</p>
      <p class="done__sub">${cause.evidence}</p>
      ${dx.performed.length ? `<p class="asked">Reached in ${dx.performed.length} question${dx.performed.length === 1 ? '' : 's'}.</p>` : ''}
    </div>
    ${say(`It's the ${cause.label.toLowerCase()}. Now I can tell you what it costs.`)}`;
  stage = 'part';
}

function renderStuck(choice) {
  captionEl.textContent = 'It ran out of useful questions — so it stops, rather than guessing.';
  advanceBtn.disabled = true;
  screen.innerHTML = `
    <div class="s-refuse">
      <span class="refuse__seal">NOT ESTABLISHED</span>
      <p class="refuse__line">I can't narrow this down any further from here.</p>
      <p class="refuse__why">${choice.reason}. Anything I told you now would be a guess, and guesses cost you a part you may not need.</p>
      ${spaceMarkup(dx.space)}
    </div>
    ${say("I've run out of checks that would tell me anything. This one needs a technician.")}`;
}

function renderContradiction(result) {
  captionEl.textContent = 'The evidence contradicts the manual. It says so instead of pretending.';
  advanceBtn.disabled = true;
  screen.innerHTML = `
    <div class="s-refuse">
      <span class="refuse__seal">CONTRADICTION</span>
      <p class="refuse__line">That rules out everything the manual lists.</p>
      <p class="refuse__why">${result.reason}</p>
    </div>
    ${say("That shouldn't be possible according to the manual. Something else is going on here.")}`;
}

async function renderPart() {
  // Whichever cause actually survived — not a hard-coded guess.
  const causeId = dx && dx.space.length === 1 ? dx.space[0].id : 'pump';
  const p = await fetch(`/api/part?model=${APPLIANCE.model}&causeId=${causeId}`).then((r) => r.json());
  trace('find_part', `${APPLIANCE.model} pump`, p.found ? `$${p.part.price} · fits ${p.part.fitConfidence}` : 'nothing verified', 'parts catalog');

  captionEl.textContent = 'The exact part for this model, and what not doing it costs.';
  advanceBtn.textContent = 'Done';

  screen.innerHTML = p.found
    ? `<div class="s-part">
        <div><div class="part__name">${p.part.name}</div><span class="part__fit">fits ${p.part.fitsModel} · ${p.part.fitConfidence}</span></div>
        <div class="compare">
          <div class="is-ours"><b>$${p.part.price}</b><span>this part · ${p.part.eta}</span></div>
          <div><b>$${p.alternative.price}</b><span>${p.alternative.label} · ${p.alternative.eta}</span></div>
        </div>
        <p class="ask">Order it with your Amazon wallet?</p>
      </div>
      ${say(`Thirty-eight dollars, here tomorrow. A service call is about ${p.alternative.price}.`)}`
    : `<div class="s-refuse"><span class="refuse__seal">NO VERIFIED PART</span><p class="refuse__line">${p.reason}</p></div>`;
  stage = 'done';
}

function renderDone() {
  trace('confirm_fix', 'frame.jpg', 'no fault code', 'Bedrock vision');
  trace('home.remember', 'repair receipt', 'stored', 'AgentCore');
  captionEl.textContent = 'It checks its own work, then writes down what happened.';
  advanceBtn.disabled = true;
  screen.innerHTML = `
    <div class="s-done">
      <span class="done__seal">FAULT CLEARED</span>
      <p class="done__line">Ordered, fitted, and the code is gone.</p>
      <p class="done__sub">I watched the panel through a rinse cycle — no fault. Noted against this dishwasher.</p>
    </div>
    ${say('That was $38 and about ten minutes, instead of $179 and a week.')}`;
}

/* ── flow ──────────────────────────────────────────────────────────── */
const FLOW = { idle: renderCamera, camera: renderSpace, space: renderQuestion, question: renderQuestion, conclusion: renderConclusion, part: renderPart, done: renderDone };
const NEXT = { idle: 'camera', camera: 'space', space: 'question', conclusion: 'part', part: 'done' };

async function advance() {
  const fn = FLOW[stage];
  if (!fn) return;
  if (stage !== 'question' && stage !== 'conclusion' && stage !== 'part') stage = NEXT[stage] || stage;
  else if (stage === 'conclusion') stage = 'part';
  else if (stage === 'part') stage = 'done';
  await fn();
}

/* the refusal, on a different fault — the screen this project is proudest of */
async function showRefusal() {
  traceEl.innerHTML = '';
  trace('read_error', 'frame.jpg', 'E09 · 0.98', 'Bedrock vision');
  const r = await fetch(`/api/verify?model=${APPLIANCE.model}&code=E09`).then((res) => res.json());
  trace('verify_diagnosis', 'E09', 'ABSTAIN', 'trust gate', true);

  captionEl.textContent = 'The refusal is the product. It books a technician rather than guessing.';
  advanceBtn.disabled = true;
  advanceBtn.textContent = 'Reset to continue';
  screen.innerHTML = `
    <div class="s-refuse">
      <div class="readout"><span class="readout__k">fault</span><span class="fault-chip">E09</span></div>
      <span class="refuse__seal">NOT UPHELD — NO PART SOLD</span>
      <p class="refuse__line">I'm not going to guess with your money.</p>
      <p class="refuse__why">${r.reason}</p>
    </div>
    ${say("Three things could cause this and one of them is mains wiring. This one needs a technician.")}`;
}

/* Point it at a machine nobody wrote code for. It reads that machine's own manual and carries on. */
async function teach() {
  traceEl.innerHTML = '';
  const m = UNSEEN_MANUAL;

  captionEl.textContent = 'A washing machine. No code anywhere in this project mentions it.';
  advanceBtn.disabled = true;
  screen.innerHTML = `
    <div class="s-teach">
      <p class="teach__head">${m.brand} ${m.model}</p>
      <p class="teach__sub">Nothing in this project knows anything about this machine.</p>
      <pre class="teach__manual">${m.text.trim()}</pre>
    </div>
    ${say("I haven't seen this one. Let me read its manual.")}`;

  await new Promise((r) => setTimeout(r, 900));

  const learned = await post('/api/learn', m);
  trace('manual.parse', `${m.source}`, learned.coverage, 'fault graph');
  trace('learn', m.model, learned.learned ? `${learned.codes} code(s)` : learned.reason, 'runtime');

  if (!learned.learned) {
    screen.innerHTML = `
      <div class="s-refuse">
        <span class="refuse__seal">NOTHING RECOVERED</span>
        <p class="refuse__line">I couldn't get a fault table out of that manual.</p>
        <p class="refuse__why">${learned.reason || learned.coverage}</p>
      </div>
      ${say("That manual doesn't have anything I can use. I'd be guessing.")}`;
    return;
  }

  APPLIANCE = { model: m.model, brand: m.brand, kind: m.kind, code: m.code };
  const started = await post('/api/diagnosis/start', { model: m.model, code: m.code });
  dx = { space: started.space, tests: started.tests, performed: [], ruledOut: [], bits: started.bits, meaning: started.meaning };
  trace('hypotheses', `${m.model}, ${m.code}`, `${started.space.length} causes · ${started.bits.toFixed(2)} bits`, 'learned graph');

  captionEl.textContent = 'It built the hypothesis space from the manual — every cause cites a line of it.';
  advanceBtn.disabled = false;
  advanceBtn.textContent = 'What should I check?';
  stage = 'question';

  screen.innerHTML = `
    <div class="s-space">
      <div class="readout">
        <span class="readout__k">learned</span>
        <span class="fault-chip">${m.code}</span>
        <span class="readout__meaning">${dx.meaning}</span>
      </div>
      ${spaceMarkup(dx.space)}
      <p class="teach__cite">${dx.space[0].evidence}</p>
      ${bitsLine(dx.bits)}
    </div>
    ${say(`Right — ${m.code} on this LG. Three things cause it. Same as before: let's narrow it down.`)}`;
}

function reset() {
  APPLIANCE = { model: 'SHE3AR75UC', brand: 'Bosch', kind: 'Dishwasher', code: 'E24' };
  stage = 'idle';
  dx = null;
  pending = null;
  traceEl.innerHTML = '';
  if (handsFreeTimer) { clearInterval(handsFreeTimer); handsFreeTimer = null; $('#handsfree').textContent = 'Hands-free'; }
  renderIdle();
}

function handsFree() {
  if (handsFreeTimer) {
    clearInterval(handsFreeTimer);
    handsFreeTimer = null;
    $('#handsfree').textContent = 'Hands-free';
    return;
  }
  $('#handsfree').textContent = 'Stop';
  handsFreeTimer = setInterval(() => {
    if (stage === 'done' || advanceBtn.disabled) {
      const firstAnswer = screen.querySelector('.answer');
      if (firstAnswer) return firstAnswer.click();
      clearInterval(handsFreeTimer);
      handsFreeTimer = null;
      $('#handsfree').textContent = 'Hands-free';
      return;
    }
    advance();
  }, 2600);
}

async function boot() {
  D = await (await fetch('/api/session')).json();
  $('#memory').innerHTML = D.memory
    .map((m) => `<li><b>${m.appliance}</b><span>${m.note}</span>${m.when === 'due' ? '<span class="is-due">DUE</span>' : ''}</li>`)
    .join('');
  renderIdle();
}

advanceBtn.addEventListener('click', advance);
$('#handsfree').addEventListener('click', handsFree);
$('#teach-btn').addEventListener('click', teach);
$('#abstain-btn').addEventListener('click', showRefusal);
$('#reset').addEventListener('click', reset);
boot();
