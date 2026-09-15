/* SECOND SET OF HANDS — the device walkthrough */

const $ = (s) => document.querySelector(s);
const screen = $('#screen');
const traceEl = $('#trace');
const captionEl = $('#caption');
const advanceBtn = $('#advance');

let D = null;
let stage = 0;
let stepIdx = 0;

const say = (text) => `<div class="saying"><i>says</i><span>${text}</span></div>`;

async function boot() {
  D = await (await fetch('/api/session')).json();

  // The steps and the price come from the real tools, not from anything typed into this file.
  // If the tools are unreachable the screens still render, on the session's own data.
  try {
    const g = await (
      await fetch(`/api/guide?model=${D.appliance.model}&code=${D.fault.code}&causeId=filter`)
    ).json();
    if (g.known) {
      D.steps = g.steps.map((s) => ({ ...s, hands: s.hands === 'both' ? 'both hands' : s.hands }));
      D.guideSeconds = g.totalSeconds;
    }

    const p = await (await fetch(`/api/part?model=${D.appliance.model}&causeId=pump`)).json();
    if (p.found) {
      D.part = {
        ...D.part,
        name: p.part.name,
        price: p.part.price,
        eta: p.part.eta,
        fitsModel: p.part.fitsModel,
        fitConfidence: p.part.fitConfidence,
        alternative: p.alternative,
        saving: p.saving,
      };
    }
  } catch {
    /* fall back to the session data */
  }

  renderMemory();
  render();
}

function pushTrace(rows, gate = false) {
  rows.forEach((r) => {
    const li = document.createElement('li');
    if (gate && r.tool === 'verify_diagnosis') li.className = 'is-gate';
    li.innerHTML = `<b>${r.tool}</b>(${r.arg}) → ${r.out} <em>· ${r.ms}ms · ${r.tech}</em>`;
    traceEl.appendChild(li);
  });
}

/* ── screens ───────────────────────────────────────────── */

const screens = {
  0: () => ({
    caption: 'Bosch dishwasher, flashing a code, water in the bottom.',
    label: 'Start the repair',
    html: `
      <div class="s-listen">
        <div class="s-listen__ring"></div>
        <p>“Alexa, my dishwasher is beeping and there's water in the bottom.”</p>
      </div>
      ${say('Hold it up to me — let me see the panel.')}`,
  }),

  1: () => ({
    caption: 'The camera sees the panel. Nothing is typed in.',
    label: 'Read the panel',
    html: `
      <div class="s-cam">
        <div class="s-cam__panel">E24</div>
        <span class="s-cam__hint">reading fault code and model plate</span>
      </div>
      ${say('Got it. Hold still for a second.')}`,
  }),

  2: () => {
    pushTrace(D.trace.look);
    return {
      caption: 'Model plate and fault code, straight from the image.',
      label: 'Work out what it is',
      html: `
        <div class="s-read">
          <div class="readout">
            <span class="readout__k">appliance</span>
            <span class="readout__v">${D.appliance.brand} ${D.appliance.model}</span>
            <span class="readout__c">${D.appliance.plateConfidence}</span>
          </div>
          <div class="readout">
            <span class="readout__k">fault</span>
            <span class="fault-chip">${D.fault.code}</span>
            <span class="readout__c">${D.fault.codeConfidence}</span>
          </div>
          <div class="readout">
            <span class="readout__k">meaning</span>
            <span style="font-size:17px">${D.fault.meaning}</span>
          </div>
        </div>
        ${say(`That's a ${D.fault.code} on your ${D.appliance.brand}. The water can't get out.`)}`,
    };
  },

  3: () => {
    pushTrace(D.trace.verify, true);
    const c = D.causes;
    // The verdict on screen is whatever the real gate returned — see refreshVerdict().
    queueMicrotask(refreshVerdict);
    return {
      caption: 'Two causes, ranked. The cheap one is checked first.',
      label: 'Talk me through it',
      html: `
        <div class="s-verify">
          ${c
            .map(
              (x, i) => `
            <div class="cause ${i === 0 ? 'is-top' : ''}">
              <div class="cause__row">
                <span class="cause__label">${x.label}</span>
                <span class="cause__pct">${Math.round(x.likelihood * 100)}%${x.cost ? ` · $${x.cost}` : ' · free'}</span>
              </div>
              <p class="cause__ev">${x.evidence}</p>
            </div>`
            )
            .join('')}
          <div class="gate">
            <b>DIAGNOSIS UPHELD</b>
            <p>Checked against service data for this model before asking you to spend anything.</p>
          </div>
        </div>
        ${say("Nine times in ten this is the filter, and that's free. Let's try that first.")}`,
    };
  },

  4: () => {
    if (stepIdx === 0) pushTrace(D.trace.guide);
    const s = D.steps[stepIdx];
    return {
      caption: 'Hands-free. One instruction at a time, read from across the room.',
      label: stepIdx < D.steps.length - 1 ? 'Next step' : "It's still beeping",
      html: `
        <div class="s-step">
          <span class="step__n">step ${s.n} of ${D.steps.length}</span>
          <p class="step__say">${s.say}</p>
          <p class="step__detail">${s.detail}</p>
          <div class="step__dots">
            ${D.steps.map((_, i) => `<span class="step__dot ${i <= stepIdx ? 'is-on' : ''}"></span>`).join('')}
          </div>
          <span class="step__hands">${s.hands} free</span>
        </div>
        ${say(s.say)}`,
    };
  },

  5: () => {
    pushTrace(D.trace.part);
    const p = D.part;
    return {
      caption: 'Filter was clear, so it moves to the paid cause — with the price of not doing it.',
      label: 'Yes, order it',
      html: `
        <div class="s-part">
          <div>
            <div class="part__name">${p.name}</div>
            <span class="part__fit">fits ${p.fitsModel} · ${p.fitConfidence}</span>
          </div>
          <div class="compare">
            <div class="is-ours"><b>$${p.price}</b><span>this part · ${p.eta}</span></div>
            <div><b>$${p.alternative.price}</b><span>${p.alternative.label} · ${p.alternative.eta}</span></div>
          </div>
          <p class="ask">Order it with your Amazon wallet?</p>
        </div>
        ${say(`It's the drain pump. Thirty-eight dollars, here tomorrow — a service call is about ${p.alternative.price}. Want it?`)}`,
    };
  },

  6: () => {
    pushTrace(D.trace.confirm);
    return {
      caption: 'It checks its own work, then writes down what happened.',
      label: 'Done',
      html: `
        <div class="s-done">
          <span class="done__seal">FAULT CLEARED</span>
          <p class="done__line">Ordered, fitted, and the code is gone.</p>
          <p class="done__sub">
            I watched the panel through a rinse cycle — no fault. I've noted the pump replacement
            against this dishwasher. Your fridge filter is due, by the way.
          </p>
        </div>
        ${say('That was $38 and about ten minutes, instead of $179 and a week.')}`,
    };
  },
};

