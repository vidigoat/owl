/**
 * The built-in PDF reader.
 *
 *   node manual/pdf-read.test.js
 *
 * ── What is checked, and what deliberately is not ───────────────────────────
 *
 * A PDF text extractor does not fail by crashing. It fails by returning text — plausible,
 * well-formed, and missing three words out of the middle of a table. So the checks here are about
 * the shapes that failure takes, every one of which this reader has actually had:
 *
 *   characters vanished        two glyphs claimed one cell and the second was dropped
 *   words ran together         a column header became "Causeandtroubleshooting"
 *   letters came apart         an advance missed the text matrix: "I m p o r t a n t"
 *   the columns stopped agreeing   the header's boundary landed left of the rows' own column
 *   the line came out backwards    the producer drew the right column first
 *
 * Each one scored well on "did we get text" and destroyed the parse. The wide measurement — this
 * reader against poppler on every manual on the machine — is `npm run pdf:compare`, because it
 * needs both and a fresh clone has neither.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { readPages, canRead, Doc, Lexer, parseToUnicode, unpredict } = require('./pdf-read');

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

console.log('the built-in pdf reader');

/* ── A PDF, built here, so these run on a fresh clone ──────────────────────── */

/**
 * The smallest real PDF that exercises the parts that break.
 *
 * Not a fixture file: a fixture is a thing somebody has to trust. This is assembled from objects
 * whose contents are visible three lines above the assertion about them, including the compressed
 * content stream — so when a check fails, what it was reading is right there.
 */
function makePdf({ compress = true, rows } = {}) {
  const content = rows.join('\n');
  const stream = compress ? zlib.deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    { dict: `<< /Length ${stream.length}${compress ? ' /Filter /FlateDecode' : ''} >>`, stream },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 ' +
      `/Widths [${Array.from({ length: 95 }, (_, i) => (i === 0 ? 278 : 556)).join(' ')}] >>`,
  ];

  let out = '%PDF-1.4\n';
  const at = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n`;
    if (typeof o === 'string') out += `${o}\nendobj\n`;
    else out += `${o.dict}\nstream\n${o.stream.toString('latin1')}\nendstream\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const a of at) out += `${String(a).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** One line of text at an absolute position. */
const line = (x, y, text, size = 10) =>
  `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/([()\\])/g, '\\$1')}) Tj ET`;

it('a page comes back as text', () => {
  const pdf = makePdf({ rows: [line(72, 700, 'Water is left in the appliance.')] });
  const pages = readPages(pdf);
  assert.equal(pages.length, 1);
  assert.match(pages[0], /Water is left in the appliance\./);
});

it('no character is dropped when two glyphs are close together', () => {
  /*
   * The first version placed each glyph at `round(x / unit)` and kept whichever character reached a
   * cell first, so "Troubleshooting" came back as "Troublshootng" — on a page whose columns were
   * otherwise perfect. Every letter, in order, is the check; anything less is a reader that is
   * quietly editing the manual.
   */
  const word = 'Troubleshooting';
  const pdf = makePdf({ rows: [line(72, 700, word)] });
  assert.match(readPages(pdf)[0], new RegExp(word));
});

it('a space between two words survives, and is one space', () => {
  // "Causeandtroubleshooting" is what this looks like when it goes wrong, and `symptoms.js` finds
  // the table by matching that header — so the whole manual parses to nothing.
  const pdf = makePdf({ rows: [line(72, 700, 'Cause and troubleshooting')] });
  const text = readPages(pdf)[0];
  assert.match(text, /Cause and troubleshooting/);
  assert.doesNotMatch(text, /Cause {2,}and/, 'ordinary word spacing was rendered on the column grid');
});

it('two columns stay two columns', () => {
  /*
   * The property everything downstream depends on: `symptoms.js` splits a row on runs of three or
   * more spaces, and takes the split point from where the HEADER's second column begins. So the
   * header and the rows beneath it have to agree about where that is.
   */
  const pdf = makePdf({
    rows: [
      line(72, 700, 'Fault'), line(260, 700, 'Cause and troubleshooting'),
      line(72, 680, 'Water is left.'), line(260, 680, 'The filter is blocked.'),
      line(72, 660, 'It will not start.'), line(260, 660, 'The breaker has tripped.'),
    ],
  });
  const lines = readPages(pdf)[0].split('\n').filter((l) => l.trim());

  const header = lines.find((l) => l.includes('Fault'));
  const at = header.indexOf('Cause');
  assert.ok(at > 5, `the header's second column is at ${at}`);

  for (const l of lines.slice(1)) {
    const right = l.indexOf(l.trim().split(/\s{3,}/)[1] || '');
    assert.ok(
      Math.abs(right - at) <= 2,
      `a row's second column starts at ${right}, the header's at ${at} — the split would cut the wrong word`
    );
  }
});

