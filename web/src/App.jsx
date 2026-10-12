import { useEffect, useState } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import { motion, useReducedMotion } from 'motion/react';
import Ask from './sections/Ask.jsx';
import Plate from './sections/Plate.jsx';
import Device from './sections/Device.jsx';
import Household from './sections/Household.jsx';
import Nav from './sections/Nav.jsx';
import Hero from './sections/Hero.jsx';
import Library from './sections/Library.jsx';
import Alexa from './sections/Alexa.jsx';
import UseIt from './sections/UseIt.jsx';
import Footer from './sections/Footer.jsx';
import { library, session as sessionApi, household as householdApi, money, odds } from './lib/api.js';

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

  return (
    <>
      <Nav />

      <main>
        <Hero />

        <Alexa />

        <Ask machines={lib?.machines} />

        <Plate />

        {ses && (
          <div className="band">
            <section className="wrap" id="hands">
              <header className="head">
                <h2>Both of your hands are inside the machine</h2>
                <p className="lede">
                  One step at a time, large enough to read from four feet away. It moves on when you
                  say so, and not before.
                </p>
              </header>

              <motion.div
                initial={{ opacity: still ? 1 : 0, y: still ? 0 : 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: still ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <Device session={ses} />
              </motion.div>
            </section>
          </div>
        )}

        {ses?.part && (
          <section className="wrap" id="part">
            <header className="head">
              <h2>The part, and what it saves you</h2>
              <p className="lede">
                The only place Owl can spend money, and only once the diagnosis is verified. The
                alternative is priced beside it, because that is the real decision.
              </p>
            </header>

            <div className="part">
              <div>
                <h3>{ses.part.name}</h3>
                <span className="price">{money(ses.part.price)}</span>
                <span className="when">{ses.part.eta}</span>
                <p className="note">
                  Fits {ses.part.fitsModel}, {odds(ses.part.fitConfidence)} confidence, from the model
                  number on the plate rather than from what you typed.
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

        {lib?.totals && <Library lib={lib} />}

        {house && <Household data={house} />}

        <UseIt />

        <section className="wrap" id="wont">
          <header className="head">
            <h2>What it will not do</h2>
            <p className="lede">
              Somebody is following it with their hands inside a machine, so each of these refusals
              is in the code, with a test that proves it still refuses.
            </p>
          </header>

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

      <Footer />
    </>
  );
}
