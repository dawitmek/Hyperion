import { describe, expect, it } from 'vitest';
import { newestCompanion, type GithubRelease } from '../src/release';

const release = (tag: string, assets: string[], extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: assets.map((name) => ({ name, browser_download_url: `https://example.com/${tag}/${name}` })),
  ...extra,
});

describe('newestCompanion', () => {
  it('skips server releases, even when GitHub lists them first as latest', () => {
    const picked = newestCompanion([
      release('v0.4.0', []),
      release('companion-v0.3.1', ['Hyperion_0.3.1_x64-setup.exe', 'Hyperion_0.3.1_universal.dmg']),
    ]);
    expect(picked).toEqual({
      version: '0.3.1',
      downloads: {
        windows: 'https://example.com/companion-v0.3.1/Hyperion_0.3.1_x64-setup.exe',
        mac: 'https://example.com/companion-v0.3.1/Hyperion_0.3.1_universal.dmg',
      },
    });
  });

  it('takes the highest version, not the first listed, and compares numbers rather than text', () => {
    const picked = newestCompanion([
      release('companion-v0.9.0', ['a.dmg']),
      release('companion-v0.10.0', ['b.dmg']),
      release('companion-v0.2.0', ['c.dmg']),
    ]);
    expect(picked?.version).toBe('0.10.0');
  });

  it('skips drafts, prereleases and releases without an installer', () => {
    const picked = newestCompanion([
      release('companion-v0.6.0', ['x.dmg'], { draft: true }),
      release('companion-v0.5.0', ['x.dmg'], { prerelease: true }),
      release('companion-v0.4.0', ['notes.txt']),
      release('companion-v0.3.0', ['x-setup.exe']),
    ]);
    expect(picked?.version).toBe('0.3.0');
  });

  it('is null when there is no companion release', () => {
    expect(newestCompanion([release('v0.4.0', [])])).toBeNull();
  });
});
