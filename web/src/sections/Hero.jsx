import { Logo } from '../lib/logos.jsx';

/**
 * ── The first screen ────────────────────────────────────────────────────────
 *
 * One sentence of claim, one of how, two buttons, and the evidence of breadth — whose manuals it
 * reads — set as the makers' own marks. The product itself is the next thing on the page, rising
 * out of this band: a recorded Alexa+ session, not a mock-up.
 */

/* Heights set by eye, so a symbol and a wordmark read as the same weight in the row. */
const MAKERS = [
  ['generalelectric', 34],
  ['bosch', 32],
  ['siemens', 17],
  ['lg', 26],
  ['samsung', 16],
];

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero__inner wrap">
        <a className="badge" href="#alexa">
          <Logo name="amazonalexa" height={16} title={false} />
          <span>An add-on for Alexa+</span>
        </a>

        <h1>Tell it what the machine is doing.</h1>

        <p className="hero__lead">
          Owl reads the manufacturer's own manual and answers with the exact sentence, and the page
          it is printed on. It will not guess, and it will not sell you a part it cannot justify.
        </p>

        <div className="hero__actions">
          <a className="button button--eye" href="#alexa">Watch it on Alexa+</a>
          <a className="button button--ghost" href="#ask">Ask a manual</a>
        </div>

        <div className="makers" aria-label="Manufacturers whose manuals Owl reads">
          <p>Reads manuals from</p>
          <ul>
            {MAKERS.map(([m, h]) => (
              <li key={m}>
                <Logo name={m} height={h} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
