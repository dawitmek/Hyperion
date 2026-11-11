import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { setServerPath } from './router';
import { SITE_ROUTES } from './site/routes';
import { SITE_PAGES } from './site/seo';

// Built with `vite build --ssr` and run by scripts/prerender.mjs, which writes each public page's HTML.
export const pages = SITE_PAGES;

export function render(path: string) {
  const Page = SITE_ROUTES[path]!;
  setServerPath(path);
  return renderToString(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}
