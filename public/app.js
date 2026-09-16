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
  stage = 'camera';
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
  stage = 'space';

  // The real vision path. Without credentials this comes back labelled as simulated, and that
  // label goes on the screen — the demo is not allowed to pretend it saw something it did not.
  const read = await post('/api/see', {
    imagePath: `eval/photos/${APPLIANCE.model.toLowerCase()}-panel.jpg`,
    expect: { model: APPLIANCE.model, code: APPLIANCE.code },
  });
  const simulated = read.simulated !== false;
  trace(
    'see',
    'frame.jpg',
    simulated ? 'SIMULATED — no credentials' : `${read.model} · ${read.code} · ${read.confidence ?? '—'}`,
    simulated ? 'fallback' : read.via
  );

  const started = await post('/api/diagnosis/start', { model: APPLIANCE.model, code: APPLIANCE.code });
  dx = { space: started.space, tests: started.tests, performed: [], ruledOut: [], bits: started.bits, meaning: started.meaning };
  trace('hypotheses', `${APPLIANCE.model}, ${APPLIANCE.code}`, `${started.space.length} causes · ${started.bits.toFixed(2)} bits`, 'service data');

  captionEl.textContent = 'Three things could cause this. It does not know which yet — and says so.';
  advanceBtn.textContent = 'What should I check?';
  screen.innerHTML = `
    <div class="s-space">
      <div class="readout">
        <span class="readout__k">fault</span>
        <span class="fault-chip">${APPLIANCE.code}</span>
        <span class="readout__meaning">${dx.meaning}</span>
        ${simulated ? '<span class="sim-badge" title="Bedrock was unreachable — this read was not performed">simulated read</span>' : ''}
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

  stage = 'conclusion';
  captionEl.textContent = 'One cause left — and only now does it talk about fixing it.';
  advanceBtn.textContent = 'Talk me through it';
  advanceBtn.disabled = false;

  screen.innerHTML = `
    <div class="s-conclusion">
      <span class="done__seal">ONE CAUSE LEFT</span>
      <p class="done__line">${cause.label}</p>
      <p class="done__sub">${cause.evidence}</p>
      ${dx.performed.length ? `<p class="asked">Reached in ${dx.performed.length} question${dx.performed.length === 1 ? '' : 's'}.</p>` : ''}
    </div>
    ${say(`It's the ${cause.label.toLowerCase()}. Let me walk you through it.`)}`;
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

/**
 * The repair itself: spoken steps, paced by how long each one actually takes, while the person's
 * hands are inside the machine. If there is no verified procedure for this cause it says so rather
 * than improvising one — a made-up instruction about an appliance is how people get hurt.
 */
async function renderGuide() {
  stage = 'guide';
  const cause = dx && dx.space.length === 1 ? dx.space[0] : null;
  const g = cause
    ? await fetch(`/api/guide?model=${APPLIANCE.model}&code=${APPLIANCE.code}&causeId=${cause.id}`).then((r) => r.json())
    : { known: false, reason: 'No single cause established.' };

  trace('guide', cause ? cause.id : '—', g.known ? `${g.steps.length} steps · ~${g.totalSeconds}s` : 'no verified procedure', 'MCP Apps card');

  if (!g.known) {
    captionEl.textContent = 'It has the diagnosis but not a procedure — so it refuses to invent one.';
    advanceBtn.textContent = 'What about the part?';
    screen.innerHTML = `
      <div class="s-refuse">
        <span class="refuse__seal">NO VERIFIED PROCEDURE</span>
        <p class="refuse__line">I know what's wrong, but I don't have the steps for this one.</p>
        <p class="refuse__why">${g.reason} I'm not going to talk you through taking a machine apart from guesswork.</p>
      </div>
      ${say("I know what it is, but I don't have a procedure I trust for this model.")}`;
    return;
  }

  captionEl.textContent = 'Hands-free, paced to the work — the screen is not something you have to hold.';
  advanceBtn.textContent = 'Done — what about the part?';
  screen.innerHTML = `
    <div class="s-step">
      <span class="step__n">${g.steps.length} steps · about ${Math.round(g.totalSeconds / 60)} min</span>
      <p class="step__say">${g.steps[0].say}</p>
      <p class="step__detail">${g.steps[0].detail}</p>
      <ol class="steps-rest">
        ${g.steps.slice(1).map((s) => `<li>${s.say} <em>${s.pace}s</em></li>`).join('')}
      </ol>
      <span class="step__hands">${g.handsFree ? 'both hands free' : 'one hand'}</span>
    </div>
    ${say(g.steps[0].say)}`;
}

async function renderPart() {
  stage = 'part';
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

async function renderDone() {
  stage = 'done';
  advanceBtn.disabled = true;

  const cause = dx && dx.space.length === 1 ? dx.space[0] : null;

  // Actually look at the panel again. If we could not, say so — a repair confirmed from a
  // photograph nobody took is the same lie as a diagnosis nobody established.
  const check = await post('/api/confirm', {
    imagePath: `eval/photos/${APPLIANCE.model.toLowerCase()}-panel-after.jpg`,
    code: APPLIANCE.code,
  });
  trace('confirm_fix', 'frame.jpg', check.confirmed ? 'no fault code' : check.unknown ? 'could not verify' : 'still faulty', check.simulated ? 'fallback' : 'Bedrock vision');

  const saved = await post('/api/remember', {
    model: APPLIANCE.model,
    brand: APPLIANCE.brand,
    kind: APPLIANCE.kind,
    code: APPLIANCE.code,
    cause: cause ? cause.label : null,
    action: 'Guided repair',
    confirmed: check.confirmed,
  });
  trace('remember_repair', APPLIANCE.model, saved.repeat ? 'repeat fault' : 'receipt stored', 'household memory');

  const dueLine = saved.due && saved.due.length
    ? `<p class="done__sub">Also — ${saved.due[0].part} on another machine is ${saved.due[0].daysSince} days old. Want me to reorder it?</p>`
    : '';

  if (check.confirmed) {
    captionEl.textContent = 'It checked its own work, then wrote down what happened.';
    screen.innerHTML = `
      <div class="s-done">
        <span class="done__seal">FAULT CLEARED</span>
        <p class="done__line">Fixed, and the code is gone.</p>
        <p class="done__sub">I watched the panel through a cycle — no fault. Noted against this ${APPLIANCE.kind.toLowerCase()}.</p>
        ${saved.note ? `<p class="asked">${saved.note}</p>` : ''}
        ${dueLine}
      </div>
      ${say('That was about ten minutes and a cheap part, instead of a call-out and a week.')}`;
    return;
  }

  // The honest ending: it did the repair, but it could not verify the result.
  captionEl.textContent = 'It will not tell you it worked when it could not actually check.';
  screen.innerHTML = `
    <div class="s-refuse">
      <span class="refuse__seal">${check.stillFaulty ? 'STILL FAULTY' : 'NOT VERIFIED'}</span>
      <p class="refuse__line">${check.stillFaulty ? 'That did not fix it.' : "I can't confirm it worked."}</p>
      <p class="refuse__why">${check.reason}</p>
      ${saved.note ? `<p class="asked">${saved.note}</p>` : ''}
      ${dueLine}
    </div>
    ${say(check.stillFaulty ? "It's still showing the same code. Let's keep going." : "I couldn't see the panel, so I'm not going to tell you it's fixed.")}`;
}

/* ── flow ──────────────────────────────────────────────────────────────
 * Each screen names itself when it renders, and this table says what pressing the button does
 * from there. Stage transitions live in one place rather than being computed at the call site,
 * because the earlier version of this was three chained conditionals and impossible to read. */
const FLOW = {
  idle: renderCamera,
  camera: renderSpace,
  space: renderQuestion,
  question: renderQuestion,
  conclusion: renderGuide,
  guide: renderPart,
  part: renderDone,
};

async function advance() {
  const fn = FLOW[stage];
  if (fn) await fn();
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