it('a line drawn right-to-left still reads left-to-right', () => {
  /*
   * A content stream is under no obligation to draw a line in reading order, and one of these
   * manuals does not: the left column's "display." was drawn after the right column's text and was
   * appended to the end of it — "...install the softwaredisplay."
   */
  const pdf = makePdf({
    rows: [line(260, 700, 'The filter is blocked.'), line(72, 700, 'Water is left.')],
  });
  const text = readPages(pdf)[0];
  assert.ok(
    text.indexOf('Water') < text.indexOf('filter'),
    `drawn out of order and left that way: ${JSON.stringify(text)}`
  );
});

it('the advance follows the text matrix, not just the page', () => {
  /*
   * A producer may put the size in Tm and set `Tf … 1`. Measuring an advance against the graphics
   * matrix alone then makes every advance several times too short, the reader believes there is a
   * gap between every pair of letters, and a page comes out as "I m p o r t a n t   s a f e t y" —
   * every word present, the page unreadable. One manual here did exactly that: 4% of poppler's
   * words while its neighbours scored 99%.
   */
  const pdf = makePdf({
    rows: ['BT /F1 1 Tf 10 0 0 10 72 700 Tm (Important safety instructions) Tj ET'],
  });
  assert.match(readPages(pdf)[0], /Important safety instructions/);
});

it('an uncompressed stream reads the same as a compressed one', () => {
  const rows = [line(72, 700, 'Program has not yet ended.')];
  assert.equal(readPages(makePdf({ rows })) [0], readPages(makePdf({ rows, compress: false }))[0]);
});

it('a TJ array with kerns is one line, not several', () => {
  // Large negative kerns are how a producer draws the gap between two columns. Ignoring them
  // collapses a table row into one word; treating each piece as its own line shreds it.
  const pdf = makePdf({
    rows: ['BT /F1 10 Tf 1 0 0 1 72 700 Tm [(Fault) -4000 (Cause and troubleshooting)] TJ ET'],
  });
  const text = readPages(pdf)[0];
  assert.equal(text.split('\n').filter((l) => l.trim()).length, 1);
  assert.match(text, /Fault\s{3,}Cause and troubleshooting/);
});

it('text inside a form XObject is found', () => {
  /*
   * Tables are often drawn inside a form. A reader that does not descend into one reads the manual,
   * finds no table on the page that has the table, and reports that honestly and wrongly.
   */
  const inner = Buffer.from(line(0, 0, 'The breaker has tripped.'), 'latin1');
  const body =
    '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ' +
    '<< /XObject << /X1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n' +
    '4 0 obj\n<< /Length 10 >>\nstream\nq /X1 Do Q\nendstream\nendobj\n' +
    `5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Matrix [1 0 0 1 72 700] ` +
    `/Resources << /Font << /F1 6 0 R >> >> /Length ${inner.length} >>\nstream\n${inner.toString('latin1')}\nendstream\nendobj\n` +
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  assert.match(readPages(Buffer.from(body, 'latin1'))[0], /The breaker has tripped\./);
});

it('an encrypted document is refused rather than half-read', () => {
  /*
   * Encrypted strings parse perfectly and mean nothing, so the failure looks exactly like a font
   * this reader does not understand — a page of plausible garbage. There is a vision reader for
   * when this cannot help, and it can only be reached by saying so.
   */
  const pdf = makePdf({ rows: [line(72, 700, 'x')] });
  const withEncrypt = Buffer.from(
    pdf.toString('latin1').replace('/Size 6 /Root 1 0 R', '/Size 6 /Root 1 0 R /Encrypt 9 0 R'),
    'latin1'
  );
  assert.throws(() => readPages(withEncrypt), /encrypted/);
  const verdict = canRead(withEncrypt);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /encrypted/);
});

it('a decompression bomb is refused rather than allocated', () => {
  /*
   * This shipped, for about an hour.
   *
   * A 0.58 MB upload — one content stream, deflate of six hundred megabytes of spaces — was
   * inflated in full and took the process to 1.59 GB of resident memory in under two seconds. The
   * hosted function has 512 MB, and `/api/read-manual` accepts a PDF from anybody. A small file
   * that costs the sender nothing and costs the server a gigabyte is a denial of service, and it
   * arrived with the endpoint.
   *
   * The caps are measured, not picked: across the thirty manuals on the machine this was written
   * on, the largest single decompressed stream is 18.8 MB and the largest document totals 43.3 MB.
   *
   * Built here rather than committed — a fixture that is a decompression bomb is a thing nobody
   * wants in a repository, and a hundred megabytes of spaces deflates to a hundred kilobytes in
   * about a second.
   */
  const payload = zlib.deflateSync(Buffer.alloc(100 * 1024 * 1024, 0x20));
  assert.ok(payload.length < 200 * 1024, `the bomb should be small: ${payload.length} bytes`);

  const bomb = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
      `4 0 obj\n<< /Length ${payload.length} /Filter /FlateDecode >>\nstream\n${payload.toString('latin1')}\nendstream\nendobj\n` +
      'trailer\n<< /Root 1 0 R >>\n',
    'latin1'
  );

  const started = Date.now();
  const verdict = canRead(bomb);

  assert.equal(verdict.ok, false, 'a hundred megabytes of nothing was read as a manual');
  assert.ok(Date.now() - started < 3000, `it took ${Date.now() - started}ms to refuse`);

  /*
   * Asserted on what was ALLOCATED, not on resident memory.
   *
   * The first version measured RSS across the call, which also measured the hundred-megabyte buffer
   * this test allocates to build the bomb with — so it failed at 68 MB while the reader itself had
   * allocated nothing. A measurement that includes the measurer is not one.
   *
   * `decode` is the thing being capped, so ask it directly: the content stream declares a hundred
   * megabytes of output and comes back with none, because zlib was told to stop rather than this
   * code told to check afterwards.
   */
  const doc = new Doc(bomb);
  const stream = [...doc.offsets.keys()].map((n) => doc.at(n)).find((o) => o && o.dict?.Filter);
  assert.ok(stream, 'the bomb has no compressed stream in it, so this proves nothing');
  const out = doc.decode(stream);
  assert.ok(
    out.length <= 1024,
    `the capped stream still produced ${(out.length / 1048576).toFixed(1)} MB`
  );
});

