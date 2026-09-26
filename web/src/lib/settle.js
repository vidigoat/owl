/**
 * When is a frame worth a look?
 *
 * Watching a repair does not mean sending video. A person doing a step moves, then stops — they
 * lift the filter out and hold it; they pull the hose and pause. The pause is the moment the
 * result is visible and the image is sharp, so that is the frame worth a Bedrock call. Everything
 * else is motion blur and money.
 *
 * So the page keeps a 32×24 grey thumbnail four times a second — a few hundred bytes that never
 * leave the browser — and asks for a look only when the picture has MOVED and then SETTLED for
 * most of a second. On top of that, never more than one look every 2.5 seconds, and at most twelve
 * a step: a step that needs more than twelve looks needs a person saying "done" instead.
 *
 * Pure, so every rule is tested without a camera.
 */

export const THUMB_W = 32;
export const THUMB_H = 24;

/** Mean absolute difference between two grey thumbnails, 0–255. */
export function difference(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** RGBA pixels (a canvas's ImageData.data) to grey, one byte a pixel. */
export function grey(rgba) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return out;
}

/**
 * The settle detector. `feed(thumbnail, time)` returns 'look' when a look is due, else null.
 * `ask(time)` is the person saying "done" or "look" — honoured if the gap allows, whatever the
 * picture is doing. `step()` starts a new step's count.
 */
export function createSettle({ move = 10, quiet = 3, quietMs = 700, minGapMs = 2500, perStep = 12 } = {}) {
  let prev = null;
  let moved = false;
  let quietSince = null;
  let lastLook = -Infinity;
  let looks = 0;

  const allowed = (t) => t - lastLook >= minGapMs && looks < perStep;
  const take = (t) => { lastLook = t; looks++; moved = false; quietSince = null; return 'look'; };

  return {
    feed(thumb, t) {
      const d = difference(prev, thumb);
      prev = thumb;
      if (!Number.isFinite(d)) return null;
      if (d > move) { moved = true; quietSince = null; return null; }
      if (d > quiet) { quietSince = null; return null; }
      if (quietSince === null) quietSince = t;
      if (moved && t - quietSince >= quietMs && allowed(t)) return take(t);
      return null;
    },
    ask(t) {
      return allowed(t) ? take(t) : null;
    },
    step() {
      looks = 0;
      moved = false;
      quietSince = null;
    },
    get looks() { return looks; },
    get left() { return Math.max(0, perStep - looks); },
  };
}
