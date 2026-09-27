import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import TitleBlock from '../components/TitleBlock.jsx';
import { describe, odds } from '../lib/api.js';

/**
 * The first screen, and it is an input.
 *
 * ── Why this and not a fault code ───────────────────────────────────────────
 *
 * The project started by looking up fault codes, because that is what you assume a repair copilot
 * does. Then we read the manuals. Current appliance manuals barely print fault codes any more —
 * they print a troubleshooting TABLE, keyed on what the machine is doing in plain English, with a
 * cause beside it and a remedy under that. So the way in is the sentence somebody would actually
 * say out loud on a kitchen floor, and the work is matching that sentence to the manufacturer's.
 *
 * ── What comes back ─────────────────────────────────────────────────────────
 *
 * Either the manufacturer's own sentence with the page it is printed on, or a refusal that says
 * what the manual DOES cover. The refusal is not the failure case. "Its manual lists five problems
 * and none of them is this one" is a true and useful thing to be told, and it is the sentence that
 * separates this from something that sounds confident about a machine it has never read.
 */

/*
 * Four things somebody would actually say, and the last one is the point.
 *
 * "there is a burning smell" is not in this manual, and the honest answer to it is a refusal that
 * names what the manual DOES list. The chip used to be "it is making a grinding noise", which the
 * matcher refused until stemming taught it that "making" and "noise" match "Filling valves making
 * knocking noises" — a fair candidate, and no longer a demonstration of the refusal. A first screen
 * that can only show the product succeeding is showing half of it.
 */
const TRIES = [
  'there is water left in the bottom at the end of the program',
  'the dishes are not drying',
  'there is loads of foam coming out',
  'there is a burning smell',
];