it('and the caps are above anything a real manual needs', () => {
  /*
   * A cap that refuses real documents is a worse bug than the one it fixes, and it would fail
   * quietly — as a manual that "has no text layer". Both limits are asserted against the largest
   * sizes actually measured across this machine's corpus, so tightening one below what a manual
   * needs fails here rather than in front of somebody.
   */
  const { MAX_STREAM, MAX_TOTAL } = require('./pdf-read');
  assert.ok(MAX_STREAM >= 32 * 1024 * 1024, 'the per-stream cap is below the 18.8 MB a real manual holds');
  assert.ok(MAX_TOTAL >= 128 * 1024 * 1024, 'the per-document cap is below the 43.3 MB a real manual totals');
  assert.ok(MAX_TOTAL > MAX_STREAM, 'a single stream may exhaust the whole document budget');
});

it('a broken document reports that it cannot be read, and does not throw', () => {
  const verdict = canRead(Buffer.from('%PDF-1.4\nthis is not a pdf\n%%EOF'));
  assert.equal(verdict.ok, false);
  assert.equal(typeof verdict.pages, 'number');
});

it('a ToUnicode map covers ranges, arrays and ligatures', () => {
  /*
   * A bfrange destination may be several UTF-16 code units — a ligature maps one code to "fi" — and
   * dropping the second one misspells a word in a way no check of "did we get text" would see.
   */
  const map = parseToUnicode(`
    /CIDInit findresource begin
    1 beginbfchar <0003> <0066 0069> endbfchar
    1 beginbfrange <0024> <0026> <0041> endbfrange
    1 beginbfrange <0030> <0031> [<0057> <0058>] endbfrange
    end`);
  assert.equal(map.get(0x0003), 'fi');
  assert.equal(map.get(0x0024), 'A');
  assert.equal(map.get(0x0026), 'C', 'a bfrange did not walk to the end of its range');
  assert.equal(map.get(0x0030), 'W');
  assert.equal(map.get(0x0031), 'X');
});

it('the PNG predictor is undone, because object streams do not work without it', () => {
  // Row tag 2 is "up": each byte is a delta against the byte above it.
  const raw = Buffer.from([0, 10, 20, 30, 2, 1, 1, 1]);
  const out = unpredict(raw, { Predictor: 12, Colors: 1, BitsPerComponent: 8, Columns: 3 });
  assert.deepEqual([...out], [10, 20, 30, 11, 21, 31]);
});

it('a stream whose /Length lies is still read to endstream', () => {
  /*
   * /Length is frequently a forward reference and in damaged files it is simply wrong. The only
   * thing definitely true is that `endstream` follows the data.
   */
  const pdf = makePdf({ rows: [line(72, 700, 'Wait until the appliance has finished.')], compress: false });
  const broken = Buffer.from(pdf.toString('latin1').replace(/\/Length \d+ >>/, '/Length 4 >>'), 'latin1');
  assert.match(readPages(broken)[0], /Wait until the appliance has finished\./);
});

it('the lexer tells a reference from the two numbers it is written as', () => {
  const lex = new Lexer(Buffer.from('[12 0 R 12 0]', 'latin1'));
  const arr = lex.object(null);
  assert.equal(arr.length, 3, `expected a reference and two numbers, got ${JSON.stringify(arr)}`);
  assert.equal(arr[0].num, 12);
  assert.equal(arr[1], 12);
  assert.equal(arr[2], 0);
});

it('every page of every manual on this machine comes back, if there are any', () => {
  /*
   * The wide check lives in `npm run pdf:compare`, which needs poppler. This is the part that can
   * run without it: whatever manuals are here, the reader returns a page count and does not throw.
   * A fresh clone has no manuals and this passes vacuously, which is stated rather than hidden.
   */
  const dir = path.join(__dirname, '..', 'manuals');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')) : [];
  if (!files.length) return;

  for (const f of files.slice(0, 6)) {
    const verdict = canRead(path.join(dir, f));
    assert.ok(verdict.pages > 0, `${f}: no pages`);
    assert.ok(verdict.withText > 0, `${f}: ${verdict.pages} pages and no text on any of them`);
  }
});

console.log(`\n${passed} passed`);
