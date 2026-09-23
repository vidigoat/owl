/**
 * The MCP server, at the demo URL.
 *
 *   POST https://second-set-of-hands.vercel.app/mcp
 *
 * The Alexa+ track's deliverable is a self-hosted MCP server over Streamable HTTP — and until this
 * file existed it was the one part of the project a judge could not reach. The device experience was
 * deployed; the server it is built on ran only on `localhost:8793`. `/mcp` answered 404.
 *
 * One line of substance, for the reason every entry point here is one line: it serves the same
 * `serveMcp` that `npm run mcp` serves, so the URL cannot quietly drift from the repository.
 * vercel.json rewrites `/mcp` here, so the address a connector is given is the plain one.
 */
const { serveMcp } = require('../mcp/server');

module.exports = (req, res) => serveMcp(req, res);
