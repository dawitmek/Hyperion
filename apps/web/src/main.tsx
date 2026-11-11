import { StrictMode, useLayoutEffect } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import '@hyperion/theme/theme.css';
import { Auth, ForgotPassword, ResetPassword, VerifyEmail } from './Auth';
import { ActivityWindow } from './dashboard/ActivityWindow';
import { Dashboard } from './dashboard/Dashboard';
import { HomePage } from './site/HomePage';
import { SITE_ROUTES } from './site/routes';
import { DEFAULT_TITLE, SITE_PAGES } from './site/seo';
import { Overlay } from './Overlay';
import { usePath } from './router';
import { applyTheme, rememberedTheme, themedPath } from './theme';
import { installNumberDrag } from './ui';
import './app.css';
import './overlay.css';
import './fonts.css';

// After an update, a tab that is still open asks for bundle files that no longer exist. Reload once to pick up
// the new version, but not again within a minute, so a genuinely missing file can't cause a reload loop.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('hyperion-reloaded-at'));
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('hyperion-reloaded-at', String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

installNumberDrag();

const overlayToken = location.pathname.match(/^\/overlay\/([^/]+)/)?.[1];
// Set before the first paint so the overlay never flashes the dashboard background.
if (overlayToken) document.documentElement.classList.add('overlay-page');

function App() {
  const path = usePath();
  useLayoutEffect(() => applyTheme(themedPath(path) ? rememberedTheme() : null), [path]);
  useLayoutEffect(() => {
    if (path !== '/dashboard/activity-window') document.title = SITE_PAGES[path]?.title ?? DEFAULT_TITLE;
  }, [path]);
  if (path === '/dashboard/activity-window') return <ActivityWindow />;
  if (path.startsWith('/dashboard')) return <Dashboard />;
  if (path === '/login') return <Auth key="login" mode="login" />;
  if (path === '/signup') return <Auth key="signup" mode="signup" />;
  if (path === '/forgot-password') return <ForgotPassword />;
  if (path === '/reset-password') return <ResetPassword />;
  if (path === '/verify-email') return <VerifyEmail />;
  const Page = SITE_ROUTES[path] ?? HomePage;
  return <Page />;
}

const root = document.getElementById('root')!;
const app = <StrictMode>{overlayToken ? <Overlay token={decodeURIComponent(overlayToken)} /> : <App />}</StrictMode>;
// Public pages arrive prerendered (src/prerender.tsx); React picks up that HTML instead of drawing it again.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
