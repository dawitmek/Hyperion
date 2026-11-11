import type { ComponentType } from 'react';
import { ChangelogPage } from './ChangelogPage';
import { HomePage } from './HomePage';
import { DownloadPage, FaqPage, FeaturesPage, HowItWorksPage, IntegrationsPage, SelfHostingPage } from './pages';
import { PrivacyPage } from './PrivacyPage';
import { TermsPage } from './TermsPage';

// The public pages. The build prerenders each one to HTML (src/prerender.tsx), so they're readable without JavaScript.
export const SITE_ROUTES: Record<string, ComponentType> = {
  '/': HomePage,
  '/features': FeaturesPage,
  '/integrations': IntegrationsPage,
  '/how-it-works': HowItWorksPage,
  '/self-hosting': SelfHostingPage,
  '/faq': FaqPage,
  '/download': DownloadPage,
  '/privacy': PrivacyPage,
  '/terms': TermsPage,
  '/changelog': ChangelogPage,
};
