import { useEffect, useState } from 'react';

/**
 * ── The menu ────────────────────────────────────────────────────────────────
 *
 * The page used to be reached through links set in its paragraphs — "use it yourself", "see the
 * card", "watch the agent" — each one a sentence a visitor had to find. A product with six things
 * to show deserves a bar that names them, the way every reference page does: the mark on the left,
 * the sections in the middle, one quiet link and one button on the right.
 *
 * It follows the reader. The section in view is marked, so the bar also answers "where am I"
 * on a page that is long by design.
 */

export const SECTIONS = [
  ['alexa', 'On Alexa+'],
  ['why', 'Why'],
  ['ask', 'Ask a manual'],
  ['hands', 'Hands-free'],
  ['library', 'Library'],
  ['use', 'Use it'],
  ['wont', 'Refusals'],
];

/** The two rings of the add-on's icon. Read as a pair of eyes, it is the owl. */
export function Mark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" aria-hidden="true">
      <rect width="240" height="240" rx="54" fill="#0a0a0a" />
      <circle cx="98" cy="120" r="50" fill="none" stroke="#ffffff" strokeWidth="16" />
      <circle cx="142" cy="120" r="50" fill="none" stroke="#8f8f8f" strokeWidth="16" />
    </svg>
  );
}

export default function Nav() {
  const [here, setHere] = useState('ask');
  const [open, setOpen] = useState(false);

  /*
   * Which section the reader is in: the last one whose top has passed the upper third of the
   * window. Asked on scroll rather than registered once, because sections that load their data
   * first mount after the menu does, and an observer set up before them never sees them.
   */
  useEffect(() => {
    let frame = 0;
    const look = () => {
      frame = 0;
      const line = window.innerHeight * 0.35;
      let at = '';
      for (const [id] of SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) at = id;
      }
      setHere(at);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(look); };
    window.addEventListener('scroll', onScroll, { passive: true });
    look();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  return (
    <header className="nav">
      <div className="nav__bar">
        <a className="nav__brand" href="#top" onClick={() => setOpen(false)}>
          <Mark />
          <span>Owl</span>
        </a>

        <nav className="nav__links" aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} aria-current={here === id ? 'true' : undefined}>
              {label}
            </a>
          ))}
        </nav>

        <div className="nav__end">
          <a className="nav__quiet" href="https://github.com/vidigoat/owl">GitHub</a>
          <a className="nav__cta" href="#ask">Try it</a>
          <button
            type="button"
            className="nav__toggle"
            aria-expanded={open}
            aria-controls="nav-sheet"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      <nav id="nav-sheet" className="nav__sheet" hidden={!open} aria-label="Sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>
            {label}
          </a>
        ))}
        <a href="https://github.com/vidigoat/owl">GitHub</a>
      </nav>
    </header>
  );
}
