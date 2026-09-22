/**
 * Finding the fault table in a manual.
 *
 *   node manual/pdf.test.js
 *
 * Every assertion here exists because a real Bosch dishwasher manual, downloaded from Bosch's own
 * CDN, defeated the first version of this file completely. Three fixtures written from imagination
 * had all worked; the real document scored its fault table at 11 against a threshold of 12 and the
 * pipeline recovered nothing from a 53-page manual.
 *
 * The reason is worth stating because it shapes everything below: **the fault codes in a real
 * manual do not survive text extraction.** They are set in a seven-segment display face, and that
 * face maps its glyphs to whatever codepoints the foundry chose, so `E:24` comes out of the PDF as
 * `“:‹ˆ`. Any scorer that looks for codes finds none. What survives is SHAPE — the page is a table,
 * whatever the font did to it.
 *
 * Nothing here needs a PDF on disk: the scoring functions take text, which is the part that has to
 * be right.
 */

const assert = require('node:assert');
const pdf = require('./pdf');

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

/** A real fault table, as `pdftotext -layout` actually returns one. Codes mangled, columns intact. */
const REAL_TABLE = `                                                              Fault, what to do? en

Fault table
Fault                      Reason                              Remedial action
Fault code “:‹ˆ is lit.    Intake opening (on right inside of  Arrange utensils so that the intake
                           appliance) covered by utensils.     opening is not obstructed.
Fault code “:‚ƒ is lit.    Heating element calcified or        Clean appliance with dishwasher cleaning
                           soiled.                             agent or descaler.
Fault code “:‚… is lit.    Water protection system             Turn off water supply.
                           activated.                          Call customer service.
Fault code “:ƒƒ is lit.    Filters are soiled or               Clean filters.
                           blocked.`;

/** A page that talks ABOUT errors without being a table. The commonest false positive. */
const PROSE = `Safety information

Read these instructions carefully. Failure to observe them may result in an error being
displayed on the appliance. If an error code appears, do not attempt to repair the appliance
yourself. Contact customer service. Errors caused by incorrect installation are not covered
by the warranty. Check that the appliance has been installed by a competent person.`;

console.log('finding the fault table');

/* ── shape beats vocabulary ──────────────────────────────────────────────── */

it('a real fault table outscores a page that merely discusses errors', () => {
  const table = pdf.scorePage(REAL_TABLE);
  const prose = pdf.scorePage(PROSE);
  assert.ok(
    table.score > prose.score * 1.5,
    `table ${table.score} vs prose ${prose.score} — vocabulary is winning over shape`
  );
});

it('the real table scores even though not one code is readable', () => {
  /*
   * The whole lesson. `codeLines` is zero here — the display font destroyed every code — and the
   * page still has to be found, because the codes are recoverable later from a rendered image.
   */
  const s = pdf.scorePage(REAL_TABLE);
  assert.equal(s.codeLines, 0, 'the fixture no longer represents a font-mangled manual');
  assert.ok(s.score >= 18, `scored ${s.score}; the default threshold would miss it`);
  assert.ok(s.columnar >= 5, 'the column structure was not detected');
});

it('columns are what survive', () => {
  assert.equal(pdf.COLUMNAR('Fault code E24     Hose kinked     Straighten the hose'), true);
  assert.equal(pdf.COLUMNAR('This is an ordinary sentence of prose in a manual.'), false);
  assert.equal(pdf.COLUMNAR(''), false);
  // Two spaces is word spacing after a full stop; three or more is a column.
  assert.equal(pdf.COLUMNAR('One sentence.  Another sentence.'), false);
});

/* ── knowing when the text cannot be trusted ─────────────────────────────── */

it('a font-mangled page is recognised as such', () => {
  /*
   * This flag is what sends the page to a vision model instead of a parser. Without it the
   * pipeline would parse the text layer, recover nothing, and report "no fault table" about a page
   * that plainly has one.
   */
  assert.equal(pdf.looksGarbled(REAL_TABLE), true, 'the mangled codes were not noticed');
  assert.equal(pdf.looksGarbled(PROSE), false, 'ordinary prose was called garbled');
});

it('normal typography is not mistaken for mangling', () => {
  // A manual uses real quotation marks and apostrophes. It does not use forty of them on one page.
  const quoted = `The display shows "Check water supply". Don't open the door.
See "Water softening system" on page 15. The appliance's filter needs cleaning.`;
  assert.equal(pdf.looksGarbled(quoted), false, 'curly quotes alone triggered the garbled flag');
});

/* ── tables that run across a page break ─────────────────────────────────── */