export default function Ask({ machines }) {
  const [said, setSaid] = useState(TRIES[0]);
  const [model, setModel] = useState('SGE53C55UC');
  const [out, setOut] = useState(null);
  const [asking, setAsking] = useState(false);
  const still = useReducedMotion();

  async function ask(text = said, which = model) {
    if (!text.trim()) return;
    setAsking(true);
    try {
      setOut(await describe(which, text));
    } catch (e) {
      setOut({ known: false, reason: `The server did not answer: ${e.message}`, available: [] });
    } finally {
      setAsking(false);
    }
  }

  // One answer on arrival, so the first screen is the product working rather than an empty box
  // waiting to be trusted.
  useEffect(() => {
    ask(TRIES[0], 'SGE53C55UC');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readable = machines?.filter((m) => m.symptoms > 0) ?? [];

  return (
    <section className="hero wrap" id="ask">
      <p className="plate">Second Set of Hands · an appliance repair copilot for Alexa+</p>

      {/*
        No accent in the headline.
        
        "the manufacturer's own words" used to be set in the callout ochre, which put the brightest
        thing on the page inside a sentence — competing with the one element that has actually
        earned that colour, the citation under each cause. The headline is the claim; the citation
        is the evidence, and the evidence should be what the eye lands on.
      */}
      <div className="hero__top">
        <div>
          <h1>
            Tell it what the machine is doing. It answers with the manufacturer's own words, and
            the page they are printed on.
          </h1>

          <p className="hero__sub">
            Not a summary of a manual. The sentence out of the manual, the cause listed beside it,
            and the remedy printed under that — or a straight answer that this one is not in there.
          </p>
          <p className="hero__sub">
            <a className="hero__cta" href="/fix.html">Something broken right now? Fix it on your phone →</a>
          </p>
        </div>

        <TitleBlock machine={readable.find((m) => m.model === model)} />
      </div>

      <div className="ask">
        <form
          className="ask__row"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <input
            value={said}
            onChange={(e) => setSaid(e.target.value)}
            placeholder="it is not draining and there is water in the bottom"
            aria-label="what the machine is doing"
          />
          <button className="btn" type="submit" disabled={asking}>
            {asking ? 'Reading…' : 'Ask the manual'}
          </button>
        </form>

        <div className="ask__which">
          <span>of a</span>
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              ask(said, e.target.value);
            }}
            aria-label="which machine"
          >
            {readable.map((m) => (
              <option key={m.model} value={m.model}>
                {m.brand} {m.model} — {m.kind}
              </option>
            ))}
          </select>
          {readable.length > 0 && <span>{readable.length} machines have been read</span>}
        </div>
      </div>

      <div className="tries">
        {TRIES.map((t) => (
          <button
            className="try"
            key={t}
            onClick={() => {
              setSaid(t);
              ask(t);
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/*
        Where the percentages come from, said once, before the first one appears. An unexplained
        number on a repair page reads as a confidence score somebody computed; this one is the
        manual's own ordering, which is a much weaker and much more honest claim.
      */}
      <p className="ask__basis">
        The percentages are the manual's own ordering — it lists the likeliest cause first — not a
        model's estimate. Nothing on this page is a guess about your machine.
      </p>

      <AnimatePresence mode="wait">
        {out && (
          <motion.div
            key={JSON.stringify(out).slice(0, 80)}
            initial={{ opacity: 0, y: still ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {out.known ? <Found out={out} /> : <Refused out={out} />}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** The manual's own words, if they say more than the cause label already did. */
function quoted(c) {
  if (!c.evidence) return null;
  const words = c.evidence.replace(/^[^:]*:\s*/, '').replace(/^["“]|["”]$/g, '').trim();
  const label = (c.label || '').trim();
  return words && words !== label ? `“${words}”` : null;
}

/** Where it is printed. Never omitted — a quotation without one is just a confident sentence. */
function cited(c, out) {
  const manual = c.source?.manual ?? out.brand;
  if (!manual) return null;
  return [
    manual,
    c.source?.page ? `page ${c.source.page}` : null,
    c.source?.readWith ? `read with ${c.source.readWith}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function Found({ out }) {
  const first = out.matches?.[0];
  if (!first) return null;

  return (
    <div className="answer">
      <p className="answer__symptom">“{first.symptom}”</p>
      <p className="answer__from">{out.provenance}</p>

      {first.causes.map((c) => (
        <div className="cause" key={c.id}>
          {/*
            The number is the manual's own ordering, not a model's opinion. A manual lists the
            likeliest cause first, so the first one carries more weight than the fourth — that is
            the whole derivation, and it is worth labelling, because an unexplained percentage on a
            repair page looks like a confidence score somebody computed.
          */}
          <span className="cause__odds">
            {odds(c.likelihood)}
            <small>by order</small>
          </span>
          <div>
            {/*
              The cause IS the manufacturer's sentence — it was lifted out of the table, not
              summarised — so printing the label and then quoting the same words underneath said
              everything twice. When the evidence adds nothing to the label, only the citation
              survives; when it differs, both are shown, because then the quotation is doing work.
            */}
            <p className="cause__label">{c.label}</p>
            {quoted(c) && (
              <blockquote className="quote">
                {quoted(c)}
                <cite>{cited(c, out)}</cite>
              </blockquote>
            )}
            {!quoted(c) && cited(c, out) && (
              <p className="quote quote--bare">
                <cite>{cited(c, out)}</cite>
              </p>
            )}
            {c.remedies?.length > 0 && (
              <ul className="remedies">
                {c.remedies.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The refusal, given the same weight as an answer.
 *
 * It lists what the manual does cover, because "I don't know" is only useful when it comes with
 * the shape of what is known. And it says the one thing a confident machine never says: not
 * finding it is not the same as nothing being wrong.
 */
function Refused({ out }) {
  return (
    <div className="refusal">
      <h3>It will not guess</h3>
      <p>{out.reason}</p>
      {out.available?.length > 0 && (
        <>
          {/*
            A dozen, then a count. Thirty-nine of them is a wall somebody scrolls past, and the
            list is here to be READ — it is how a person recognises their own problem in the
            manufacturer's words.
          */}
          <ul>
            {out.available.slice(0, 12).map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          {out.available.length > 12 && (
            <p className="refusal__more">…and {out.available.length - 12} more it does cover</p>
          )}
        </>
      )}
    </div>
  );
}
