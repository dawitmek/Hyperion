import { describe, expect, it } from 'vitest';
import { parseChangelog, parseInline } from '../src/site/changelog';

const SAMPLE = `# Changelog

Intro text.

## [Unreleased]

### Added
- Not out yet.

## [0.4.0] - 2026-11-04

Stream reports.

### Added
- One thing.
- A long thing
  carried on.

### Removed
- **BREAKING:** The old widget.

## [0.3.1] - 2026-10-20

### Fixed
- A bug.

[Unreleased]: https://github.com/o/r/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/o/r/compare/v0.3.1...v0.4.0
`;

describe('parseChangelog', () => {
  it('reads each release, newest first, leaving out Unreleased and the links', () => {
    expect(parseChangelog(SAMPLE)).toEqual([
      {
        version: '0.4.0',
        date: '2026-11-04',
        theme: 'Stream reports.',
        sections: [
          { title: 'Added', items: ['One thing.', 'A long thing carried on.'] },
          { title: 'Removed', items: ['**BREAKING:** The old widget.'] },
        ],
      },
      { version: '0.3.1', date: '2026-10-20', theme: '', sections: [{ title: 'Fixed', items: ['A bug.'] }] },
    ]);
  });
});

describe('parseInline', () => {
  it('splits out bold, code and links', () => {
    expect(parseInline('Set **this** in `.env`, see [docs](https://x.y).')).toEqual([
      { kind: 'text', text: 'Set ' },
      { kind: 'bold', text: 'this' },
      { kind: 'text', text: ' in ' },
      { kind: 'code', text: '.env' },
      { kind: 'text', text: ', see ' },
      { kind: 'link', text: 'docs', href: 'https://x.y' },
      { kind: 'text', text: '.' },
    ]);
  });
});
