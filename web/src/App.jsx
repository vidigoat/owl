import { useEffect, useState } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import { motion, useReducedMotion } from 'motion/react';
import Ask from './sections/Ask.jsx';
import Plate from './sections/Plate.jsx';
import Device from './sections/Device.jsx';
import Household from './sections/Household.jsx';
import { library, session as sessionApi, household as householdApi, num, money, odds } from './lib/api.js';

/**
 * ── Owl ─────────────────────────────────────────────────────
 *
 * An appliance repair copilot for Alexa+. Somebody is on a kitchen floor at nine at night with a
 * dishwasher that will not drain, and the manual is either lost or a PDF on a phone they cannot
 * hold. This reads the manufacturer's manual, tells them what it says, talks them through it
 * without their hands, and orders the part only if the diagnosis was verified.
 *
 * The order of the page is the order of the job: what is it doing → what does the manual say →
 * do this → if that did not work, this is the part → and here is what it refuses to do.
 */

const WONT = [
  {
    q: 'It will not invent a procedure',
    a: 'If there is no verified procedure for that machine, it says so and stops. A confident-sounding sequence of steps for a machine nobody has read is the single most dangerous thing a repair assistant can produce — somebody is following it with their hands inside an appliance.',
  },
  {
    q: 'It will not spend your money on a guess',
    a: 'Ordering a part requires a verified diagnosis. One function is allowed to authorise spending, it refuses on four specific grounds, and every refusal is tested — including that a refusal can never come back carrying permission to spend.',
  },
  {
    q: 'It will not treat "not found" as "nothing is wrong"',
    a: 'When a description does not match anything in the manual, it says which problems the manual does list, and says plainly that not finding it is not the same as nothing being wrong. The machine is still broken; this just is not the document that explains it.',
  },
  {
    q: 'It will not pass off a reading as a fact',
    a: 'Every claim carries how it was obtained: read by hand, read from the pages and checked against them, or read and not yet checked. The library page shows which tier each machine is in, and the unchecked tier is never used to authorise a purchase.',
  },
  {
    q: 'It will not redistribute the manuals',
    a: 'The parsed facts are committed — short attributed quotations with a page citation each. The rendered manufacturer pages they were read from are not, and a deploy is configured so they cannot be published by accident.',
  },
];

/** "1 fault codes" is the sort of thing that makes a careful page look careless. */
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

