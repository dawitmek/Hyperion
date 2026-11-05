import changelog from '../../../../CHANGELOG.md?raw';
import { parseChangelog, parseInline } from './changelog';
import { PageHero } from './pages';
import { GITHUB_URL, SiteLayout } from './SiteLayout';

// Built from CHANGELOG.md at the repo root, so a release's entry there is all it takes.
const RELEASES = parseChangelog(changelog);

const formatDate = (date: string) =>
  date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

function Item({ text }: { text: string }) {
  const breaking = text.startsWith('**BREAKING:**');
  const parts = parseInline(breaking ? text.slice('**BREAKING:**'.length).trimStart() : text);
  return (
    <li>
      {breaking && <span className="s-breaking">Breaking</span>}
      {parts.map((p, i) =>
        p.kind === 'bold' ? <strong key={i}>{p.text}</strong> : p.kind === 'code' ? <code key={i}>{p.text}</code> : p.kind === 'link' ? <a key={i} href={p.href}>{p.text}</a> : p.text,
      )}
    </li>
  );
}

export function ChangelogPage() {
  return (
    <SiteLayout>
      <PageHero title="Changelog">
        What changed in each release of Hyperion, newest first. To hear about new ones, watch the repository on{' '}
        <a href={GITHUB_URL}>GitHub</a> for releases.
      </PageHero>
      <div className="s-wrap">
        <ol className="s-changelog">
          {RELEASES.map((r) => (
            <li key={r.version} id={`v${r.version}`}>
              <div className="s-changelog-meta">
                <time dateTime={r.date}>{formatDate(r.date)}</time>
                <a href={`#v${r.version}`} className="s-changelog-version">
                  v{r.version}
                </a>
              </div>
              <div>
                <h2>{r.theme.replace(/\.$/, '') || `Version ${r.version}`}</h2>
                {r.sections.map((s) => (
                  <section key={s.title}>
                    <h3>{s.title}</h3>
                    <ul className="s-checks">
                      {s.items.map((item, i) => (
                        <Item key={i} text={item} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </SiteLayout>
  );
}