it('consecutive pages are joined before parsing', () => {
  // A table spanning 39–40 parsed as two pages splits a code from its remedies at the seam.
  const joined = pdf.joinAdjacent([
    { page: 40, text: 'second half', score: 41 },
    { page: 39, text: 'first half', score: 33 },
  ]);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].from, 39);
  assert.equal(joined[0].to, 40);
  /*
   * A form feed at the seam, which is `pdftotext`'s own page separator and the thing `pages()`
   * split on. Joined with a bare newline the boundary was gone, so a parser reading the run could
   * only cite the page it started on — and every row on pages two onwards carried the first page's
   * number. An owner sent to page 38 for a sentence printed on page 39 has a wrong citation, which
   * is the one thing a citation must not be.
   */
  assert.equal(joined[0].text, 'first half\n\fsecond half', 'the halves were joined out of order');
  assert.equal(joined[0].score, 74);
});

it('pages that are not adjacent stay apart', () => {
  const joined = pdf.joinAdjacent([
    { page: 12, text: 'a', score: 20 },
    { page: 40, text: 'b', score: 30 },
  ]);
  assert.equal(joined.length, 2);
  assert.equal(joined[0].from, 40, 'runs are not ordered by score');
});

it('a single candidate is a run of one', () => {
  const joined = pdf.joinAdjacent([{ page: 7, text: 'x', score: 19 }]);
  assert.deepEqual(joined, [{ from: 7, to: 7, text: 'x', score: 19 }]);
});

/* ── honesty about the tool ──────────────────────────────────────────────── */

it('availability is reported rather than assumed', () => {
  // This shells out to poppler. That is not an npm dependency, but it IS something that has to
  // exist on the machine, and every caller is expected to degrade rather than crash.
  assert.equal(typeof pdf.available(), 'boolean');
});

it('an empty page scores zero and is not garbled', () => {
  const s = pdf.scorePage('');
  assert.equal(s.score, 0);
  assert.equal(s.garbled, false);
  assert.equal(pdf.scorePage(undefined).score, 0);
});

/* ── the manual that is not in English ───────────────────────────────────── */

/*
 * The same Bosch dishwasher, French edition. Real: document 9001234568 from Bosch's own CDN, page
 * 42. Same appliance, same table, same display-font mangling — different words.
 *
 * Manufacturers publish one document per language, so a scraper pointed at a manufacturer's CDN
 * collects these by the dozen. They are not corrupt files and they are not missing their tables;
 * they are simply unreadable to an English verb list, and the pipeline has to say which.
 */
const FRENCH_TABLE = `                                                      Dérangement, que faire ? fr

Tableau des dérangements
Dérangement                 Cause                              Solution
Code d'erreur “:ƒƒ          Filtres 1Z encrassés ou            Nettoyez les filtres.
apparaît.                   bouchés.
Code d'erreur “:‚ƒ          Résistance entartrée ou            Nettoyez l'appareil avec un produit
apparaît.                   encrassée.                         de nettoyage pour lave-vaisselle.
Code d'erreur “:‚…          Système de sécurité contre         Fermez le robinet d'eau.
apparaît.                   les dégâts d'eau activé.           Appelez le service après-vente.`;

it('a French fault table scores like the English one — language is not a penalty', () => {
  /*
   * The real assertion, and the reason it is a comparison rather than a threshold. This file claims
   * to score SHAPE rather than vocabulary; an English-only verb list made that claim false without
   * making any test fail, because the English fixtures all passed. Measured on Bosch's own French
   * edition the same table scored 27 against the English edition's 41 — a third of the page's score
   * lost to nothing but its language, and close enough to the floor that a shorter table would have
   * been missed outright.
   *
   * Holding the two fixtures against each other is what catches that coming back. A threshold would
   * not have: 27 cleared it.
   */
  const fr = pdf.scorePage(FRENCH_TABLE);
  const en = pdf.scorePage(REAL_TABLE);
  assert.ok(fr.columnar >= 5, 'the column structure was not detected');
  assert.equal(fr.heading, true, 'the French heading was not recognised');
  assert.ok(
    fr.score >= en.score * 0.8,
    `French ${fr.score} vs English ${en.score} — the scorer is reading vocabulary, not shape`
  );
});

it('and it is reported as not English, so the failure can be explained', () => {
  // The pipeline uses this to skip a vision call that would cost money and change nothing.
  assert.equal(pdf.scorePage(FRENCH_TABLE).english, false);
  assert.equal(pdf.scorePage(REAL_TABLE).english, true);
});

it('language detection does not refuse short or empty pages', () => {
  // It only ever explains a failure. Defaulting an unknowable page to "not English" would suppress
  // the vision call that is the whole reason the expensive path exists.
  assert.equal(pdf.probablyEnglish(''), true);
  assert.equal(pdf.probablyEnglish('E24'), true);
});

