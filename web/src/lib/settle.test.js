/**
 * The settle detector decides when watching costs a Bedrock call. Every rule here is money or a
 * missed moment, so each is pinned.
 *
 * Run: node web/src/lib/settle.test.js
 */
import assert from 'node:assert';
import { createSettle, difference, grey, THUMB_W, THUMB_H } from './settle.js';

let passed = 0;
const it = (name, fn) => {
  try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n       ', e.message); process.exitCode = 1; }
};

const N = THUMB_W * THUMB_H;
const flat = (v) => new Uint8Array(N).fill(v);

console.log('settle');

it('a picture that never moves is never looked at — an idle camera costs nothing', () => {
  const s = createSettle();
  let looks = 0;
  for (let t = 0; t < 60000; t += 250) if (s.feed(flat(100), t)) looks++;
  assert.equal(looks, 0);
});

it('movement, then most of a second of stillness, is one look — the moment the result is visible', () => {
  const s = createSettle();
  const events = [];
  let t = 0;
  s.feed(flat(100), t);
  for (let i = 0; i < 6; i++) { t += 250; events.push(s.feed(flat(i % 2 ? 100 : 160), t)); } // hands moving
  for (let i = 0; i < 6; i++) { t += 250; events.push(s.feed(flat(130), t)); } // held still
  assert.equal(events.filter(Boolean).length, 1);
  // The first still frame still differs from the last moving one; stillness is counted from the
  // frame after it, and the look comes once 700 ms of it have passed — the fifth still frame.
  assert.equal(events.indexOf('look'), 6 + 4, 'looked before the picture had been still for 700 ms');
});

it('a person who keeps moving is not interrupted mid-movement', () => {
  const s = createSettle();
  let looks = 0;
  for (let t = 0; t < 10000; t += 250) if (s.feed(flat((t / 250) % 2 ? 60 : 200), t)) looks++;
  assert.equal(looks, 0);
});

it('never more than one look every 2.5 s, and never more than twelve a step', () => {
  // Every round settles (a move, then 1.5 s still) every 1.75 s — faster than the gap allows.
  const gap = createSettle();
  const at = [];
  let u = 0;
  for (let round = 0; round < 8; round++) {
    gap.feed(flat(200), (u += 250));
    for (let i = 0; i < 6; i++) if (gap.feed(flat(100), (u += 250))) at.push(u);
  }
  assert.ok(at.length >= 3, `only ${at.length} looks in 14 s of settling — the check below would pass on nothing`);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 2500, `two looks ${at[i] - at[i - 1]} ms apart`);
  const s = createSettle({ perStep: 12 });
  let looks = 0;
  let t = 0;
  for (let round = 0; round < 40; round++) {
    s.feed(flat(200), (t += 250));
    for (let i = 0; i < 6; i++) if (s.feed(flat(100), (t += 250))) looks++;
  }
  assert.equal(looks, 12, `${looks} looks in one step`);
  assert.equal(s.left, 0);
  s.step();
  assert.equal(s.left, 12, 'a new step did not get its own allowance');
});

it('"done" from the person is honoured whatever the picture is doing — but still within the gap', () => {
  const s = createSettle();
  assert.equal(s.ask(10000), 'look');
  assert.equal(s.ask(11000), null, 'two looks inside 2.5 s');
  assert.equal(s.ask(12600), 'look');
});

it('grey and difference: one byte a pixel, and a different-sized frame is not comparable', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  assert.deepEqual([...grey(rgba)], [255, 0]);
  assert.equal(difference(flat(10), flat(14)), 4);
  assert.equal(difference(flat(10), new Uint8Array(3)), Infinity);
});

console.log(`\n${passed} passed`);
