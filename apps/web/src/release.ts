import { useEffect, useState } from 'react';

export const GITHUB_URL = 'https://github.com/dawitmek/Hyperion';
export const RELEASES_URL = `${GITHUB_URL}/releases`;

export type Platform = 'windows' | 'mac';

export interface CompanionRelease {
  version: string;
  downloads: Partial<Record<Platform, string>>;
}

export interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

const TAG_PREFIX = 'companion-v';

// The installers come from the release workflow: an NSIS setup .exe for Windows and a universal .dmg for macOS.
function pick(release: GithubRelease): CompanionRelease {
  const find = (test: (name: string) => boolean) => release.assets.find((a) => test(a.name))?.browser_download_url;
  return {
    version: release.tag_name.slice(TAG_PREFIX.length),
    downloads: {
      windows: find((n) => n.endsWith('-setup.exe')) ?? find((n) => n.endsWith('.msi')),
      mac: find((n) => n.endsWith('.dmg')),
    },
  };
}

const parseVersion = (version: string) => {
  const parts = version.split(/[-+]/)[0]!.split('.').map(Number);
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
};
const compareVersions = (a: number[], b: number[]) => a.map((n, i) => n - b[i]!).find((d) => d !== 0) ?? 0;

// The newest published companion release with an installer. Server releases (v1.2.3) share the repository and can be
// GitHub's "latest", so this picks by tag and version the way the companion's own updater does (updater.rs).
export function newestCompanion(releases: GithubRelease[]): CompanionRelease | null {
  let best: { version: number[]; release: CompanionRelease } | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease || !r.tag_name.startsWith(TAG_PREFIX)) continue;
    const version = parseVersion(r.tag_name.slice(TAG_PREFIX.length));
    const release = pick(r);
    if (!version || (!release.downloads.windows && !release.downloads.mac)) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, release };
  }
  return best?.release ?? null;
}

export function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh/.test(ua)) return 'mac';
  return null;
}

// undefined while loading, null when there's no published release (or GitHub can't be reached).
export function useCompanionRelease() {
  const [release, setRelease] = useState<CompanionRelease | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${GITHUB_URL.slice('https://github.com/'.length)}/releases?per_page=20`)
      .then((res) => (res.ok ? (res.json() as Promise<GithubRelease[]>) : null))
      .then((r) => !cancelled && setRelease(r ? newestCompanion(r) : null))
      .catch(() => !cancelled && setRelease(null));
    return () => {
      cancelled = true;
    };
  }, []);
  return release;
}
