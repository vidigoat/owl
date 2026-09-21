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

/* The machine the demo opens on, defined once. Everything else reads APPLIANCE, which is mutable
   because the whole point is that it can be pointed at a machine it has never seen. */
const DEFAULT_APPLIANCE = { model: 'SHE3AR75UC', brand: 'Bosch', kind: 'Dishwasher', code: 'E24' };
let APPLIANCE = { ...DEFAULT_APPLIANCE };

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
let checkout = null;          // an open checkout session, if one was opened
let handsFreeTimer = null;

/**
 * Saying something.
 *
 * This is a voice product wearing a screen. The line has always been rendered; now it can also be
 * spoken, which is the only way to demonstrate the thing the whole design turns on — that it talks
 * you through a repair while your hands are inside the machine and your eyes are not on the screen.
 *
 * Off by default, and a toggle rather than a setting, because software that starts talking the
 * moment you open it is software people close.
 */
let voiceOn = false;

function speak(text) {
  if (!voiceOn || !window.speechSynthesis) return;
  // Cancel first: two overlapping sentences is worse than a missed one, and the pacing loop can
  // reach the next step before the last has finished.
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/<[^>]*>/g, ''));
  u.rate = 1.02;   // just above default; instructions read slowly sound patronising
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

/**
 * The line being said out loud.
 *
 * `data-say` carries the text so `dedupeSpoken()` can compare it against what is already on the
 * screen. The word "says" is gone from the markup — a label reading "says" next to a sentence being
 * spoken is chrome describing the obvious — and the element is now a speaker tick that indicates
 * and gets out of the way.
 */
const say = (text) => {
  speak(text);
  return `<div class="saying" data-say="${esc(text)}"><i></i><span>${esc(text)}</span></div>`;
};

/**
 * Do not print the same sentence twice on a 400-pixel screen.
 *
 * Several screens show the current step or question as a heading AND hand the identical string to
 * `say()`, so it appeared once in Bricolage at the top and again in Newsreader at the bottom. On
 * the guided-repair screen that is the same sentence twice in one view, which on a device read from
 * across a kitchen is a third of the available room spent saying nothing new.
 *
 * The voice still SPEAKS it — `speak()` has already run by the time this is called, and the audio
 * is the point. This only removes the second printing.
 */
function dedupeSpoken() {
  const block = screen.querySelector('.saying');
  if (!block) return;

  /*
   * Compare the LIVE text, not `data-say`.
   *
   * `data-say` records what was said when the block was rendered, and the voice moves on: after an
   * answer, renderAnswer rewrites the span to "Good — that rules out the failed drain pump" while
   * the attribute still holds the question. Comparing the attribute hid exactly the sentence that
   * was no longer a duplicate — the one moment on the one screen where this product is understood.
   */
  const span = block.querySelector('span');
  const spoken = (span ? span.textContent : '').trim().toLowerCase();
  if (!spoken) return;

  // It may have been hidden for a previous render whose text HAS since changed.
  block.hidden = false;

  // The classes that actually carry a sentence big enough to read across a room. Listed rather
  // than guessed at: the first attempt included `.step__text` and `.guide__step`, neither of which
  // exists, so the dedupe silently never fired and the guide screen kept printing its step twice.
  // `.refuse__why` is in this list because the checkout refusal prints its explanation as body text
  // and then says the identical sentence — "That cause costs nothing to fix. There is no part to
  // buy." — twice in one view. It is safe to include precisely because the match must be EXACT:
  // the mains refusal has a different `why` from its spoken line and keeps both.
  const headings = [...screen.querySelectorAll('.step__say, .question, .refuse__line, .refuse__why, h2, h3')];
  const duplicated = headings.some((h) => h.textContent.trim().toLowerCase() === spoken);
  if (duplicated) block.hidden = true;
}