export default function App() {
  const [lib, setLib] = useState(null);
  const [ses, setSes] = useState(null);
  const [house, setHouse] = useState(null);
  const still = useReducedMotion();

  useEffect(() => {
    library().then(setLib).catch(() => {});
    sessionApi().then(setSes).catch(() => {});
    householdApi().then(setHouse).catch(() => {});
  }, []);

  const t = lib?.totals;

  return (
    <>
      <main>
        <Ask machines={lib?.machines} />

        <Plate />

        {ses && (
          <div className="device-band">
            <section className="wrap" id="hands">
              <p className="plate">2 · hands-free</p>
              <h2>Both of your hands are inside the machine</h2>
              <p className="lede">
                One step, at the size of a headline, four feet away. It advances when you say so and
                not before — the machine has no idea whether your hands came back out, and guessing
                about that is how somebody gets hurt.
              </p>

              <motion.div
                style={{ marginTop: 30 }}
                initial={{ opacity: still ? 1 : 0, y: still ? 0 : 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: still ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <Device session={ses} />
              </motion.div>

              {/*
                Where the screen above comes from on an Echo Show: the MCP App the tools name. The
                host page is ours, the card is the real ui:// resource and every step is a real
                tool call — so it works on this URL. Talking to the agent needs AWS credentials,
                which this deployment does not have, and the link says so rather than finding out.
              */}
              <p className="invite">
                <a href="/connect.html">Use it yourself</a> — add the real MCP server to Claude as a
                connector and talk a repair through. <a href="/app-host.html">See the card an Echo Show would draw</a> — the real MCP App,
                fed by real tool calls. And <a href="/talk.html">watch the agent talk a repair
                through</a>: Amazon Nova choosing the tools itself, the card following along — a
                recorded session here, live wherever there are AWS credentials.
              </p>
            </section>
          </div>
        )}

        {ses?.part && (
          <section className="wrap" id="part">
            <p className="plate">3 · only if it was verified</p>
            <h2>The part, and the thing it saves you</h2>
            <p className="lede">
              This is the one place the copilot can spend money, and it is gated: a single function
              is allowed to authorise it, and it refuses unless the diagnosis was verified against
              the manual. The alternative is priced next to it because that is the actual decision —
              not "buy this", but "this, or a week and four times the money".
            </p>

            <div className="part">
              <div>
                <h3>{ses.part.name}</h3>
                <span className="price">{money(ses.part.price)}</span>
                <span className="when">{ses.part.eta}</span>
                <p className="note">
                  Fits {ses.part.fitsModel} — {odds(ses.part.fitConfidence)} confidence, from the
                  model number on the plate rather than from what you typed.
                </p>
              </div>
              <div className="other">
                <h3>{ses.part.alternative.label}</h3>
                <span className="price">{money(ses.part.alternative.price)}</span>
                <span className="when">{ses.part.alternative.eta}</span>
                <p className="note">
                  What this costs if nobody talks you through the filter first. Most {ses.fault.code}{' '}
                  faults on this model never get here.
                </p>
              </div>
            </div>
          </section>
        )}

        {t && (
          <section className="wrap" id="library">
            <p className="plate">4 · the library</p>
            <h2>Everything it knows, and how it came to know it</h2>
            <p className="lede">
              Manuals fetched from the manufacturer, read, and then read again against the pages.
              A machine that has not been checked is marked as unchecked and is never used to
              authorise a purchase. <b>{num(t.rejected)}</b> readings were rejected outright rather
              than admitted quietly.
            </p>

            {/*
              The invitation, on the page where somebody is already looking at what it knows.

              Reading a manual used to need `pdftotext`, which is a binary the host does not have —
              so on this URL the capability the whole project is built around was the one thing a
              visitor could not see. It reads the PDF format itself now, with no dependencies, and
              the bench is where that is reachable. A list of what a thing knows, with no way to
              find out what it would make of yours, is a brochure.
            */}
            <p className="invite">
              <a href="/review.html#try">Read your own machine's manual</a> — any brand, nothing
              here is coded for yours. The fault table comes back in under a second with the page
              each cause is printed on. Nothing is uploaded and nothing is added to the library.
            </p>

            <dl className="totals">
              <div>
                <dt>machines</dt>
                <dd>{num(t.machines)}</dd>
              </div>
              <div>
                <dt>read and checked</dt>
                <dd>{num(t.checked)}</dd>
              </div>
              <div>
                <dt>symptoms</dt>
                <dd>{num(t.symptoms)}</dd>
              </div>
              <div>
                <dt>causes</dt>
                <dd>{num(t.causes)}</dd>
              </div>
              <div>
                <dt>rejected</dt>
                <dd>{num(t.rejected)}</dd>
              </div>
            </dl>

            {/*
              The index, grouped by manufacturer.

              It was nineteen flat rows reading "Bosch Dishwasher — 12 symptoms, 21 causes", with
              the words "Bosch Dishwasher" repeated twelve times down the page. Low density and
              visually numbing, which is a poor way to present the one part of this project that
              took the most work. Grouped and columnar, the same data reads as what it is: an index
              of documents, with the numbers aligned so they can be compared down the column.
            */}
            <div className="shelf">
              {Object.entries(
                lib.machines.reduce((by, m) => {
                  (by[m.brand] ||= []).push(m);
                  return by;
                }, {})
              )
                .sort((a, b) => b[1].length - a[1].length)
                .map(([brand, list]) => (
                  <div className="shelf__brand" key={brand}>
                    <h3>
                      {brand}
                      <span>{plural(list.length, 'machine')}</span>
                    </h3>

                    {/*
                      Codes and symptoms are counted separately, and a machine that has none of a
                      kind gets a dash rather than a nought.
                      
                      One column headed "symptoms" carried whichever of the two a machine happened
                      to have, so the three hand-entered washers read "1 symptom, 0 causes" — which
                      looks like a padded row and is not what they are. They translate a fault code
                      into plain English and cannot go further than that, which is a small honest
                      thing to know and worth saying accurately.
                    */}
                    <div className="shelf__head" aria-hidden="true">
                      <span>model</span>
                      <span>kind</span>
                      <span>codes</span>
                      <span>symptoms</span>
                      <span>causes</span>
                      <span>rejected</span>
                      <span>read</span>
                    </div>

                    {list.map((m) => (
                      <div className="machine" key={m.model} data-tier={m.tier}>
                        <span className="machine__model">{m.model}</span>
                        <span className="machine__kind">{m.kind || '—'}</span>
                        <span className="machine__n">{m.codes || '—'}</span>
                        <span className="machine__n">{m.symptoms || '—'}</span>
                        <span className="machine__n">{m.causes || '—'}</span>
                        <span className="machine__n machine__n--out">
                          {m.rejected?.length || ''}
                        </span>
                        <span className="machine__tier">
                          {m.tier === 'checked'
                            ? 'checked'
                            : m.tier === 'hand'
                              ? 'by hand'
                              : 'not yet'}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </section>
        )}

        {house && <Household data={house} />}

        <section className="wrap" id="wont">
          <p className="plate">6 · the refusals</p>
          <h2>What it will not do</h2>
          <p className="lede">
            A repair copilot that always has an answer is worse than useless — somebody is following
            it with their hands inside a machine. Each of these is a refusal that exists in the code
            and has a test that proves it still refuses.
          </p>

          <Accordion.Root className="wont" type="single" collapsible>
            {WONT.map((w) => (
              <Accordion.Item value={w.q} key={w.q}>
                <Accordion.Header>
                  <Accordion.Trigger className="wont__trigger">
                    {w.q}
                    <span className="wont__sign" aria-hidden="true">
                      +
                    </span>
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content className="panel">
                  <p>{w.a}</p>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </section>
      </main>

      <footer className="wrap">
        <span>Owl</span>
        <span>Amazon Developer Hackathon · Alexa+ track</span>
        <a href="https://github.com/vidigoat/owl">the source</a>
      </footer>
    </>
  );
}
