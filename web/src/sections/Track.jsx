import { Check, ArrowRight } from 'lucide-react';

/**
 * ── What the Alexa+ track asks for, and where it is ─────────────────────────
 *
 * The track's rules name what separates a creative entry from an obvious one. This is that list,
 * item by item, each pointing at the part of the product that does it — so a judge can check the
 * claim rather than take it.
 */
const ASKED = [
  ['An agentic workflow across services', 'Amazon Nova on Bedrock chooses Owl’s MCP tools itself: read the manual, narrow the causes, guide the repair, ask the gate, order the part.', '#alexa'],
  ['State across sessions', 'It remembers the household’s machines and repairs, so a fault that comes back starts where the last one ended.', '#household'],
  ['Purchasing', 'A part is ordered only through a gate that checks the diagnosis, with the full total read aloud before anything is bought.', '#part'],
  ['Cards and MCP Apps', 'Every tool that draws on a screen points at an MCP App card, rendered by a reference host you can open.', '/app-host.html'],
  ['More than single-turn Q&A', 'Multi-turn and hands-free, one check at a time — and it refuses: mains wiring, guesses, procedures nobody published.', '#wont'],
];

export default function Track() {
  return (
    <section className="wrap" id="track">
      <header className="head">
        <h2>What the Alexa+ track asks for</h2>
        <p className="lede">The track’s own list of what makes an entry creative rather than obvious, and where each one is.</p>
      </header>
      <ul className="asked">
        {ASKED.map(([what, how, href]) => (
          <li key={what}>
            <span className="asked__tick" aria-hidden="true"><Check size={14} strokeWidth={2.6} /></span>
            <div>
              <p className="asked__what">{what}</p>
              <p className="asked__how">{how}</p>
            </div>
            <a className="asked__go" href={href} aria-label={`See ${what.toLowerCase()}`}><ArrowRight size={16} /></a>
          </li>
        ))}
      </ul>
    </section>
  );
}
