/*
 * The repair kit: one page, on a phone, for someone we have never met with an appliance we have
 * never seen. It drives the same tools the Alexa+ agent does — diagnose, verify, guide, watch, and
 * at the end records one outcome so we know whether it actually helped a real person.
 *
 * Everything here is deliberate about two things:
 *   - Consent first. Nothing is recorded until the person has read what will be kept and agreed.
 *     What is kept is the machine, the fault, the cause tried and whether it worked — never a photo,
 *     never who they are (public/../mcp/tools/outcome.js refuses anything that looks like identity).
 *   - It never oversells. The diagnosis is the manufacturer's own words with the page cited; a part
 *     is only offered once the gate has ruled the cheaper cause out; a step it can watch is watched,
 *     and where there is no camera vision on the host it says so and carries on by hand.
 */

const stage = document.getElementById('stage');
const el = (t, cls, html) => { const n = document.createElement(t); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const post = async (path, body) => (await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

// One session's facts, in memory only. Nothing here is sent anywhere except the calls the person triggers.
const S = { consented: false, model: null, code: null, meaning: null, causes: [], cause: null, steps: [], at: 0, watched: false };

function show(node) { stage.replaceChildren(node); window.scrollTo(0, 0); }

/* ── 1. consent ─────────────────────────────────────────────────────────── */
function consent() {
  const w = el('div');
  w.append(
    el('h1', null, 'Let’s fix it.'),
    el('p', 'lede', 'Point this at a broken appliance and it will read the manufacturer’s own manual with you, one step at a time, and only sell you a part once the cheaper cause is ruled out.'),
  );
  const c = el('div', 'card');
  c.append(el('h2', null, 'Before we start'));
  const keeps = el('ul', 'list');
  keeps.append(
    el('li', null, 'It keeps the appliance model, the fault, which cause you tried and whether it worked — so the next person with that machine is helped faster.'),
    el('li', null, 'It never keeps a photo, and never keeps anything about who you are. No name, no email, no account.'),
    el('li', null, 'A camera step, if you use one, is read and thrown away — the picture is not stored.'),
  );
  c.append(keeps);
  const go = el('button', 'btn btn--amber', 'Agree, and start');
  go.onclick = () => { S.consented = true; identify(); };
  const no = el('button', 'btn btn--quiet', 'Just look around first');
  no.onclick = () => { location.href = '/'; };
  c.append(go, no);
  w.append(c);
  show(w);
}

/* ── 2. which machine, which fault ──────────────────────────────────────── */
function identify() {
  const w = el('div');
  w.append(el('h2', null, 'Which machine?'), el('p', 'lede', 'The model number is on a sticker inside the door or on the back. Type it, and the fault code on the display if there is one.'));
  const c = el('div', 'card');
  c.append(el('label', null, 'Model number'));
  const model = el('input'); model.placeholder = 'e.g. SHE3AR75UC'; model.autocapitalize = 'characters'; model.spellcheck = false;
  c.append(model);
  c.append(el('label', null, 'Fault code on the display (leave blank if none)'));
  const code = el('input'); code.placeholder = 'e.g. E24'; code.autocapitalize = 'characters'; code.spellcheck = false;
  c.append(code);
  const go = el('button', 'btn', 'Look it up');
  const err = el('p', 'refuse hidden');
  go.onclick = async () => {
    const m = model.value.trim();
    if (!m) { err.textContent = 'A model number is needed — it is on a sticker inside the door.'; err.classList.remove('hidden'); return; }
    go.disabled = true; go.textContent = 'Looking…';
    S.model = m; S.code = code.value.trim() || null;
    try {
      const q = new URLSearchParams({ model: m }); if (S.code) q.set('code', S.code);
      const r = S.code ? await (await fetch(`/api/diagnose?${q}`)).json() : await (await fetch(`/api/describe?${q}&said=${encodeURIComponent('something is wrong')}`)).json();
      if (!r || r.known === false || (!r.causes && !r.matches)) {
        err.innerHTML = esc(r && r.reason ? r.reason : `No manual on file for ${esc(m)} yet.`) + ' You can still describe the problem in your own words.';
        err.classList.remove('hidden'); go.disabled = false; go.textContent = 'Look it up';
        return;
      }
      S.meaning = r.meaning || (r.matches && r.matches[0] && r.matches[0].symptom) || null;
      S.causes = r.causes || (r.matches && r.matches[0] && r.matches[0].causes) || [];
      S.provenance = r.provenance || null;
      diagnosis();
    } catch (e) {
      err.textContent = `Could not reach the manual just now: ${e.message}`; err.classList.remove('hidden');
      go.disabled = false; go.textContent = 'Look it up';
    }
  };
  c.append(go, err);
  w.append(c);
  show(w);
  model.focus();
}

/* ── 3. the diagnosis, in the manual's words ────────────────────────────── */
function diagnosis() {
  const w = el('div');
  w.append(el('h2', null, S.code ? `${esc(S.model)} · ${esc(S.code)}` : esc(S.model)));
  if (S.meaning) w.append(el('p', null, esc(S.meaning)));
  if (S.provenance) w.append(el('p', 'small', esc(S.provenance)));
  w.append(el('p', 'lede', S.causes.length ? 'Most likely first. Pick the one to try — start with the cheapest.' : 'The manual lists no cause for this. It will not guess.'));
  for (const [i, cause] of S.causes.entries()) {
    const c = el('div', 'card');
    const pct = typeof cause.likelihood === 'number' ? ` · ${Math.round(cause.likelihood * 100)}%` : '';
    c.append(el('h2', null, esc(cause.label || cause.id) + pct));
    if (cause.mains) c.append(el('p', 'refuse', 'This one is behind mains voltage. It is a job for a qualified person — it will not walk you into it.'));
    if (cause.evidence) c.append(el('p', 'small', esc(cause.evidence)));
    if (!cause.mains) {
      const pick = el('button', i === 0 ? 'btn' : 'btn btn--quiet', i === 0 ? 'Try this' : 'Try this instead');
      pick.onclick = () => startRepair(cause);
      c.append(pick);
    }
    w.append(c);
  }
  const stop = el('button', 'btn btn--quiet', 'None of these — I’ll stop here');
  stop.onclick = () => finish('gave-up');
  w.append(stop);
  show(w);
}

/* ── 4. the guided steps (watching, where there is a camera) ─────────────── */
async function startRepair(cause) {
  S.cause = cause; S.at = 0;
  const g = await (await fetch(`/api/guide?model=${encodeURIComponent(S.model)}&code=${encodeURIComponent(S.code || cause.id)}&causeId=${encodeURIComponent(cause.id || '')}`)).json().catch(() => null);
  S.steps = (g && g.steps) || [];
  if (!S.steps.length) {
    // No structured steps: the manual's remedy sentence stands on its own.
    S.steps = [{ n: 1, say: cause.remedy || cause.label, detail: 'The manual’s own words for this fix.' }];
  }
  step();
}

function step() {
  const s = S.steps[S.at];
  const last = S.at === S.steps.length - 1;
  const w = el('div');
  const ticks = el('div', 'ticks');
  S.steps.forEach((_, i) => { const t = el('span', 'tick'); t.dataset.on = i === S.at; t.dataset.done = i < S.at; ticks.append(t); });
  w.append(ticks);
  w.append(el('p', 'small', `Step ${S.at + 1} of ${S.steps.length}`));
  w.append(el('div', 'step', esc(s.say)));
  if (s.detail) w.append(el('div', 'detail', esc(s.detail)));

  // The camera, if the person wants it. Where the host has no vision it says so and the step goes on.
  const watchOut = el('div');
  const watchBtn = el('button', 'btn btn--quiet', 'Watch me do this step');
  watchBtn.onclick = () => watchStep(s, watchOut, watchBtn);
  w.append(watchBtn, watchOut);

  const done = el('button', 'btn btn--amber', last ? 'Done — did it work?' : 'Next step');
  done.onclick = () => { if (last) { confirmWorked(); } else { S.at += 1; step(); } };
  w.append(done);
  if (S.at > 0) { const back = el('button', 'btn btn--quiet', 'Back a step'); back.onclick = () => { S.at -= 1; step(); }; w.append(back); }
  const stop = el('button', 'btn btn--stop', 'Stop — this isn’t going right'); stop.onclick = () => finish('escalated'); w.append(stop);
  show(w);
}

async function watchStep(s, out, btn) {
  out.replaceChildren();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch (e) { out.append(el('p', 'small', e.name === 'NotAllowedError' ? 'No camera given to this page — that’s fine, carry on by hand.' : `No camera here: ${esc(e.message)}`)); return; }
  S.watched = true;
  const eye = el('div', 'eye'); const video = el('video'); video.playsInline = true; video.muted = true; eye.append(video);
  const look = el('button', 'btn', 'Have a look now');
  const say = el('div', 'said');
  out.replaceChildren(eye, look, say);
  video.srcObject = stream; await video.play();
  const before = frame(video);
  look.onclick = async () => {
    look.disabled = true; look.textContent = 'Looking…';
    const r = await post('/api/watch', { step: { text: s.say, notes: s.detail ? [s.detail] : [] }, before, now: frame(video) }).catch((e) => ({ verdict: 'unavailable', say: `Could not look: ${e.message}` }));
    say.dataset.v = r.verdict || '';
    say.textContent = r.say || '…';
    look.disabled = false; look.textContent = 'Have another look';
  };
}
function frame(video) {
  const w = Math.min(640, video.videoWidth || 640); const h = Math.round((video.videoHeight || 480) * w / (video.videoWidth || 640));
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.7);
}

/* ── 5. did it work, and record the outcome ─────────────────────────────── */
function confirmWorked() {
  const w = el('div');
  w.append(el('h2', null, 'Did that fix it?'), el('p', 'lede', 'Run the machine and see. Whatever the answer, it helps the next person with this fault.'));
  const yes = el('button', 'btn btn--amber', 'Yes — it’s working'); yes.onclick = () => finish('fixed');
  const no = el('button', 'btn btn--quiet', 'No — still faulty'); no.onclick = () => finish('not-fixed');
  w.append(yes, no);
  show(w);
}

async function finish(outcome) {
  const r = await post('/api/outcome', {
    consent: S.consented, model: S.model, code: S.code,
    causeId: (S.cause && (S.cause.id || S.cause.label)) || null,
    outcome, stepsCompleted: S.cause ? S.at + 1 : 0, ofSteps: S.steps.length || null,
  }).catch(() => ({ recorded: false }));
  const w = el('div');
  const head = { fixed: 'Fixed. Nicely done.', 'not-fixed': 'Still faulty — that’s worth knowing.', escalated: 'Stopped safely.', 'gave-up': 'No problem.' }[outcome];
  w.append(el('h1', null, head));
  if (outcome === 'not-fixed' && S.causes.length > 1) w.append(el('p', 'lede', 'The next most likely cause is worth a try, or it may be one for a technician now.'));
  if (outcome === 'escalated') w.append(el('p', 'lede', 'Some faults are behind mains voltage or need a part in hand. Calling someone is the right call, not a failure.'));
  w.append(el('p', 'small', r && r.recorded ? (r.kept ? 'Recorded — the machine, the fault and whether it worked. Nothing about you.' : 'Noted for now. This server has nowhere durable to keep it, and it says so rather than pretend.') : 'Nothing was recorded.'));
  const again = el('button', 'btn btn--quiet', 'Fix something else'); again.onclick = () => { S.model = S.code = S.cause = null; S.causes = []; S.steps = []; S.at = 0; identify(); };
  w.append(again);
  show(w);
}

consent();
