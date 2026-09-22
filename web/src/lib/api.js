/**
 * The server, from the page.
 *
 * Every sentence this site attributes to a manufacturer came through one of these, out of a manual
 * that was actually read. Nothing here is a sample answer written to look good: if the server
 * cannot answer, the page says so in the copilot's own voice rather than filling the space.
 */

async function get(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

export const library = () => get('/api/library');
export const session = () => get('/api/session');
export const describe = (model, said) =>
  get(`/api/describe?model=${encodeURIComponent(model)}&said=${encodeURIComponent(said)}`);

export const num = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

/** A likelihood as the manual's own arithmetic, not a fabricated confidence. */
export const odds = (n) => (typeof n === 'number' ? `${Math.round(n * 100)}%` : '—');

export const money = (n) => (typeof n === 'number' ? `$${n.toFixed(2)}` : '—');
