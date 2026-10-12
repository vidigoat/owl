import { Mark } from './Nav.jsx';
import { Logo } from '../lib/logos.jsx';

/** Every page this project has, grouped by what a visitor came for. */
const COLUMNS = [
  ['On this page', [['#alexa', 'On Alexa+'], ['#ask', 'Ask a manual'], ['#library', 'The library'], ['#wont', 'What it will not do']]],
  ['Try it', [['/talk.html', 'The device'], ['/review.html', 'The review bench'], ['/fix.html', 'On your phone'], ['/connect.html', 'Add it to Claude']]],
  ['The project', [['https://github.com/vidigoat/owl', 'Source on GitHub'], ['https://github.com/vidigoat/faultgraph', 'faultgraph, the open-source reader'], ['/privacy.html', 'Privacy'], ['/terms.html', 'Terms']]],
];

export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot__grid">
        <div className="foot__brand">
          <a href="#top" className="nav__brand">
            <Mark size={30} />
            <span>Owl</span>
          </a>
          <p>An appliance repair copilot for Alexa+, that will not guess. Built for the Amazon Developer Hackathon, Alexa+ track.</p>
        </div>
        {COLUMNS.map(([head, links]) => (
          <nav key={head} aria-label={head}>
            <h3>{head}</h3>
            <ul>
              {links.map(([href, label]) => (
                <li key={href}>
                  <a href={href}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="wrap foot__base">
        <span>Runs on</span>
        <ul>
          <li><Logo name="amazonalexa" height={16} title={false} />Alexa+</li>
          <li><Logo name="amazonwebservices" height={14} title={false} />Amazon Bedrock</li>
          <li><Logo name="modelcontextprotocol" height={16} title={false} />Model Context Protocol</li>
        </ul>
      </div>
    </footer>
  );
}
