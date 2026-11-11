import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The public pages, prerendered by the web build (apps/web/scripts/prerender.mjs), with this server's address filled
// in. Without PUBLIC_URL there's no address to point canonical and link-preview tags at, so those tags are left out.
export function loadSitePages(webDist: string, publicUrl: string | undefined): Map<string, string> {
  const pages = new Map<string, string>();
  const dir = join(webDist, 'site');
  if (!existsSync(dir)) return pages;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.html')) continue;
    const html = readFileSync(join(dir, file), 'utf8');
    const filled = publicUrl
      ? html.replaceAll('__PUBLIC_URL__', publicUrl)
      : html
          .split('\n')
          .filter((line) => !line.includes('__PUBLIC_URL__'))
          .join('\n');
    pages.set(file === 'index.html' ? '/' : `/${file.slice(0, -'.html'.length)}`, filled);
  }
  return pages;
}

// Pages of the app itself: served, but kept out of search results.
const APP_PATHS = ['/dashboard', '/demo', '/overlay/', '/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'];
export const isAppPath = (path: string) => APP_PATHS.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));

export function robotsTxt(publicUrl: string | undefined) {
  const lines = ['User-agent: *', 'Disallow: /api/', 'Disallow: /dashboard', 'Disallow: /overlay/', 'Disallow: /media/'];
  if (publicUrl) lines.push('', `Sitemap: ${publicUrl}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

export function sitemapXml(publicUrl: string, paths: string[]) {
  const urls = paths.map((p) => `  <url><loc>${publicUrl}${p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
