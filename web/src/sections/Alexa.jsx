import { useEffect, useRef } from 'react';

/**
 * ── On Alexa+ ───────────────────────────────────────────────────────────────
 *
 * The product, shown large, straight after the question it answers. Every reference page does this
 * second: say the thing, then show the thing. What is shown is not a mock-up. It is a real session —
 * Amazon Nova on Bedrock choosing this project's MCP tools — recorded by scripts/record-talk.js with
 * nothing retaken, the same footage /talk.html plays where it cannot reach Bedrock.
 *
 * It plays only while it is on screen. A four-megabyte loop decoding below the fold is a cost the
 * visitor pays for nothing.
 */

const BEATS = [
  ['Remembers the house', 'It knows your machines and what was tried last time, before you say a word.'],
  ['Asks one check, then waits', 'The check that rules out the most for the least effort. Your hands stay in the machine.'],
  ['Reads the total first', 'A part is offered only when one cause is left, and nothing is ordered until you say yes.'],
];

export default function Alexa() {
  const video = useRef(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    const seen = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.35 });
    seen.observe(v);
    return () => seen.disconnect();
  }, []);

  return (
    <section className="alexa" id="alexa" aria-label="Owl on Alexa+">
      <div className="alexa__stage wrap">
        <div className="alexa__device">
          <video
            ref={video}
            src="/media/talk.webm"
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="A recorded session: the agent remembers the last repair, asks the pump check, offers the part, reads the total, and orders it"
          />
        </div>

        <dl className="alexa__beats">
          {BEATS.map(([t, d]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>

        <p className="alexa__caption">
          A real session, recorded with nothing retaken: Amazon Nova chooses Owl's tools itself, and
          every line, tool call and card is what it actually did.{' '}
          <a href="/talk.html">Open the device</a>
        </p>
      </div>
    </section>
  );
}
