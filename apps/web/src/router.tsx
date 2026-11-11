import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

// A few pages don't justify a router library: the path lives in history, and links push to it.
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') window.addEventListener('popstate', () => listeners.forEach((l) => l()));

// The page being prerendered at build time, where there's no location to read.
let serverPath = '/';
export function setServerPath(path: string) {
  serverPath = path;
}

// The demo (/demo, /demo/commands, ...) is the dashboard with made-up data. The app sees /dashboard paths either way;
// only the address bar says /demo.
export const isDemo = () => typeof location !== 'undefined' && /^\/demo(\/|$)/.test(location.pathname);
const appPath = (url: string) => (isDemo() ? url.replace(/^\/demo(?=\/|$)/, '/dashboard') : url);
export const href = (path: string) => (isDemo() ? path.replace(/^\/dashboard(?=[/?#]|$)/, '/demo') : path);

export function navigate(to: string, { replace = false } = {}) {
  const path = href(to);
  if (path === location.pathname) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  window.scrollTo(0, 0);
  listeners.forEach((l) => l());
}

export function usePath() {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    () => appPath(location.pathname),
    () => (typeof location === 'undefined' ? serverPath : appPath(location.pathname)),
  );
}

export function Link({ href: to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // Let the browser handle new-tab clicks and anything off-site.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={href(to)} onClick={click} {...rest} />;
}
