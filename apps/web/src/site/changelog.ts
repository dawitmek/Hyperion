// Reads CHANGELOG.md (Keep a Changelog: `## [version] - date`, a one-line theme, `### Section`s of `- item`s) into
// releases for the Changelog page. Unreleased is left out, as are the compare links at the bottom.

export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  theme: string;
  sections: { title: string; items: string[] }[];
}

export function parseChangelog(text: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let items: string[] | null = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/);
    if (heading) {
      items = null;
      release = heading[1] === 'Unreleased' ? null : { version: heading[1], date: heading[2] ?? '', theme: '', sections: [] };
      if (release) releases.push(release);
      continue;
    }
    if (!release || /^\[[^\]]+\]: /.test(line)) continue;
    const section = line.match(/^### (.+)/);
    if (section) {
      items = [];
      release.sections.push({ title: section[1].trim(), items });
    } else if (items && line.startsWith('- ')) {
      items.push(line.slice(2).trim());
    } else if (items && items.length && /^\s+\S/.test(line)) {
      // a long item carried on to the next line
      items[items.length - 1] += ' ' + line.trim();
    } else if (!items && line.trim()) {
      release.theme = release.theme ? `${release.theme} ${line.trim()}` : line.trim();
    }
  }
  return releases;
}

// An item's text in pieces: plain text, **bold**, `code` and [links](url).
export type Inline = { kind: 'text' | 'bold' | 'code'; text: string } | { kind: 'link'; text: string; href: string };

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > at) parts.push({ kind: 'text', text: text.slice(at, m.index) });
    if (m[1] !== undefined) parts.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) parts.push({ kind: 'code', text: m[2] });
    else parts.push({ kind: 'link', text: m[3], href: m[4] });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}
