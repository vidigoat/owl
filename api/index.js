/**
 * The hosted entry point.
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
