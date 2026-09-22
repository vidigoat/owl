/**
 * A path from a caller is not a path a tool may read.
 *
 *   node mcp/tools/local-file.test.js
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * `see` and `read_manual` accept an `imagePath`, and both read it off the disk with nothing
 * between the caller and the filesystem. `POST /api/see` passes the request body straight through,
 * and `tools/call` passes a remote client's arguments straight through, so:
 *
 *     curl -X POST /api/see -d '{"imagePath":"/etc/passwd"}'
 *
 * read the file, base64'd it, and would have posted it to Bedrock — and `read_manual`'s
 * `transcribe` option would have handed it back as "the manual page". On the deployment as it
 * stands there are no AWS credentials, so the call fails before anything leaves. That is luck, not
 * design, and it stops being true the day credentials are configured.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { localImage, PROJECT } = require('./local-file');
const { see } = require('./see');
const { read_manual } = require('./read_manual');

let passed = 0;
const it = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n       ', e.message);
    process.exitCode = 1;
  }
};

(async () => {
  console.log('where a tool may read an image from');

  await it('a path outside the project is refused', () => {
    const outside = [
      '/etc/passwd',
      '/etc/hosts',
      path.join(os.homedir(), '.aws', 'credentials'),
      path.join(os.homedir(), '.ssh', 'id_rsa'),
      '../../../../etc/passwd',
      `${PROJECT}/../../../etc/passwd`,
      '/proc/self/environ',
    ];
    for (const p of outside) {
      const r = localImage(p);
      assert.equal(r.ok, false, `${p} was allowed`);
      assert.match(r.reason, /outside this project/);
      assert.match(r.reason, /imageBase64/, 'it does not say what to send instead');
    }
  });

  await it('the paths this project actually uses are allowed', () => {
    const inside = [
      path.join(PROJECT, 'eval', 'rendered', 'anything.png'),
      path.join(PROJECT, 'manuals', 'x.pdf'),
      'package.json',
      path.join(os.tmpdir(), 'manual-page-abc', 'p12.png'),
    ];
    for (const p of inside) {
      assert.equal(localImage(p).ok, true, `${p} was refused, and every real caller builds one of these`);
    }
  });

  await it('a symlink out of the project does not get through', () => {
    /*
     * The first thing anybody tries. The comparison is against the resolved path, not the one that
     * was typed — a link inside the project pointing at /etc is still /etc.
     */
    const dir = fs.mkdtempSync(path.join(PROJECT, '.link-test-'));
    const link = path.join(dir, 'passwd.png');
    try {
      fs.symlinkSync('/etc/passwd', link);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
      return; // no symlink permission here; the check below still holds everywhere else
    }
    try {
      const r = localImage(link);
      assert.equal(r.ok, false, 'a symlink out of the project was followed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await it('and the tools themselves refuse, rather than reading and then failing later', async () => {
    /*
     * Asserted on the tools and not only on the helper, because the helper is only worth anything
     * where it is actually called — and both of these read the file BEFORE anything else could
     * have stopped them.
     */
    const r = await see({ imagePath: '/etc/passwd' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /outside this project/, `see() said: ${r.reason}`);

    const m = await read_manual({ imagePath: '/etc/passwd', model: 'X' });
    assert.match(
      JSON.stringify(m),
      /outside this project/,
      `read_manual() said: ${JSON.stringify(m).slice(0, 160)}`
    );

    // A file that is inside but missing is still "no image there", not "refused" — they are
    // different answers and the caller does different things with them.
    const missing = await see({ imagePath: path.join(PROJECT, 'eval', 'nothing-here.png') });
    assert.match(missing.reason, /No image at/);
  });

  console.log(`\n${passed} passed`);
})();
