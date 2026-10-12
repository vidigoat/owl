import { useState } from 'react';
import { Logo } from '../lib/logos.jsx';

/**
 * ── Use it yourself ─────────────────────────────────────────────────────────
 *
 * Three ways in, side by side, instead of three links buried in three paragraphs. Each says what
 * happens and where it happens, in one breath, and has one button that does exactly that.
 */

const MCP = 'https://owl-repair.vercel.app/mcp';

export default function UseIt() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the field is selectable; the button is a convenience */
    }
  };

  return (
    <section className="wrap" id="use">
      <header className="head">
        <h2>Try it today</h2>
        <p className="lede">Nothing to install, no account, and nothing you give it is kept.</p>
      </header>

      <div className="ways">
        <article className="way">
          <span className="way__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></svg></span>
          <h3>Read your own machine's manual</h3>
          <p>
            Drop in the manufacturer's PDF for any appliance. The fault table comes back in under a
            second, each cause with the page it is printed on.
          </p>
          <a className="way__go" href="/review.html#try">Open the review bench</a>
        </article>

        <article className="way">
          <span className="way__icon"><Logo name="claude" height={22} title={false} /></span>
          <h3>Add it to Claude</h3>
          <p>
            The same MCP server Alexa+ calls. In Claude, open Settings, then Connectors, and add a
            custom connector with this address. It needs no sign-in.
          </p>
          <div className="way__field">
            <code>{MCP}</code>
            <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <a className="way__go way__go--quiet" href="/connect.html">Full instructions</a>
        </article>

        <article className="way">
          <span className="way__icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg></span>
          <h3>Fix something on your phone</h3>
          <p>
            Point your phone at the broken machine, and it reads that machine's manual with you,
            one step at a time.
          </p>
          <a className="way__go" href="/fix.html">Start a repair</a>
        </article>
      </div>
    </section>
  );
}
