// Writes each public page as finished HTML into dist/site/, with its own title, description and link-preview tags,
// so search engines and chat apps see the page without running JavaScript. The server serves these files and fills in
// __PUBLIC_URL__ with its own address (apps/server/src/site.ts).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const ssrDir = fileURLToPath(new URL('../dist-ssr/', import.meta.url));
const { pages, render } = await import(new URL('../dist-ssr/prerender.js', import.meta.url).href);

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const template = readFileSync(`${dist}index.html`, 'utf8');

// Tags with an absolute URL sit one per line, so a server without PUBLIC_URL can drop exactly those lines.
function head(path, { title, description }) {
  const url = `__PUBLIC_URL__${path === '/' ? '/' : path}`;
  const lines = [
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Hyperion" />`,
    `<meta property="og:title" content="${escape(title)}" />`,
    `<meta property="og:description" content="${escape(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="__PUBLIC_URL__/logo.png" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escape(title)}" />`,
    `<meta name="twitter:description" content="${escape(description)}" />`,
  ];
  if (path === '/') {
    const app = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Hyperion',
      description,
      applicationCategory: 'GameApplication',
      operatingSystem: 'Windows, macOS',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://www.gnu.org/licenses/gpl-3.0.html',
    };
    lines.push(`<script type="application/ld+json">${JSON.stringify(app).replace(/</g, '\\u003c')}</script>`);
  }
  return lines.join('\n    ');
}

mkdirSync(`${dist}site`, { recursive: true });
for (const [path, meta] of Object.entries(pages)) {
  const html = template
    .replace('<title>Hyperion</title>', head(path, meta))
    .replace('<div id="root"></div>', `<div id="root">${render(path)}</div>`);
  if (!html.includes('og:title') || html.includes('<div id="root"></div>')) throw new Error(`Prerendering ${path} failed`);
  writeFileSync(`${dist}site/${path === '/' ? 'index' : path.slice(1)}.html`, html);
}
rmSync(ssrDir, { recursive: true, force: true });
console.log(`Prerendered ${Object.keys(pages).length} pages`);