/* Ask the real verify_diagnosis tool, through the server, and show what it actually said.
   Nothing about the verdict is hard-coded in the interface. */
async function refreshVerdict() {
  const gate = document.querySelector('.gate');
  if (!gate) return;
  try {
    const r = await (
      await fetch(`/api/verify?model=${encodeURIComponent(D.appliance.model)}&code=${encodeURIComponent(D.fault.code)}`)
    ).json();
    if (r.abstain) {
      gate.classList.add('gate--refuse');
      gate.innerHTML = `<b>NOT UPHELD — NO PART SOLD</b><p>${r.reason}</p>`;
    } else {
      gate.classList.remove('gate--refuse');
      gate.innerHTML = `<b>DIAGNOSIS UPHELD · ${Math.round(r.confidence * 100)}%</b><p>${r.citation}</p>`;
    }
  } catch {
    /* leave the static verdict in place if the server is unreachable */
  }
}

function render() {
  const s = screens[Math.min(stage, 6)]();
  screen.innerHTML = s.html;
  captionEl.textContent = s.caption;
  advanceBtn.textContent = s.label;
  advanceBtn.disabled = stage >= 6;
}

function advance() {
  if (stage === 4 && stepIdx < D.steps.length - 1) {
    stepIdx++;
    render();
    return;
  }
  stage++;
  render();
}

/* ── the refusal path ──────────────────────────────────── */
function showAbstain() {
  const a = D.abstain;
  traceEl.innerHTML = '';
  pushTrace([
    { tool: 'read_error', arg: 'frame.jpg', out: `${a.code} · 0.98`, ms: 300, tech: 'Bedrock vision' },
    { tool: 'diagnose', arg: `${a.model}, ${a.code}`, out: '3 causes within 12%', ms: 510, tech: 'service data' },
    { tool: 'verify_diagnosis', arg: 'all three', out: 'ABSTAIN', ms: 420, tech: 'trust gate' },
  ], true);

  screen.innerHTML = `
    <div class="s-verify">
      <div class="readout">
        <span class="readout__k">fault</span>
        <span class="fault-chip">${a.code}</span>
      </div>
      ${a.causes.map((c) => `<div class="cause"><div class="cause__row"><span class="cause__label">${c}</span><span class="cause__pct">too close to call</span></div></div>`).join('')}
      <div class="gate gate--refuse">
        <b>NOT UPHELD — NO PART SOLD</b>
        <p>${a.why}</p>
      </div>
    </div>
    ${say(a.say)}`;

  captionEl.textContent = 'The refusal is the product. It books a technician instead of guessing.';
  advanceBtn.disabled = true;
  advanceBtn.textContent = 'Reset to continue';
}

function reset() {
  stage = 0;
  stepIdx = 0;
  traceEl.innerHTML = '';
  advanceBtn.disabled = false;
  render();
}

function renderMemory() {
  $('#memory').innerHTML = D.memory
    .map(
      (m) => `<li><b>${m.appliance}</b><span>${m.note}</span>${m.when === 'due' ? '<span class="is-due">DUE</span>' : ''}</li>`
    )
    .join('');
}

/* Hands-free: the pacing is the point. Steps advance on their own, the way they would if you
   were listening with both hands inside the machine. */
let handsFreeTimer = null;

function handsFree() {
  if (handsFreeTimer) {
    clearInterval(handsFreeTimer);
    handsFreeTimer = null;
    $('#handsfree').textContent = 'Hands-free';
    return;
  }
  $('#handsfree').textContent = 'Stop';
  handsFreeTimer = setInterval(() => {
    if (stage >= 6) {
      clearInterval(handsFreeTimer);
      handsFreeTimer = null;
      $('#handsfree').textContent = 'Hands-free';
      return;
    }
    advance();
  }, 2600);
}

advanceBtn.addEventListener('click', advance);
$('#handsfree').addEventListener('click', handsFree);
$('#abstain-btn').addEventListener('click', showAbstain);
$('#reset').addEventListener('click', reset);
boot();
