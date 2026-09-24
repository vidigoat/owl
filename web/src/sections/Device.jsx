import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

/**
 * The Echo Show, on the counter, while you are on the floor.
 *
 * The constraint that shapes everything here: both of your hands are inside a dishwasher and you
 * are four feet from the screen. So one step at a time, set at the size of a headline, and the
 * only way forward is your voice. A list of twelve steps in body copy is a web page about a
 * repair; this is the repair.
 *
 * "Next" is a button here because a web page cannot hear you. On the device it is the word "next",
 * and the step does not advance until you say it — which matters, because the machine has no idea
 * whether your hands came back out.
 */
export default function Device({ session }) {
  const [at, setAt] = useState(0);
  const [aloud, setAloud] = useState(false);
  const still = useReducedMotion();
  const spoken = useRef(null);

  /*
   * It reads the step out loud.
   *
   * This is the part that is not a website. Somebody on a kitchen floor is not looking at a
   * screen — their head is inside a dishwasher — so the step has to arrive as sound, and the
   * screen is what they glance up at to check they heard it right.
   *
   * `say` rather than `detail`: the detail is written to be read, and reading it aloud makes the
   * assistant sound like it is reciting a manual at somebody. The `say` line is the one written
   * to be said.
   *
   * It never starts on its own. A page that begins talking the moment it loads is a page people
   * close, and this one has no way of knowing whether it is nine at night in somebody's kitchen
   * or a laptop in a quiet room.
   */
  useEffect(() => {
    if (!aloud || typeof speechSynthesis === 'undefined') return;
    const line = session?.steps?.[at]?.say;
    if (!line || spoken.current === `${at}:${line}`) return;

    spoken.current = `${at}:${line}`;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(line);
    utter.rate = 0.95;
    speechSynthesis.speak(utter);

    return () => speechSynthesis.cancel();
  }, [aloud, at, session]);

  // And it stops the moment the section is gone, rather than following somebody down the page.
  useEffect(() => () => {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, []);

  if (!session?.steps?.length) return null;

  const steps = session.steps;
  const step = steps[at];
  const last = at === steps.length - 1;

  // The causes in the order the diagnosis ranked them — never re-sorted here, because the ordering
  // is the diagnosis and a page has no business second-guessing it.
  const [likely, next] = session.causes ?? [];

  return (
    <div className="device">
      <div className="device__bar">
        <span className="device__live" aria-hidden="true" />
        <span>
          {session.appliance.brand} {session.appliance.model}
        </span>
        <span>·</span>
        <span>
          {session.fault.code} — {session.fault.meaning.replace(/\.$/, '')}
        </span>
      </div>

      <div className="device__body">
        <div className="device__now">
        <AnimatePresence mode="wait">
          <motion.div
            key={step.n}
            initial={{ opacity: 0, y: still ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: still ? 0 : -10 }}
            transition={{ duration: still ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
            style={{ display: 'grid', gap: 14 }}
          >
            <p className="device__step">{step.say}</p>
            <p className="device__detail">{step.detail}</p>
          </motion.div>
        </AnimatePresence>

        <div className="device__meta">
          <span className="device__ticks" role="img" aria-label={`step ${at + 1} of ${steps.length}`}>
            {steps.map((s, i) => (
              <span
                className="device__tick"
                key={s.n}
                data-on={i === at}
                data-done={i < at}
              />
            ))}
          </span>
          <span>
            step {at + 1} of {steps.length}
          </span>
          {/* What it needs from you, because it cannot see whether you have a hand free. */}
          <span>needs {step.hands}</span>
        </div>
        </div>

        {/*
          What the steps are actually testing, and what it costs if that is not it.
          
          A device showing only the next instruction makes somebody follow four steps without ever
          being told what they are for, or what happens when it does not work. Both numbers come
          from the diagnosis, and the second one is the reason the first is worth four minutes on a
          kitchen floor.
        */}
        <div className="device__why">
          {likely && (
            <div>
              <p className="device__why-head">testing</p>
              <p className="device__why-what">
                {likely.label} <b>{Math.round(likely.likelihood * 100)}%</b>
              </p>
              <p className="device__why-note">{likely.evidence}</p>
            </div>
          )}
          {next && (
            <div>
              <p className="device__why-head">if it is not that</p>
              <p className="device__why-what">
                {next.label} <b>{Math.round(next.likelihood * 100)}%</b>
              </p>
              <p className="device__why-note">
                {next.cost ? `a $${next.cost} part` : 'no part needed'}
                {session.part?.eta ? ` · ${session.part.eta.toLowerCase()}` : ''}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="device__foot">
        <button
          className="btn btn--onscreen"
          onClick={() => setAt((n) => Math.min(n + 1, steps.length - 1))}
          disabled={last}
        >
          {last ? 'That is the last step' : '“Alexa, next”'}
        </button>
        <button
          className="btn btn--quiet"
          onClick={() => {
            spoken.current = null;
            setAt((n) => Math.max(n - 1, 0));
          }}
          disabled={at === 0}
        >
          “say that again”
        </button>
        <button
          className="btn btn--quiet"
          onClick={() => {
            spoken.current = null;
            setAloud((v) => !v);
          }}
          aria-pressed={aloud}
        >
          {aloud ? 'stop reading it out' : 'read it out loud'}
        </button>
        <p className="said">
          {aloud ? (
            <>
              Speaking. On a device this is the whole interface — <b>{step.hands}</b> are inside the
              machine and the screen is only what you glance up at.
            </>
          ) : (
            <>
              Hands-free on purpose — <b>{step.hands}</b> are inside the machine, so nothing here
              needs a screen tap.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
