import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

/**
 * ── Why it matters ──────────────────────────────────────────────────────────
 *
 * The case, made from other people's measurements. Each figure is read from public/impact.json,
 * which carries the source's own sentence and its link, so nothing here is a number this project
 * typed — the same rule every other figure on the page keeps.
 */
export default function Why() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch('/impact.json').then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, []);
  if (!data?.facts?.length) return null;

  return (
    <section className="wrap" id="why">
      <header className="head">
        <h2>Most broken appliances never get the repair</h2>
        <p className="lede">
          Not because the fix is hard. Because the person holding the screwdriver cannot see what the
          manual says, and the manufacturer often does not publish it.
        </p>
      </header>

      <div className="facts">
        {data.facts.map((f) => (
          <figure className="fact" key={f.figure + f.claim}>
            <p className="fact__fig">{f.figure}</p>
            <p className="fact__claim">{f.claim}</p>
            <figcaption>
              <a href={f.url} target="_blank" rel="noreferrer" title={f.quote}>
                {f.source}
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </figcaption>
          </figure>
        ))}
      </div>

      <p className="why__owl">
        Owl starts from what manufacturers do publish — the owner's manual, with its troubleshooting
        table — and reads it to the person on the floor, one check at a time. A repair that would
        have been a replacement is the whole point.
      </p>
    </section>
  );
}
