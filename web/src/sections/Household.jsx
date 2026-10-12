import { motion, useReducedMotion } from 'motion/react';
import { money } from '../lib/api.js';

/**
 * What the household remembers.
 *
 * ── Why this is the feature that makes it an assistant ──────────────────────
 *
 * The first conversation is a repair. The second one is short, because it already knows which
 * machines are in this house and what has happened to them — and that is the difference between a
 * tool somebody opens and one that lives on their counter.
 *
 * Two things fall out of the receipts on their own, and neither is a judgement:
 *
 *   overdue       A fridge filter is a 180-day part. One changed 210 days ago is overdue, which is
 *                 subtraction, not an opinion.
 *   came back     The same fault on the same machine, three times in seven months. The dates ARE
 *                 the finding. What they MEAN — a failing part, a machine near its end, worth a
 *                 technician — is not derivable from three timestamps, so nothing here says it.
 *                 The owner, or whoever they call, draws the conclusion.
 *
 * On a hosted deployment the household is a demo one, because a real `data/home.json` is somebody's
 * home and is kept out of every deploy. The page says which it is looking at, above the numbers,
 * rather than in a footnote.
 */

const days = (n) => (n === 1 ? '1 day' : `${n} days`);

export default function Household({ data }) {
  const still = useReducedMotion();
  if (!data?.known || !data.appliances?.length) return null;

  const byModel = (model) => data.receipts.filter((r) => r.model === model);
  const repeatFor = (model) => data.recurring?.find((r) => r.model === model);
  const dueFor = (model) => data.due?.find((d) => d.model === model);

  return (
    <section className="wrap" id="household">
      <header className="head">
        <h2>The second conversation is the short one</h2>
        <p className="lede">
          Owl remembers your machines and every repair, so a fault that comes back starts where the
          last one ended.{' '}
          {data.demo
            ? 'This household is made up for the demo; the machines and faults are real ones from the library.'
            : 'This is the household on this machine.'}
        </p>
      </header>

      <div className="house">
        {data.appliances.map((a, i) => {
          const receipts = byModel(a.model);
          const repeat = repeatFor(a.model);
          const overdue = dueFor(a.model);

          return (
            <motion.article
              className="house__machine"
              key={a.model}
              initial={{ opacity: still ? 1 : 0, y: still ? 0 : 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: still ? 0 : 0.4, delay: still ? 0 : Math.min(i * 0.07, 0.3) }}
            >
              <header className="house__head">
                <h3>{a.nickname || `${a.brand} ${a.kind}`}</h3>
                <span className="house__model">{a.model}</span>
              </header>

              {repeat && (
                <p className="house__flag house__flag--back">
                  <b>
                    {repeat.code} has happened {repeat.times} times
                  </b>{' '}
                  — {days(repeat.daysSinceLast)} ago, and first {days(repeat.daysSinceFirst)} ago.
                  That is the finding; what it means is not something three dates can say.
                </p>
              )}

              {overdue && (
                <p className="house__flag house__flag--due">
                  <b>The {overdue.part} is overdue.</b> Changed {days(overdue.daysSince)} ago, and
                  it is a {overdue.dueAfter}-day part.
                </p>
              )}

              {receipts.length === 0 ? (
                <p className="house__quiet">Nothing has gone wrong with this one.</p>
              ) : (
                <ol className="house__log">
                  {receipts
                    .slice()
                    .sort((a, b) => new Date(b.at) - new Date(a.at))
                    .map((r) => (
                      <li key={r.at + r.action}>
                        <span className="house__when">
                          {new Date(r.at).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        <span>
                          {r.code ? <b>{r.code}</b> : null} {r.cause}
                          {r.action ? ` — ${r.action.toLowerCase()}` : ''}
                        </span>
                        {/* Never rendered as $0 when nothing is known — see lib/api.js. */}
                        <span className="house__cost">
                          {typeof r.cost === 'number' ? (r.cost === 0 ? 'no parts' : money(r.cost)) : ''}
                        </span>
                      </li>
                    ))}
                </ol>
              )}
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
