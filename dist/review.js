/*
 * the review bench
 *
 * Every fault code starts unticked. That is the important default and it is worth saying why:
 * a reviewer who arrives at a screen with everything pre-approved is being asked to find mistakes
 * rather than to confirm readings, and people are much worse at the first than the second. Ticking
 * five boxes takes ten seconds. Trusting five readings you did not look at takes none, which is
 * precisely the problem.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let current = null;
const accepted = new Set();

/* ── the queue ────────────────────────────────────────────────────────────── */

async function load() {
  let queue;
  try {
    queue = (await (await fetch('/api/review/queue')).json()).pending;
  } catch {
    $('empty').hidden = false;
    return;
  }

  const waiting = queue.filter((q) => !q.error);
  $('count').textContent = waiting.length
    ? `${waiting.length} machine${waiting.length === 1 ? '' : 's'} waiting`
    : '';

  if (!waiting.length) {
    $('empty').hidden = false;
    return;
  }
  await show(waiting[0].model);
}

/* ── one candidate ────────────────────────────────────────────────────────── */

async function show(model) {
  const entry = await (await fetch(`/api/review/candidate?model=${encodeURIComponent(model)}`)).json();
  if (entry.error) { $('empty').hidden = false; return; }

  current = entry;
  accepted.clear();
  $('cols').hidden = false;
  $('done').hidden = true;

  $('candName').textContent = `${entry.brand} ${entry.model}`;
  const read = entry.readWith === 'bedrock'
    ? 'read from a rendered page by a vision model'
    : 'read from the PDF text layer';
  const nCodes = Object.keys(entry.codes || {}).length;
  const nSymptoms = (entry.symptoms || []).length;
  const what = [
    nCodes ? `${nCodes} fault code${nCodes === 1 ? '' : 's'}` : null,
    nSymptoms ? `${nSymptoms} symptom${nSymptoms === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' and ') || 'nothing';
  $('candMeta').textContent =
    `${read} · pages ${entry.pages} of ${entry.source} · ${what} recovered`;

  $('evSrc').textContent = entry.source;
  $('evPages').textContent = `pages ${entry.pages}`;

  // The page, if one was kept. Otherwise the transcript, which is a weaker check and says so.
  if (entry.pageImage) {
    const img = $('page');
    img.src = `/api/review/page?model=${encodeURIComponent(entry.model)}`;
    img.alt = `Page ${entry.pages} of ${entry.source}`;
    img.hidden = false;
    $('evNone').hidden = true;
    $('evText').hidden = true;
  } else {
    $('page').hidden = true;
    $('evNone').hidden = false;
    if (entry.transcribed) {
      $('evText').textContent = entry.transcribed;
      $('evText').hidden = false;
    }
  }

  renderCodes(entry);
  renderSymptoms(entry);
  updateVerdict();
  noteIfAlreadyKnown(entry);
}

/*
 * A machine can be in the queue and in the library at once, and that is not a mistake.
 *
 * Every time the parser improves, the honest thing to do is read the manual again — and the second
 * reading arrives as a fresh candidate for a machine already admitted. A reviewer who does not know
 * that is looking at what seems to be duplicate work. Saying it turns a confusing state into the
 * normal one it actually is.
 */
async function noteIfAlreadyKnown(entry) {
  const note = $('again');
  note.hidden = true;
  try {
    const lib = await (await fetch('/api/library')).json();
    const held = lib.machines.find((m) => m.model === entry.model && m.tier === 'checked');
    if (!held) return;

    /*
     * Entries, not codes. A symptom-keyed machine has zero fault codes, and counting only those
     * made the bench announce "already in the library with 0 fault codes" about a machine holding
     * seven perfectly good symptoms.
     */
    const now = Object.keys(entry.codes || {}).length + (entry.symptoms || []).length;
    const there = held.codes + held.symptoms;
    const diff = now - there;
    note.hidden = false;
    note.innerHTML =
      `<b>${esc(entry.model)}</b> is already in the library with ${there} ` +
      `${there === 1 ? 'entry' : 'entries'}. This is a fresh reading of the same manual` +
      (diff > 0 ? `, and it found ${diff} more.` : diff < 0 ? `, and it found ${-diff} fewer.` : ' with the same rows.') +
      ` Admitting replaces what is held.`;
  } catch { /* the bench still works without it */ }
}

function renderCodes(entry) {
  const list = $('codes');
  list.textContent = '';

  for (const [code, fault] of Object.entries(entry.codes || {})) {
    const causes = fault.causes || [];
    const first = causes[0] || {};

    const li = document.createElement('li');
    li.className = 'code';
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', 'false');
    li.tabIndex = 0;

    /*
     * The quoted sentence is the whole point of this row. A reviewer is not judging whether "E22"
     * sounds plausible — they are checking that the manual on the left really says this, about this
     * code. So the manual's own words are set apart, in the reading face, and the parser's tidied
     * summary is the smaller text above it.
     */
    /*
     * A missing remedy is stated, never papered over with the reason.
     *
     * Falling back to the cause label here put the words "Constant water supply" in the quotation
     * marks where a remedy goes, which reads as the manual telling you to do something it never
     * said. The manual prints that remedy in a cell shared with the codes above; the honest line is
     * that there is none to quote.
     */
    const quote = first.remedy || '';
    const noRemedy = first.remedy == null
      ? '<p class="code-none">The manual gives this code a cause but prints no remedy beside it. ' +
        'Admitting it means the library knows what the code means and will say it cannot advise a fix.</p>'
      : '';
    const more = causes.length > 1 ? `<p class="code-more">and ${causes.length - 1} more cause${causes.length > 2 ? 's' : ''} under this code</p>` : '';

    li.innerHTML =
      `<span class="code-box" aria-hidden="true"></span>` +
      `<span>` +
        `<span class="code-name">${esc(code)}</span>` +
        `<p class="code-meaning">${esc(fault.meaning || first.label || 'no meaning was recovered')}</p>` +
        (quote ? `<p class="code-quote">“${esc(quote)}”</p>` : '') +
        noRemedy +
        (first.evidence ? `<p class="code-src">${esc(first.evidence.split(':')[0])}</p>` : '') +
        more +
      `</span>`;

    const toggle = () => {
      if (accepted.has(code)) accepted.delete(code);
      else accepted.add(code);
      li.setAttribute('aria-checked', String(accepted.has(code)));
      updateVerdict();
    };
    li.addEventListener('click', toggle);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    list.appendChild(li);
  }
}

/*
 * Symptom rows, in the same list and reviewed the same way.
 *
 * Current manuals key their troubleshooting tables on a described symptom rather than a code, so
 * for most machines this is the whole candidate.
 *
 * ── Every cause, and each one tickable ──────────────────────────────────────
 *
 * This used to show the first cause and "and 3 more listed under this", and admission was
 * all-or-nothing per symptom. That cost real facts. `SHE43DM2N` had a symptom with four causes
 * where the manual lists two — the parser had promoted "This process can take approx. 30 minutes."
 * and "The appliance is reset and restarted." to causes, because both sit flush with the column
 * boundary and flush is where a cause goes. The only way to refuse those two was to throw away the
 * two correct ones with them.
 *
 * So the causes are all shown and each is its own checkbox. Ticking the symptom ticks all of them,
 * which is what a reviewer means nine times out of ten; untick the one that is wrong and the rest
 * still go in.
 */
function renderSymptoms(entry) {
  const list = $('codes');

  for (const s of entry.symptoms || []) {
    const first = s.causes?.[0] || {};
    const li = document.createElement('li');
    li.className = 'code';
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', 'false');
    li.tabIndex = 0;

    const causes = s.causes || [];

    /*
     * A row the parser flagged as unreadable, pointed at.
     *
     * Four rows across twelve manuals come out truncated — a cause beginning mid-sentence because
     * the columns collided part-way down its symptom. The parser cannot fix them and does not
     * pretend to; the least it can do is put the reviewer's eye on the one row that needs it,
     * instead of leaving it to look like the nine that are fine.
     */
    const suspect = s.suspect || (s.causes || []).some((c) => c.suspect)
      ? '<p class="code-none code-none--suspect">This reads as cut off — the two columns ran ' +
        'together part-way down this row and the start of it was lost. Check it against the page ' +
        'before admitting it.</p>'
      : '';
    const causeRows = causes.length
      ? causes
          .map((c) => {
            const remedy = (c.remedies || [])[0] || '';
            return (
              `<li class="cause" role="checkbox" aria-checked="false" tabindex="0" data-cause="${esc(c.id)}">` +
                `<span class="code-box" aria-hidden="true"></span>` +
                `<span>` +
                  `<span class="cause-label">${esc(c.label || 'no cause stated')}</span>` +
                  (remedy ? `<p class="code-quote">“${esc(remedy)}”</p>` : '') +
                  (c.evidence ? `<p class="code-src">${esc(c.evidence.split(':')[0])}</p>` : '') +
                `</span>` +
              `</li>`
            );
          })
          .join('')
      : '<li class="cause cause--none">The parser found no cause under this one, so it cannot be admitted.</li>';

    li.innerHTML =
      `<span class="code-box" aria-hidden="true"></span>` +
      `<span>` +
        `<span class="code-name">${esc(s.symptom)}</span>` +
        suspect +
        `<ul class="causes">${causeRows}</ul>` +
      `</span>`;

    /*
     * The symptom's box is the whole row. Ticking it ticks every cause under it; unticking clears
     * them, so the two controls can never disagree about what is going in.
     */
    const setAll = (on) => {
      if (on) accepted.add(s.id);
      else accepted.delete(s.id);
      li.setAttribute('aria-checked', String(on));

      for (const c of causes) {
        if (on) accepted.add(c.id);
        else accepted.delete(c.id);
      }
      li.querySelectorAll('[data-cause]').forEach((el) => {
        el.setAttribute('aria-checked', String(on));
      });
      updateVerdict();
    };

    const toggle = (e) => {
      // A click on a cause is a click on that cause, not on the symptom that contains it.
      const row = e.target.closest?.('[data-cause]');
      if (row) return;
      setAll(!accepted.has(s.id));
    };

    li.addEventListener('click', toggle);
    li.addEventListener('keydown', (e) => {
      if (e.target !== li) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAll(!accepted.has(s.id)); }
    });

    li.querySelectorAll('[data-cause]').forEach((el) => {
      const id = el.getAttribute('data-cause');
      const flip = (e) => {
        e.stopPropagation();
        const on = !accepted.has(id);
        if (on) accepted.add(id);
        else accepted.delete(id);
        el.setAttribute('aria-checked', String(on));

        /*
         * A symptom with no cause ticked is not going in, so its own box comes off with the last
         * one — a row that still looked ticked while admitting nothing would be a lie told by a
         * checkbox.
         */
        const anyOn = causes.some((c) => accepted.has(c.id));
        if (anyOn) accepted.add(s.id);
        else accepted.delete(s.id);
        li.setAttribute('aria-checked', String(anyOn));
        updateVerdict();
      };
      el.addEventListener('click', flip);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(e); }
      });
    });

    list.appendChild(li);
  }
}

/*
 * What the button says is what is about to happen.
 *
 * `accepted` holds two kinds of id now — rows and the causes inside them — so counting its size
 * would report "Admit 12 of 5" the first time somebody ticked a symptom with four causes. Rows are
 * counted as rows; causes left out of a row that IS going in are counted separately, because
 * "admit 5 of 5, minus 2 causes" is a different decision from "admit 3 of 5" and the reviewer is
 * the one who has to recognise their own.
 */
function updateVerdict() {
  const rowIds = [
    ...Object.keys(current?.codes || {}),
    ...(current?.symptoms || []).map((s) => s.id),
  ];
  const rows = rowIds.filter((id) => accepted.has(id)).length;
  const total = rowIds.length;

  let droppedCauses = 0;
  for (const s of current?.symptoms || []) {
    if (!accepted.has(s.id)) continue;
    droppedCauses += (s.causes || []).filter((c) => !accepted.has(c.id)).length;
  }

  const btn = $('admit');
  btn.disabled = rows === 0;

  const minus = droppedCauses
    ? `, without ${droppedCauses} cause${droppedCauses === 1 ? '' : 's'}`
    : '';

  btn.textContent = rows === 0
    ? 'Select the rows that match the page'
    : rows === total
      ? `Admit all ${rows} to the library${minus}`
      : `Admit ${rows} of ${total}, reject ${total - rows}${minus}`;
}

/* ── admission ────────────────────────────────────────────────────────────── */

$('admit').addEventListener('click', async () => {
  if (!current || !accepted.size) return;
  const btn = $('admit');
  btn.disabled = true;

  const result = await (await fetch('/api/review/admit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: current.model, accept: [...accepted], by: 'bench' }),
  })).json();

  if (!result.admitted) {
    $('done').hidden = false;
    $('done').textContent = result.reason || 'Nothing was admitted.';
    btn.disabled = false;
    return;
  }

  $('done').hidden = false;
  const n = result.codes.length;
  $('done').innerHTML =
    `<b>${esc(result.model)}</b> is in the library with ${n} ` +
    `${n === 1 ? 'entry' : 'entries'} you checked against the page.` +
    (result.rejected.length
      ? ` ${result.rejected.length} ${result.rejected.length === 1 ? 'was' : 'were'} rejected and recorded.`
      : '');

  // Straight on to the next candidate, because a queue that makes you navigate back is a queue
  // people stop working through.
  setTimeout(() => { load(); loadLibrary(); }, 1400);
});

/* ── what the bench has built ─────────────────────────────────────────────── */

const HOW = {
  hand: ['written out by hand from the manual', 'how'],
  checked: ['read by a model, checked against the page', 'how--checked'],
  unchecked: ['read by a model, checked by nobody', 'how--unchecked'],
};

async function loadLibrary() {
  let data;
  try {
    data = await (await fetch('/api/library')).json();
  } catch {
    return;
  }
  if (!data.machines.length) return;

  const t = data.totals;
  $('library').hidden = false;

  /*
   * Codes and codes-with-causes are quoted separately on purpose. Several machines here carry a
   * fault code for breadth with its causes deliberately not filled in: the library knows the code
   * exists and what it means, and has nothing to say about why. Rolling those into one number would
   * be the overclaim this whole product is built to avoid.
   */
  $('libSum').innerHTML =
    `<b>${t.machines}</b> machines &mdash; <b>${t.hand}</b> written by hand, <b>${t.checked}</b> ` +
    `read and checked here` + (t.unchecked ? `, <b>${t.unchecked}</b> read and not yet checked` : '') + `. ` +
    `<b>${t.codes}</b> fault codes and <b>${t.symptoms}</b> described symptoms, of which ` +
    `<b>${t.withCauses}</b> carry causes; the rest the library can name and cannot yet explain.` +
    (t.rejected ? ` <b>${t.rejected}</b> reading${t.rejected === 1 ? ' was' : 's were'} rejected at this bench and recorded.` : '');

  const rows = $('libRows');
  rows.textContent = '';
  for (const m of data.machines) {
    const [label, cls] = HOW[m.tier] || [m.tier, 'how'];
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${esc(m.model)}</td>` +
      `<td>${esc(m.brand)}${m.kind ? ' ' + esc(m.kind.toLowerCase()) : '<span class="lib-none"> — kind not recorded</span>'}</td>` +
      `<td class="lib-n">${m.codes + m.symptoms}</td>` +
      `<td class="lib-n">${m.withCauses || '<span class="lib-none">none</span>'}</td>` +
      `<td class="${cls}">${esc(label)}` +
        (m.rejected.length ? `, ${esc(m.rejected.join(', '))} rejected` : '') +
      `</td>`;
    rows.appendChild(tr);
  }
}

