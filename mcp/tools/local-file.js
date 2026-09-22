/**
 * Where a tool is allowed to read an image from.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `see` and `read_manual` both accept an `imagePath`, and both did
 * `fs.readFileSync(imagePath)` with nothing between the caller and the disk. `POST /api/see` passes
 * the request body straight through, and `tools/call` passes a remote client's arguments straight
 * through, so:
 *
 *     curl -X POST /api/see -d '{"imagePath":"/etc/passwd"}'
 *
 * read the file, base64'd it, and would have posted it to Bedrock. On the deployment as it stands
 * there are no AWS credentials, so the call fails before anything leaves — which is luck, not
 * design, and it stops being true the day credentials are configured. `read_manual` has a
 * `transcribe` option that returns the page's text, so the same request would have handed the file
 * back as "the manual page".
 *
 * The honest boundary is not "sanitise the path". It is: this project's images live in this project
 * and in the scratch directory its own PDF renderer writes to, and a path outside both is not a
 * photograph of somebody's dishwasher. Every real caller — `eval/run.js`, `scripts/demo.js`,
 * `scripts/learn-manual.js` — builds a path inside one of the two. Nothing else has a reason to.
 *
 * A symlink is resolved before the comparison, because a link inside the project pointing outside
 * it is the first thing anybody tries.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = path.resolve(__dirname, '..', '..');

/*
 * The scratch directory, in both the forms it answers to.
 *
 * On macOS `os.tmpdir()` is `/var/folders/…` and its real location is `/private/var/folders/…`. A
 * path that exists resolves to the second; one that does not yet — which is every path handed over
 * before the renderer has written to it — stays as the first. Comparing against only one of them
 * refused the renderer's own output.
 */
const SCRATCH = [...new Set([os.tmpdir(), (() => {
  try { return fs.realpathSync(os.tmpdir()); } catch { return os.tmpdir(); }
})()])];

/** The real location of a path, following links, without throwing on one that is not there. */
const settle = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    // It does not exist yet, or a component of it does not. Resolve as far as the text allows —
    // a caller asking about a missing file should get "no image there", not "refused".
    return path.resolve(p);
  }
};

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
function localImage(given) {
  if (typeof given !== 'string' || !given.trim()) {
    return { ok: false, reason: 'no image path was given' };
  }

  const at = settle(given);
  if (inside(at, PROJECT) || SCRATCH.some((dir) => inside(at, dir))) return { ok: true, path: at };

  return {
    ok: false,
    reason:
      'that path is outside this project, and this reads images from inside it. Send the ' +
      'photograph as `imageBase64` instead — which is what a device with a camera has anyway.',
  };
}

module.exports = { localImage, PROJECT, SCRATCH };
