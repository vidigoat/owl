/**
 * The hosted entry point, for every path under /api.
 *
 * A catch-all rather than a rewrite. `{"source": "/(.*)", "destination": "/api"}` does reach the
 * function, but it arrives having replaced the path with `/api` — so every route inside the server
 * sees the same pathname and falls through to "not found". `public/` is served from the filesystem
 * before rewrites are considered, so the pages come up fine and only the data is missing, which is
 * the hardest version of that to notice.
 *
 * One line, deliberately. It re-exports the same `handler` `npm start` serves rather than a second
 * copy adapted for a host — because a demo URL showing something the repository does not do is
 * worse than no demo URL at all, and a divergent copy is how that happens without anybody deciding
 * it should.
 *
 * What the hosted version cannot do, and says so rather than pretending: Bedrock vision needs AWS
 * credentials, the camera needs a device, and the spend ledger needs a writable disk. Every one of
 * those degrades to a stated refusal — see mcp/budget.js and mcp/tools/see.js — not to a plausible
 * answer.
 */
module.exports = require('../server');