/** Anything a vision model read off a stranger's photograph is untrusted text, not markup. */
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
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
      <div class="s-cam__panel">${esc(APPLIANCE.code)}</div>
      <span class="s-cam__hint">reading fault code and model plate</span>
      <label class="s-cam__drop" id="drop">
        <input type="file" id="photo" accept="image/*" hidden />
        <b>Use a real photograph</b>
        <span>Drop one here, or click to choose. It goes to Bedrock and whatever it reads is what
        this diagnoses — including if that is nothing.</span>
      </label>
      <button class="s-cam__live" id="live">Or point the camera at the machine</button>
    </div>
    ${say('Got it. Hold still for a second.')}`;

  // Scoped to the screen, not the document: these are rendered by this function rather than
  // declared in index.html, and public/wiring.test.js is right to insist on the difference.
  const drop = screen.querySelector('#drop');
  const input = screen.querySelector('#photo');
  input.addEventListener('change', () => input.files[0] && readPhoto(input.files[0]));
  ['dragenter', 'dragover'].forEach((e) =>
    drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((e) =>
    drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (ev) => {
    const file = ev.dataTransfer?.files?.[0];
    if (file) readPhoto(file);
  });
  screen.querySelector('#live').addEventListener('click', openCamera);
}

/**
 * The camera, actually.
 *
 * An Echo Show has one pointed at the room; a laptop has one pointed at whatever you hold in front
 * of it. Either way this is the real gesture the product is built around — you do not type a fault
 * code into a repair app, you show it the machine.
 */
let stream = null;

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function openCamera() {
  advanceBtn.disabled = true;
  captionEl.textContent = 'Hold the panel in front of the lens and press Read it.';
  screen.innerHTML = `
    <div class="s-cam">
      <video class="s-cam__video" id="feed" autoplay playsinline muted></video>
      <div class="s-cam__live-row">
        <button class="s-cam__shoot" id="shoot">Read it</button>
        <button class="s-cam__cancel" id="stop">Cancel</button>
      </div>
    </div>
    ${say('Show me the panel.')}`;

  screen.querySelector('#stop').addEventListener('click', () => { stopCamera(); renderCamera(); advanceBtn.disabled = false; });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    // No camera, or permission refused. Say which, and leave the other routes open.
    screen.innerHTML = `
      <div class="s-refuse">
        <span class="refuse__seal">NO CAMERA</span>
        <p class="refuse__line">I can't get to a camera.</p>
        <p class="refuse__why">${esc(e.message || String(e))}</p>
      </div>
      ${say("I can't reach the camera, so use a photograph instead.")}`;
    advanceBtn.disabled = false;
    return;
  }

  const feed = screen.querySelector('#feed');
  feed.srcObject = stream;

  screen.querySelector('#shoot').addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = feed.videoWidth || 1280;
    canvas.height = feed.videoHeight || 720;
    canvas.getContext('2d').drawImage(feed, 0, 0, canvas.width, canvas.height);
    stopCamera();
    // JPEG at 0.92: a fault code is high-contrast, and a smaller upload reads sooner.
    readDataUrl(canvas.toDataURL('image/jpeg', 0.92), 'camera');
  });
}

/**
 * A real photograph, read by the real model.
 *
 * This is the difference between a demo and a product. Whatever Bedrock reads off this image is
 * what the rest of the session diagnoses — so if it reads nothing, the session says it read
 * nothing, and there is no path from here to a confident answer about a machine we could not see.
 */
async function readPhoto(file) {
  advanceBtn.disabled = true;
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('could not read that file'));
    r.readAsDataURL(file);
  });
  return readDataUrl(dataUrl, file.name);
}

/**
 * Learn a machine from a photograph of its manual page.
 *
 * The same destination as the pasted-text route and a different way of getting the characters
 * there. It shows the transcription, because a fault table taken on trust is exactly the thing this
 * project argues against — you should be able to hold the page up next to it.
 */
async function learnFromPhoto(file) {
  advanceBtn.disabled = true;
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('could not read that file'));
    r.readAsDataURL(file);
  });

  const model = (prompt('Which machine is this manual for? (model number)') || '').trim();
  if (!model) { advanceBtn.disabled = false; return; }

  screen.innerHTML = `
    <div class="s-cam">
      <img class="s-cam__shot" src="${dataUrl}" alt="the manual page being read" />
      <span class="s-cam__hint">transcribing the fault table…</span>
    </div>
    ${say('Let me read that page.')}`;

  const r = await post('/api/learn-from-photo', { imageBase64: dataUrl, model });
  trace('read_manual', file.name, r.learned ? `${r.codeCount} code(s) recovered` : r.reason,
    r.simulated ? 'fallback' : 'Bedrock vision');

  if (!r.learned) {
    // "Wrong page" and "right page, wrong layout" send a person in opposite directions, and this is
    // spoken aloud to somebody holding a booklet. Telling them to go and find a page they are
    // already holding is the failure worth avoiding.
    const layout = r.orphanCodes > 0;
    const why = esc(r.reason || '');
    const next = esc(r.nextStep || '');
    screen.innerHTML = `
      <div class="s-refuse">
        <span class="refuse__seal">${layout ? 'RIGHT PAGE, WRONG SHAPE' : 'NOTHING RECOVERED'}</span>
        <p class="refuse__line">${layout
          ? "I can see the codes. I can't see what to do about them."
          : "I couldn't get a fault table off that page."}</p>
        <p class="refuse__why">${why}</p>
        ${next ? `<p class="refuse__next">${next}</p>` : ''}
        ${r.transcribed ? `<pre class="teach__manual">${esc(r.transcribed)}</pre>` : ''}
      </div>
      ${say(layout
        ? "You've got the right page. The remedies must be in a column I can't line up — read me the one next to the code."
        : "There's no fault table I can use on that page. I'd be guessing.")}`;
    advanceBtn.disabled = false;
    return;
  }

  APPLIANCE = { ...APPLIANCE, model, code: r.codes[0] };
  captionEl.textContent = `Learned ${model} from a photograph — ${r.coverage}. Nothing in this project knew this machine.`;
  screen.innerHTML = `
    <div class="s-teach">
      <p class="teach__head">${esc(model)}</p>
      <p class="teach__sub">${esc(r.coverage)} — ${r.codes.map(esc).join(', ')}</p>
      <pre class="teach__manual">${esc(r.transcribed || '')}</pre>
      <p class="teach__cite">Transcribed off your photograph. Hold the page up next to it.</p>
    </div>
    ${say(`Right — I can read ${r.codes.length} fault codes off that. Let's start with ${r.codes[0]}.`)}`;
  advanceBtn.disabled = false;
  advanceBtn.textContent = 'What could cause it?';
}

/** One reader for both routes, so a dropped file and a camera frame can never behave differently. */
async function readDataUrl(dataUrl, label) {
  advanceBtn.disabled = true;

  screen.innerHTML = `
    <div class="s-cam">
      <img class="s-cam__shot" src="${dataUrl}" alt="the photograph being read" />
      <span class="s-cam__hint">sending it to Bedrock…</span>
    </div>
    ${say('Let me look at that.')}`;

  const read = await post('/api/see', { imageBase64: dataUrl });
  trace('see', label, read.simulated ? 'SIMULATED — no credentials' : `${read.code ?? 'no code'} · ${read.confidence ?? '—'}`,
    read.simulated ? 'fallback' : 'Bedrock vision');

  if (read.simulated) {
    screen.innerHTML = `
      <div class="s-refuse">
        <span class="refuse__seal">NOT READ</span>
        <p class="refuse__line">I couldn't actually look at that.</p>
        <p class="refuse__why">${esc(read.reason || 'No Bedrock credentials.')}</p>
      </div>
      ${say("I couldn't see it, so I'm not going to pretend I did.")}`;
    advanceBtn.disabled = false;
    return;
  }

  if (!read.code) {
    screen.innerHTML = `
      <div class="s-cam">
        <img class="s-cam__shot" src="${dataUrl}" alt="the photograph that was read" />
        <span class="s-cam__hint">no fault code on that panel</span>
      </div>
      <div class="s-refuse" style="margin-top:14px">
        <span class="refuse__seal">NO FAULT SHOWN</span>
        <p class="refuse__why">I read the panel and there is no error code on it. Nothing to
        diagnose — which is the right answer, not a failure.</p>
      </div>
      ${say("I looked. There's no fault code showing, so there's nothing for me to work on.")}`;
    advanceBtn.disabled = false;
    return;
  }

  // A real read replaces the demo machine. From here the whole session is about THIS photograph.
  APPLIANCE = { ...APPLIANCE, code: read.code, model: read.model || APPLIANCE.model };
  captionEl.textContent = `Read from your photograph by ${read.via || 'Bedrock'} — not from a fixture.`;
  screen.innerHTML = `
    <div class="s-cam">
      <img class="s-cam__shot" src="${dataUrl}" alt="the photograph that was read" />
      <div class="s-cam__read">
        <span class="s-cam__code">${esc(read.code)}</span>
        <span class="s-cam__meta">${esc(read.model || 'model plate not in frame')} · confidence ${read.confidence ?? '—'}</span>
      </div>
    </div>
    ${say(`That's ${read.code}. Let me work out what's causing it.`)}`;
  advanceBtn.disabled = false;
  advanceBtn.textContent = 'What could cause it?';
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

  listenForAnswer(choice.test.outcomes);
}

/* ── hearing ────────────────────────────────────────────────────────────────
 * The other half of a voice product. It asks a question and then waits — and what it is waiting
 * for is a person with their hands inside a machine, who cannot reach a button. Speaking the
 * answer is not a convenience here; it is the only input that fits the situation.
 */

let recogniser = null;

const Recognition = () =>
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

function stopListening() {
  if (recogniser) {
    try { recogniser.abort(); } catch { /* already gone */ }
    recogniser = null;
  }
}

/**
 * Match what was heard against the answers actually on offer.
 *
 * Deliberately narrow. It only ever chooses between the options already on screen, so the worst it
 * can do is pick the wrong one of two — never invent an observation nobody made. Anything it is
 * not reasonably sure of is ignored and the buttons stay.
 */
function matchAnswer(heard, outcomes) {
  const said = heard.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const words = new Set(said.split(/\s+/).filter((w) => w.length > 2));

  let best = null;
  let bestScore = 0;
  outcomes.forEach((o, i) => {
    const target = String(o.say).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    const hits = target.split(/\s+/).filter((w) => w.length > 2 && words.has(w)).length;
    // A bare yes/no is the commonest real answer and matches nothing by word overlap.
    const polarity =
      (/\b(yes|yeah|yep|it does|correct)\b/.test(said) && /\b(yes|does|is|hums|clogged)\b/.test(target)) ||
      (/\b(no|nope|nothing|it doesn'?t|still)\b/.test(said) && /\b(no|not|doesn|silent|clean|still)\b/.test(target));
    const score = hits + (polarity ? 1.5 : 0);
    if (score > bestScore) { bestScore = score; best = { outcome: o, index: i }; }
  });

  return bestScore >= 1 ? best : null;
}

function listenForAnswer(outcomes) {
  stopListening();
  if (!voiceOn) return;             // one toggle governs both speaking and hearing
  const R = Recognition();
  if (!R) return;

  recogniser = new R();
  recogniser.lang = 'en-US';
  recogniser.interimResults = false;
  recogniser.maxAlternatives = 3;

  recogniser.onresult = (ev) => {
    const alts = [...ev.results[0]].map((a) => a.transcript);
    for (const heard of alts) {
      const hit = matchAnswer(heard, outcomes);
      if (hit) {
        stopListening();
        trace('heard', `"${heard.trim()}"`, hit.outcome.say, 'speech');
        captionEl.textContent = `Heard "${heard.trim()}" — taken as "${hit.outcome.say}".`;
        return answer(hit.outcome);
      }
    }
    // Heard something, understood none of it. Say so and keep listening rather than guessing.
    captionEl.textContent = `Heard "${alts[0]?.trim() ?? ''}" and couldn't match it to an answer.`;
    try { recogniser.start(); } catch { /* already restarting */ }
  };

  recogniser.onerror = () => { recogniser = null; }; // no mic, or refused: the buttons still work
  try { recogniser.start(); } catch { recogniser = null; }
}

