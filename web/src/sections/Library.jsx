import { useMemo, useState } from 'react';
import { WashingMachine, MessageSquareText, FileSearch, ShieldX, Search } from 'lucide-react';
import { num } from '../lib/api.js';

/**
 * ── The library ─────────────────────────────────────────────────────────────
 *
 * Every machine Owl can answer for, as a table: filter by maker, search by model number, a dozen
 * rows at a time. What a visitor wants from it is "is mine in here?", so the search box comes first
 * and the rest opens on request.
 *
 * Codes and symptoms are counted separately, and a machine with none of a kind gets a dash rather
 * than a nought: the hand-entered washers translate one fault code and go no further, and "0 causes"
 * would make an honest small thing look like a padded row.
 */

const SHOWN = 12;
const TIER = { checked: ['Checked', 'ok'], hand: ['By hand', 'hand'] };

export default function Library({ lib }) {
  const [maker, setMaker] = useState('All');
  const [find, setFind] = useState('');
  const [all, setAll] = useState(false);
  const t = lib.totals;

  const makers = useMemo(() => {
    const n = lib.machines.reduce((m, x) => ((m[x.brand] = (m[x.brand] || 0) + 1), m), {});
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  }, [lib]);

  const q = find.trim().toUpperCase().replace(/[\s-]/g, '');
  const rows = lib.machines.filter((m) => (maker === 'All' || m.brand === maker) && (!q || m.model.toUpperCase().includes(q)));
  const shown = all || q ? rows : rows.slice(0, SHOWN);

  return (
    <section className="wrap" id="library">
      <header className="head head--split">
        <div>
          <h2>The library</h2>
          <p className="lede">
            {num(t.machines)} machines, read from the manufacturers' own manuals. Every quotation is
            checked against the page it cites, and {num(t.rejected)} readings that failed were
            rejected rather than kept.
          </p>
        </div>
        <a className="button button--line" href="/review.html#try">Read your own manual</a>
      </header>

      <dl className="stats">
        {[
          [WashingMachine, 'Machines', t.machines],
          [MessageSquareText, 'Symptoms', t.symptoms],
          [FileSearch, 'Causes, each with its page', t.causes],
          [ShieldX, 'Readings rejected', t.rejected],
        ].map(([Icon, label, n]) => (
          <div key={label}>
            <dt><Icon size={15} strokeWidth={2} aria-hidden="true" />{label}</dt>
            <dd>{num(n)}</dd>
          </div>
        ))}
      </dl>

      <div className="table-tools">
        <div className="tabs" role="tablist" aria-label="Filter by maker">
          {[['All', lib.machines.length], ...makers].map(([b, n]) => (
            <button key={b} type="button" role="tab" aria-selected={maker === b} onClick={() => { setMaker(b); setAll(false); }}>
              <span>{b}</span>
              <em>{num(n)}</em>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <input type="search" placeholder="Find a model number" value={find} onChange={(e) => setFind(e.target.value)} spellCheck={false} autoComplete="off" aria-label="Find a model number" />
        </label>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Maker</th>
              <th scope="col">Kind</th>
              <th scope="col" className="n">Codes</th>
              <th scope="col" className="n">Symptoms</th>
              <th scope="col" className="n">Causes</th>
              <th scope="col" className="n">Rejected</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const [label, tone] = TIER[m.tier] || ['Not yet checked', 'wait'];
              return (
                <tr key={m.model}>
                  <td className="model">{m.model}</td>
                  <td>{m.brand}</td>
                  <td>{m.kind || '—'}</td>
                  <td className="n">{m.codes || '—'}</td>
                  <td className="n">{m.symptoms || '—'}</td>
                  <td className="n">{m.causes || '—'}</td>
                  <td className={`n${m.rejected?.length ? ' out' : ''}`}>{m.rejected?.length || '—'}</td>
                  <td><span className={`status status--${tone}`}>{label}</span></td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={8} className="empty">
                  No machine here matches “{find.trim()}”. You can still <a href="/review.html#try">read its manual yourself</a>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!q && rows.length > SHOWN && (
        <button type="button" className="button button--line table-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${num(rows.length)} machines`}
        </button>
      )}
    </section>
  );
}