load();
loadLibrary();

/* ── read a manual here ──────────────────────────────────────────────────────
 *
 * The bench reviews manuals somebody already fetched with the commands in the empty state. That
 * needs a terminal and a checkout, so anybody who has only the URL has never been able to see the
 * one capability this project exists for.
 *
 * This is that capability, from the browser: hand it a manufacturer's PDF, and the fault table
 * comes back with the page each cause is printed on. The bytes go to `/api/read-manual`, which
 * reads them and returns; nothing is stored and nothing is admitted to the library. Saying so is
 * not decoration — the review step is the part of this project worth copying, and a button that
 * quietly skipped it would be removing it.
 */
(function readAManual() {
  const drop = document.getElementById('drop');
  const file = document.getElementById('file');
  const state = document.getElementById('tryState');
  const out = document.getElementById('tryOut');
  const meta = document.getElementById('tryMeta');
  const text = document.getElementById('tryText');
  const rows = document.getElementById('tryRows');
  const note = document.getElementById('tryNote');
  if (!drop || !file) return;

  const say = (message, kind) => {
    state.textContent = message;
    state.hidden = !message;
    if (kind) state.dataset.kind = kind;
    else delete state.dataset.kind;
  };

  const el = (tag, cls, content) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content !== undefined) n.textContent = content;
    return n;
  };

  async function read(f) {
    if (!f) return;
    out.hidden = true;
    say(`Reading ${f.name} — ${(f.size / 1024 / 1024).toFixed(1)} MB…`);

    let data;
    try {
      const res = await fetch('/api/read-manual', {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: f,
      });
      data = await res.json();
    } catch (e) {
      say(`The request failed: ${e.message}`, 'refused');
      return;
    }

    if (data.error) return say(data.error, 'refused');

    if (!data.ok) {
      /*
       * A refusal, printed as a refusal.
       *
       * "No text layer" and "no fault table" are different answers and they need opposite things
       * from whoever is holding the manual — one needs a camera, the other needs a different
       * document. Collapsing them into "could not read this" is the failure this project keeps
       * writing tests against.
       */
      say(data.refused || 'This manual could not be read here.', 'refused');
      return;
    }

    say('');
    out.hidden = false;

    meta.replaceChildren();
    const facts = [
      ['pages', String(data.pages)],
      ['with a text layer', String(data.withText)],
      ['read by', data.reader === 'built-in' ? 'the built-in reader, no dependencies' : 'poppler'],
      ['took', `${data.ms} ms`],
      ['added to the library', 'nothing'],
    ];
    for (const [k, v] of facts) {
      const span = el('span', null, `${k} `);
      span.appendChild(el('b', null, v));
      meta.appendChild(span);
    }

    const best = (data.found || []).find((f2) => f2.symptoms.length) || (data.found || [])[0];
    if (!best) {
      text.textContent = '';
      rows.replaceChildren();
      note.textContent = '';
      say('No page in this manual scored as a fault table. That is an answer, not a failure — '
        + 'plenty of manuals do not print one.', 'refused');
      out.hidden = true;
      return;
    }

    text.textContent = best.text;

    rows.replaceChildren();
    for (const s of best.symptoms) {
      const li = document.createElement('li');
      li.appendChild(el('p', 'try-sym', s.symptom));
      for (const c of s.causes) {
        const box = el('div', 'try-cause');
        /*
         * A symptom whose remedies are printed with no cause above them. The manual does that, and
         * the parse reports it as a null rather than inventing a heading — which is right, and
         * rendered an empty line where a cause should be. An absence has to look like one.
         */
        box.appendChild(
          c.label
            ? el('p', 'try-cause-label', c.label)
            : el('p', 'try-cause-label try-cause-none', 'The manual lists these steps under this symptom without naming a cause.')
        );
        box.appendChild(el('p', 'try-cite', `read from page ${c.page} of the file you supplied`));
        for (const r of c.remedies || []) box.appendChild(el('p', 'try-remedy', `→ ${r.text || r}`));
        li.appendChild(box);
      }
      rows.appendChild(li);
    }

    const parts = [`Page ${best.page} of ${data.pages}, scored as a fault table.`];
    if (best.codes?.length) parts.push(`It also prints fault codes: ${best.codes.slice(0, 8).join(', ')}.`);
    if (best.refused) parts.push(best.refused);
    parts.push(data.note);
    note.textContent = parts.join(' ');
  }

  file.addEventListener('change', () => read(file.files[0]));

  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.dataset.over = 'true';
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      delete drop.dataset.over;
    });
  }
  drop.addEventListener('drop', (e) => read(e.dataTransfer?.files?.[0]));

  // The label wraps a hidden input, so a click already opens the picker. Without this the click
  // that lands on the label is forwarded to the input and opens it a second time.
  drop.addEventListener('click', (e) => {
    if (e.target === file) return;
    e.preventDefault();
    file.click();
  });
})();