it('a German heading counts too', () => {
  assert.equal(pdf.scorePage('Fehlercode-Tabelle\nE24    Zulauf    Prüfen').heading, true);
});

/* ── a manual that documents symptoms and prints no codes ────────────────── */

/*
 * Real, from a current Bosch US dishwasher manual. Measured across ten of them: every one carries
 * ten to thirteen pages headed `Fault | Cause and troubleshooting`, and not one contains a fault
 * code. The left column is a described symptom where the 2019 European manual for the same kind of
 * machine says "Fault code E:07 is lit."
 */
const SYMPTOM_TABLE = `                                                      Troubleshooting   en-us
Fault                     Cause and troubleshooting
Excessive formation of    Rinse aid has been spilled.
foam occurs.                 Remove the rinse aid with a cloth.
                          Detergent used causes excessive foaming.
                             Change the brand of detergent.
All LEDs light up or      Electronics have detected a fault.
flash.                       Press the main switch button for approx. 4 seconds.
                             Switch off the appliance.
                             Contact customer service.`;

it('a troubleshooting table with no codes is recognised as one', () => {
  /*
   * A fact about what manufacturers publish, not a parsing failure, and the two must not report the
   * same way. "I could not read this page" sends somebody looking for a better scan. "This manual
   * documents symptoms and prints no codes" tells them the codes are in the repair documentation,
   * which is a different and findable thing.
   */
  assert.equal(pdf.symptomTable(SYMPTOM_TABLE), true);
  assert.equal(pdf.scorePage(SYMPTOM_TABLE).symptomsOnly, true);
});

it('a table that has the heading AND codes is not symptoms-only', () => {
  // Both halves matter: a manual can head a table "Cause and troubleshooting" and still list codes
  // down the left of it, and that one is worth every vision call it takes.
  const withCodes = SYMPTOM_TABLE.replace('Excessive formation of', 'Fault code E:07 is lit.   ');
  assert.equal(pdf.symptomTable(withCodes), false);
});

it('a page that carries the column header outranks one that merely looks like a table', () => {
  /*
   * Found by dropping a real oven manual on the bench and getting nothing.
   *
   * `CM585AGS1B` prints its fault table on pages 20 and 21, headed `Fault | Cause and
   * troubleshooting`. They scored 28 and 34. A page of default oven settings — three columns, a
   * dozen imperative verbs, no fault table anywhere on it — scored 37 on shape alone and took the
   * top slot, and the four candidates went to pages with no table on them. The manual came back as
   * "no column header on this page", which was true of the pages it was handed and false of the
   * manual.
   *
   * Shape is the right way to find a table in a manual that never uses the word, and it is also
   * what a settings table looks like. The header is not one signal among several — `symptoms.js`
   * already says why: a table says it is a table at the top of itself.
   */
  const headed = [
    'Fault                          Cause and troubleshooting',
    'The appliance is not working.  The mains plug is not plugged in.',
    '                                  Plug the appliance in.',
    'The oven does not heat.        Demo mode is activated.',
    '                                  Switch demo mode off.',
  ].join('\n');

  // Wider, denser, more verbs, and not a fault table.
  const settings = [
    'Setting                        Meaning                          Default',
    ...Array.from({ length: 30 }, (_, i) =>
      `Option ${i}                       Check the value and adjust it    Clean after use`),
  ].join('\n');

  const a = pdf.scorePage(headed);
  const b = pdf.scorePage(settings);
  assert.equal(a.heading, true, 'the headed table was not recognised as headed');
  assert.equal(b.heading, false, 'the settings table claimed a fault-table header');
  assert.ok(b.score > a.score, `this test proves nothing unless the decoy outscores the table (${b.score} vs ${a.score})`);

  const picked = pdf.rank([settings, headed]);
  assert.equal(picked[0].page, 2, 'the settings table was ranked above the real fault table');
});

it('the real fault table is never mistaken for a symptom table', () => {
  assert.equal(pdf.symptomTable(REAL_TABLE), false, 'a manual full of fault codes was called symptom-keyed');
  assert.equal(pdf.symptomTable(PROSE), false);
  assert.equal(pdf.symptomTable(''), false);
});

it('it still reads as a table, because it is one', () => {
  /*
   * The page is found either way — on the real manuals these excerpts come from it scored 33
   * against a threshold of 18. What changes is what the pipeline does with it and what it says.
   *
   * Asserted on the structure rather than on the total, because a ten-line excerpt of a full page
   * scores 15 and that is a fact about the fixture, not about the scorer.
   */
  const s = pdf.scorePage(SYMPTOM_TABLE);
  assert.ok(s.columnar >= 5, 'the column structure was not detected');
  assert.equal(s.heading, true);
  assert.ok(s.remedyLines >= 3, 'the remedies were not seen');
});

console.log(`\n${passed} passed`);