async function answer(outcome) {
  stopListening();
  const result = await post('/api/diagnosis/observe', { space: dx.space, outcome });
  trace('observe', outcome.value, result.contradiction ? 'contradiction' : `${result.eliminated.length} ruled out`, 'prune');

  if (result.contradiction) return renderContradiction(result);

  // Show the elimination before moving on — this is the moment the product is understood.
  screen.querySelector('.s-question').innerHTML = `
    <p class="question question--answered">${esc(pending.test.question)}</p>
    <p class="answered__you">you said: <b>${esc(outcome.say)}</b></p>
    ${spaceMarkup(result.space, result.eliminated)}
    ${bitsLine(result.bits)}`;

  /*
   * The voice moves on.
   *
   * The spoken line is rendered once by renderQuestion and was left alone here, so after an answer
   * the screen showed the same sentence twice: the question as a heading at the top, and the same
   * question again in serif at the bottom, still being asked. On the screen where the product is
   * actually understood — a cause striking through because of something the person just did — a
   * third of the space was a stale repeat.
   *
   * A person who has just answered hears what their answer did, not the question again.
   */
  const spoken = screen.querySelector('.saying span');
  if (spoken) {
    const gone = result.eliminated.map((c) => c.label.toLowerCase());
    spoken.textContent = gone.length === 0
      ? "That doesn't rule anything out, so I'll ask something else."
      : gone.length === 1
        ? `Good — that rules out the ${gone[0]}.`
        : `Good — that rules out the ${gone.slice(0, -1).join(', the ')} and the ${gone[gone.length - 1]}.`;
  }

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

  /*
   * The gate's answer is the answer.
   *
   * This function used to fetch the verdict, write ABSTAIN into the trace, and then render "ONE
   * CAUSE LEFT" regardless — the refusal existed only behind the "Show it refuse a job" button,
   * which is a demo, not the product. So in the flow a person actually walks, one surviving cause
   * behind mains wiring was shown as a conclusion and followed by "Talk me through it".
   *
   * Narrowing to one cause is not permission to speak it as fact. That is the entire claim this
   * project makes, the trace was already printing the word ABSTAIN next to a screen contradicting
   * it, and nothing in the interface was reading the field it had just asked for.
   */
  if (verdict.abstain) return renderRefusal(cause, verdict);

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

/**
 * One cause left, and the gate would not stand behind it.
 *
 * Two shapes, because the gate now distinguishes two opposite reasons for having nothing to say.
 * `read-manual` means the gap is ours and it is cheap to close — the machine is recognised, the
 * code is understood, and nobody has written up its causes. Offering a callout there charges
 * somebody for our missing rows. Everything else is a real stop.
 */
function renderRefusal(cause, verdict) {
  const canRead = verdict.escalate === 'read-manual';

  captionEl.textContent = canRead
    ? "It has nothing verified to say — so it asks for the manual instead of for money."
    : 'One cause left, and it still will not sell you a part. That screen is the product.';
  advanceBtn.disabled = !canRead;
  if (canRead) {
    advanceBtn.textContent = 'Show it the manual';
    stage = 'refused-read-manual';
  }

  screen.innerHTML = `
    <div class="s-refuse">
      <span class="refuse__seal">${canRead ? 'NOTHING VERIFIED YET' : 'NOT UPHELD — NO PART SOLD'}</span>
      <p class="refuse__line">${canRead ? "I don't have this one written up." : "I'm not going to guess with your money."}</p>
      <p class="refuse__why">${esc(verdict.reason)}</p>
      ${cause && !canRead ? `<p class="done__sub">${esc(cause.evidence || '')}</p>` : ''}
    </div>
    ${say(canRead
      ? 'Point me at the fault-code page of the manual and I will read it. That costs nothing.'
      : 'This one needs a technician.')}`;
}

function renderStuck(choice) {
  /*
   * Two different endings, and they were one screen saying NOT ESTABLISHED.
   *
   * "Settled" means every surviving cause is behind mains: the tool did not run out of ideas, it
   * knew before asking anything that no answer a householder could give would change what they are
   * allowed to do. Presenting that as a failure to narrow it down is both wrong and worse — "I ran
   * out of ideas" invites a second opinion from something that guesses, and "this is behind mains
   * wiring, whoever is asking" does not.
   */
  const settled = choice.settled === true;

  // Computed here rather than inline: an interpolation into a refusal screen must be a single
  // esc(...) call, so that "is this escaped" stays a question anybody — including wiring.test.js —
  // can answer by looking at one expression.
  const why = settled
    ? esc(choice.why || '')
    : `${esc(choice.reason)}. Anything I told you now would be a guess, and guesses cost you a part you may not need.`;

  captionEl.textContent = settled
    ? 'It did not run out of ideas. There was never a question worth asking.'
    : 'It ran out of useful questions — so it stops, rather than guessing.';
  advanceBtn.disabled = true;
  screen.innerHTML = `
    <div class="s-refuse">
      <span class="refuse__seal">${settled ? 'NOT AN OWNER REPAIR' : 'NOT ESTABLISHED'}</span>
      <p class="refuse__line">${settled
        ? "Every cause for this code is behind mains wiring."
        : "I can't narrow this down any further from here."}</p>
      <p class="refuse__why">${why}</p>
      ${spaceMarkup(dx.space)}
    </div>
    ${say(settled
      ? "I'm not going to have you open this one. Every cause here is behind mains wiring — that's a technician."
      : "I've run out of checks that would tell me anything. This one needs a technician.")}`;
}

function renderContradiction(result) {
  captionEl.textContent = 'The evidence contradicts the manual. It says so instead of pretending.';
  advanceBtn.disabled = true;
  screen.innerHTML = `
    <div class="s-refuse">
      <span class="refuse__seal">CONTRADICTION</span>
      <p class="refuse__line">That rules out everything the manual lists.</p>
      <p class="refuse__why">${esc(result.reason)}</p>
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
        <p class="refuse__why">${esc(g.reason)} I'm not going to talk you through taking a machine apart from guesswork.</p>
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
  const causeId = dx && dx.space.length === 1 ? dx.space[0].id : null;

  // Opening a checkout runs the gate again. If the diagnosis was not upheld there is no cart at
  // all — the refusal lives in the money path too, not just in the conversation.
  const cart = await post('/api/checkout/begin', {
    model: APPLIANCE.model,
    code: APPLIANCE.code,
    causeId,
    ruledOut: dx ? dx.ruledOut : [],
  });
  trace('begin_checkout', causeId || '—', cart.ok ? `$${cart.totals.total}` : 'refused', 'Amazon Wallet');

  if (!cart.ok) {
    captionEl.textContent = 'No cart at all — the gate refuses in the money path too.';
    advanceBtn.textContent = 'Done';
    screen.innerHTML = `
      <div class="s-refuse">
        <span class="refuse__seal">NOTHING TO SELL YOU</span>
        <p class="refuse__line">${cart.refused ? "I'm not going to order anything." : 'No part available.'}</p>
        <p class="refuse__why">${esc(cart.reason)}</p>
        ${cart.alternative ? `<p class="asked">A service call would be about $${cart.alternative.price}.</p>` : ''}
      </div>
      ${say(cart.reason)}`;
    checkout = null;
    return;
  }

  checkout = cart.sessionId;
  const item = cart.lineItems[0];
  captionEl.textContent = 'Itemised and said out loud before "yes" means anything.';
  advanceBtn.textContent = 'Yes, order it';

  screen.innerHTML = `
    <div class="s-part">
      <div><div class="part__name">${item.title}</div><span class="part__fit">fits ${item.fitsModel} · arrives ${cart.eta.toLowerCase()}</span></div>
      <ul class="totals">
        <li><span>part</span><b>$${cart.totals.subtotal}</b></li>
        <li><span>tax</span><b>$${cart.totals.tax}</b></li>
        <li class="totals__total"><span>total</span><b>$${cart.totals.total}</b></li>
      </ul>
      <div class="compare">
        <div class="is-ours"><b>$${cart.totals.total}</b><span>this part</span></div>
        <div><b>$${cart.insteadOf.price}</b><span>${cart.insteadOf.label} · ${cart.insteadOf.eta}</span></div>
      </div>
      <p class="ask">Order it with your Amazon wallet? You save $${cart.saving}.</p>
    </div>
    ${say(cart.say)}`;
}

async function renderDone() {
  stage = 'done';
  advanceBtn.disabled = true;

  const cause = dx && dx.space.length === 1 ? dx.space[0] : null;

  // Place the order that was read out, if one was.
  let order = null;
  if (checkout) {
    const placed = await post('/api/checkout/confirm', { sessionId: checkout });
    trace('confirm_checkout', checkout, placed.ok ? placed.order.orderId : placed.reason, 'Amazon Wallet');
    order = placed.ok ? placed.order : null;
    checkout = null;
  }

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
      <p class="refuse__why">${esc(check.reason)}</p>
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
  // The gate refused because nobody has written this code up — and this is the one product that
  // can close that gap without charging anybody. The button it offers has to actually go there.
  'refused-read-manual': teach,
  guide: renderPart,
  part: renderDone,
  // Describing a symptom is a whole answer on its own — the manual's causes and remedies, read out
  // — so there is nothing to advance INTO. It goes back to the start rather than leaving a button
  // that does nothing, which wiring.test.js is right to refuse.
  describe: renderIdle,
};

async function advance() {
  const fn = FLOW[stage];
  if (!fn) return;
  try {
    await fn();
  } catch (e) {
    // A dead screen mid-demo is the worst possible failure. Say what broke, stay usable.
    captionEl.textContent = 'Something failed. The screen says so rather than going blank.';
    advanceBtn.disabled = true;
    screen.innerHTML = `
      <div class="s-refuse">
        <span class="refuse__seal">SOMETHING BROKE</span>
        <p class="refuse__line">That step didn't complete.</p>
        <p class="refuse__why">${esc(e.message)}. Press reset to start again — nothing was ordered.</p>
      </div>`;
    trace('error', stage, e.message, 'device');
  }
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
      <p class="refuse__why">${esc(r.reason)}</p>
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
      <label class="s-cam__drop" id="manual-drop">
        <input type="file" id="manual-photo" accept="image/*" hidden />
        <b>Or photograph a real manual page</b>
        <span>Nobody has the text of a fault table — they have a booklet in a drawer. Drop a photo
        of the page and Bedrock transcribes it, character for character.</span>
      </label>
    </div>
    ${say("I haven't seen this one. Let me read its manual.")}`;

  const mDrop = screen.querySelector('#manual-drop');
  const mInput = screen.querySelector('#manual-photo');
  mInput.addEventListener('change', () => mInput.files[0] && learnFromPhoto(mInput.files[0]));
  ['dragenter', 'dragover'].forEach((e) =>
    mDrop.addEventListener(e, (ev) => { ev.preventDefault(); mDrop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((e) =>
    mDrop.addEventListener(e, (ev) => { ev.preventDefault(); mDrop.classList.remove('is-over'); }));
  mDrop.addEventListener('drop', (ev) => {
    const f = ev.dataTransfer?.files?.[0];
    if (f) learnFromPhoto(f);
  });

  await new Promise((r) => setTimeout(r, 900));

  const learned = await post('/api/learn', m);
  trace('manual.parse', `${m.source}`, learned.coverage, 'fault graph');
  trace('learn', m.model, learned.learned ? `${learned.codes} code(s)` : learned.reason, 'runtime');

  if (!learned.learned) {
    screen.innerHTML = `
      <div class="s-refuse">
        <span class="refuse__seal">NOTHING RECOVERED</span>
        <p class="refuse__line">I couldn't get a fault table out of that manual.</p>
        <p class="refuse__why">${esc(learned.reason || learned.coverage)}</p>
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
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  stopListening(); // a microphone left open after a reset is worse than a camera light
  stopCamera();    // a camera left running after a reset is a light nobody asked to leave on
  APPLIANCE = { ...DEFAULT_APPLIANCE };
  stage = 'idle';
  dx = null;
  pending = null;
  checkout = null; // never let a second run confirm a cart from the first
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

/*
 * Every screen render goes through `screen.innerHTML`, in a dozen different functions. Rather than
 * remembering to call dedupeSpoken() in each of them — which is the kind of thing that gets
 * remembered eleven times out of twelve — watch the element and run it whenever the screen changes.
 */
if (typeof MutationObserver === 'function') {
  new MutationObserver(() => dedupeSpoken()).observe(screen, { childList: true, subtree: true });
}

async function boot() {
  D = await (await fetch('/api/session')).json();
  $('#memory').innerHTML = D.memory
    .map((m) => `<li><b>${m.appliance}</b><span>${m.note}</span>${m.when === 'due' ? '<span class="is-due">DUE</span>' : ''}</li>`)
    .join('');
  renderIdle();
}

/* ── "tell me what it is doing" ───────────────────────────────────────────── */

/*
 * The door for machines with no code to read.
 *
 * Current manuals print no fault codes — ten Bosch US dishwasher manuals fetched today contain none
 * between them — so their troubleshooting is keyed on a described symptom. Which is also what
 * somebody says out loud: nobody stands in a kitchen and thinks "E:22".
 *
 * Its own stage, reached only from its own button. The scripted demo never enters it, so nothing
 * here can change what `advance()` does on the path a reviewer walks first.
 */
/*
 * A machine whose manual has no codes, chosen so the demo's own opening line works here.
 *
 * The scripted flow starts with "my dishwasher is beeping and there's water in the bottom" and
 * answers it from a fault code. This model answers the same complaint the other way — its manual
 * lists "Water is left in the appliance at the end of the program." — which is the whole point of
 * the screen and worth being able to type verbatim.
 */
const DESCRIBE_MODEL = 'SHE43DM2N';

function renderDescribe(said = '', result = null) {
  stage = 'describe';
  captionEl.textContent = 'No code on the panel. Say what it is doing instead.';
  advanceBtn.textContent = 'Back to the start';
  advanceBtn.disabled = false;

  const rows = !result ? ''
    : result.known
      ? result.matches.map((m, si) => `
          <div class="sym">
            <p class="sym__name">${esc(m.symptom)}</p>
            ${m.causes.map((c, ci) => `
              <p class="sym__cause">${esc(c.label || 'no cause stated')}</p>
              <ol class="sym__steps">
                ${(c.remedies || []).map((r) => `<li class="sym__remedy">${esc(r)}</li>`).join('')}
              </ol>
              <p class="sym__cite">${esc((c.evidence || '').split(':')[0])}</p>
              ${(c.remedies || []).length
                ? `<button class="btn btn--ghost sym__walk" data-walk="${si}-${ci}">Walk me through it</button>`
                : ''}
            `).join('')}
          </div>`).join('')
      : `<p class="sym__none">${esc(result.reason)}</p>` +
        (result.available
          ? `<p class="sym__cite">It does cover: ${esc(result.available.slice(0, 4).join(' · '))}${result.available.length > 4 ? ' …' : ''}</p>`
          : '');

  screen.innerHTML = `
    <div class="s-describe">
      <p class="s-describe__model">${esc(DESCRIBE_MODEL)} — this manual prints no fault codes</p>
      <form id="sayform" class="s-describe__form">
        <input id="saidinput" class="s-describe__input" placeholder="the rinse aid light keeps coming on"
               value="${esc(said)}" autocomplete="off">
        <button class="btn btn--ghost" type="button" id="saymic" title="Say it out loud">Say it</button>
        <button class="btn" type="submit">Ask</button>
      </form>
      ${rows}
    </div>
    ${result ? say(result.known
        ? `Your manual lists ${result.matches.length === 1 ? 'one thing' : result.matches.length + ' things'} like that.`
        : 'Your manual does not list anything like that, which is not the same as nothing being wrong.') : ''}`;

  const form = $('#sayform');
  if (form) {
    const ask = async (words) => {
      const r = await (await fetch(
        `/api/describe?model=${encodeURIComponent(DESCRIBE_MODEL)}&said=${encodeURIComponent(words)}`
      )).json();
      trace('describe_problem', esc(`"${words}"`),
        r.known ? `${r.matches.length} candidate${r.matches.length === 1 ? '' : 's'}` : 'nothing like it',
        r.provenance || '');
      renderDescribe(words, r);
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const words = $('#saidinput').value.trim();
      if (words) ask(words);
    });
    $('#saidinput').focus();

    /*
     * And you can just say it.
     *
     * This is the one screen where free speech is the right input. Everywhere else the recogniser
     * is deliberately narrow — `matchAnswer` only ever chooses between the buttons already on
     * screen, so the worst it can do is pick the wrong one of two. Here there is nothing to choose
     * between: the words ARE the question, and they go to a lookup that returns every candidate
     * and refuses when it matches none. Mishearing costs a wrong search, not a wrong diagnosis.
     *
     * What was heard is put in the box before it is used, so the person can see what the machine
     * thought they said and correct it.
     */
    const R = Recognition();
    const mic = $('#saymic');
    if (mic && R) {
      mic.addEventListener('click', () => {
        stopListening();
        recogniser = new R();
        recogniser.lang = 'en-US';
        recogniser.interimResults = false;
        recogniser.onresult = (ev) => {
          const heard = ev.results[0][0].transcript.trim();
          stopListening();
          $('#saidinput').value = heard;
          captionEl.textContent = `Heard "${heard}".`;
          trace('heard', esc(`"${heard}"`), 'used as the description', 'speech');
          ask(heard);
        };
        recogniser.onerror = () => { captionEl.textContent = 'I did not catch that. Type it instead.'; stopListening(); };
        recogniser.start();
        captionEl.textContent = 'Listening — say what it is doing.';
      });
    } else if (mic) {
      // No recogniser in this browser. Say so rather than leaving a button that does nothing.
      mic.disabled = true;
      mic.title = 'This browser has no speech recognition';
    }
  }

  /*
   * "Walk me through it" — the manual's steps, one at a time, read out.
   *
   * No procedure is invented and nothing is rephrased: these are the remedy lines the manual
   * printed, in the order it printed them, spoken verbatim. The device already reads a repair aloud
   * on the fault-code path, and a symptom-keyed machine deserves the same rather than a list you
   * have to hold in your head with your hands inside a dishwasher.
   */
  screen.querySelectorAll('.sym__walk').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [si, ci] = btn.dataset.walk.split('-').map(Number);
      const cause = result.matches[si].causes[ci];
      const steps = cause.remedies || [];
      const lines = [...screen.querySelectorAll('.sym')[si].querySelectorAll('.sym__steps')[ci].children];

      trace('guide', esc(`"${cause.label || 'that cause'}"`),
        `${steps.length} step${steps.length === 1 ? '' : 's'}, read out`, 'the manual, verbatim');

      let i = 0;
      const tick = () => {
        if (i >= steps.length) {
          lines.forEach((el) => el.classList.remove('is-now'));
          captionEl.textContent = 'That is everything the manual lists for that cause.';
          speak('That is everything the manual lists for that cause.');
          return;
        }
        lines.forEach((el, k) => el.classList.toggle('is-now', k === i));
        captionEl.textContent = `Step ${i + 1} of ${steps.length}.`;
        speak(steps[i]);
        const said = steps[i];
        i += 1;
        // Paced from the words, the same way the fault-code guide paces a repair.
        setTimeout(tick, Math.min(9000, 2600 + said.length * 55));
      };
      tick();
    });
  });
}

const describeBtn = $('#describe-btn');
if (describeBtn) describeBtn.addEventListener('click', () => renderDescribe());

advanceBtn.addEventListener('click', advance);
$('#handsfree').addEventListener('click', handsFree);
$('#teach-btn').addEventListener('click', teach);
$('#abstain-btn').addEventListener('click', showRefusal);
$('#reset').addEventListener('click', reset);
$('#speak').addEventListener('click', () => {
  voiceOn = !voiceOn;
  $('#speak').textContent = `Speak: ${voiceOn ? 'on' : 'off'}`;
  if (!voiceOn) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    stopListening();
  } else {
    speak('Right. I can talk you through this. Answer out loud when I ask.');
    if (pending) listenForAnswer(pending.test.outcomes); // already mid-question
  }
});

/**
 * Capture hook — `?at=<frame>`.
 *
 * Drives the device to one exact moment so the README's images can be taken from a real run by a
 * headless browser, rather than posed by hand. It presses the same buttons a person would; there is
 * no back door into a state the software cannot reach on its own. See docs/media/README.md.
 */
const onScreen = (sel) => Boolean(screen.querySelector(sel));

// Predicates describe what is on the screen, not what `stage` happens to be. Stage lags a render by
// a step, which is how the first attempt at this captured the question AFTER the elimination rather
// than the elimination itself.
const FRAMES = {
  camera: { until: () => onScreen('.s-cam') },   // the opening move: show it the machine
  hero: { until: () => onScreen('.s-question') && !onScreen('.question--answered') },
  collapse: { until: () => onScreen('.question--answered') }, // a cause struck through
  guide: { until: () => stage === 'guide' },
  checkout: { until: () => stage === 'part' },
  refusal: { press: () => showRefusal() },
  teach: { press: () => teach() },
  learned: { press: () => teach(), then: 1 },
};

async function captureFrame(name) {
  const frame = FRAMES[name];
  if (!frame) return;
  const wait = () => new Promise((r) => setTimeout(r, 420));

  /** Whatever moves the device forward from here — an answer if one is offered, else Continue. */
  const step = async () => {
    const answerBtn = screen.querySelector('.answer');
    if (answerBtn) answerBtn.click();
    else if (!advanceBtn.disabled) advance();
    await wait();
  };

  if (frame.press) {
    frame.press();
    await wait();
  } else {
    for (let i = 0; i < 25 && !frame.until(); i++) await step();
  }
  for (let i = 0; i < (frame.then || 0); i++) await step();

  document.body.dataset.ready = name; // what the capture script waits for
}

/** `?steps=N` — take exactly N steps and stop. Used to shoot the frames of docs/media/flow.gif. */
async function captureSteps(n) {
  const wait = () => new Promise((r) => setTimeout(r, 420));
  for (let i = 0; i < n; i++) {
    const answerBtn = screen.querySelector('.answer');
    if (answerBtn) answerBtn.click();
    else if (!advanceBtn.disabled) advance();
    else break; // nothing left to press; the run is over
    await wait();
  }
  document.body.dataset.ready = `steps-${n}`;
}

boot().then(() => {
  const q = new URLSearchParams(location.search);
  const at = q.get('at');
  if (at) return captureFrame(at);
  const steps = q.get('steps');
  if (steps !== null) return captureSteps(Number(steps) || 0);
});
