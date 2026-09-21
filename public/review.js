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
  $('candMeta').textContent =
    `${read} · pages ${entry.pages} of ${entry.source} · ${Object.keys(entry.codes || {}).length} fault codes recovered`;

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
  updateVerdict();
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

function updateVerdict() {
  const total = Object.keys(current?.codes || {}).length;
  const n = accepted.size;
  const btn = $('admit');

  btn.disabled = n === 0;
  btn.textContent = n === 0
    ? 'Select the codes that match the page'
    : n === total
      ? `Admit all ${n} to the library`
      : `Admit ${n} of ${total}, reject ${total - n}`;
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
  $('done').innerHTML =
    `<b>${esc(result.model)}</b> is in the library with ${result.codes.length} fault code` +
    `${result.codes.length === 1 ? '' : 's'}: ${esc(result.codes.join(', '))}.` +
    (result.rejected.length
      ? ` ${esc(result.rejected.join(', '))} ${result.rejected.length === 1 ? 'was' : 'were'} rejected and recorded.`
      : '');

  // Straight on to the next candidate, because a queue that makes you navigate back is a queue
  // people stop working through.
  setTimeout(load, 1400);
});

load();
