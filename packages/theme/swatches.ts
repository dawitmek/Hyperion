// Each theme's name and its light and dark look, for the theme pickers on the dashboard and in the companion: page,
// card, accent, second accent. The themes themselves are in themes.css.
export const THEME_SWATCHES = {
  default: { label: 'Default', light: ['#f6f6f9', '#ffffff', '#5b5fef', '#e5469a'], dark: ['#0a0b12', '#171a25', '#6366f1', '#a855f7'], note: 'Indigo and plasma, with Geist.' },
  legacy: { label: 'Legacy', light: ['#f6f6f9', '#ffffff', '#0b0c12', '#5b5fef'], dark: ['#07080c', '#141720', '#ffffff', '#6366f1'], note: 'The original look: indigo and plasma on plain black and white, with Geist.' },
  'solar-dusk': { label: 'Solar Dusk', light: ['#fdfbf7', '#f1e9da', '#b45309', '#ca8a04'], dark: ['#1c1917', '#292524', '#f97316', '#0ea5e9'], note: 'Parchment and amber, with Oxanium and sharp corners.' },
  'graphite-mono': { label: 'Graphite Mono', light: ['#ffffff', '#f0f0f0', '#171717', '#3b82f6'], dark: ['#171717', '#262626', '#e5e5e5', '#3b82f6'], note: 'Black, white and grays with a blue accent, with DM Sans and soft corners.' },
  'sage-mist': { label: 'Sage Mist', light: ['#fdfdfd', '#f5f5f5', '#afbea5', '#495940'], dark: ['#070503', '#1e1a14', '#afbea5', '#495940'], note: 'Sage and olive on white or near-black, with Plus Jakarta Sans and round corners.' },
  'mocha-cream': { label: 'Mocha Cream', light: ['#f9f9f9', '#efefef', '#644a40', '#ffdfb5'], dark: ['#111111', '#222222', '#ffe0c2', '#393028'], note: 'Mocha brown and peach cream on light gray or near-black, with medium corners.' },
  tangerine: { label: 'Tangerine', light: ['#e8ebed', '#ffffff', '#e05d38', '#86a7c8'], dark: ['#1c2433', '#2a3040', '#e05d38', '#5a7ca6'], note: 'Tangerine and slate blue on cool gray or deep navy, with Inter.' },
} as const;

export type ThemeId = keyof typeof THEME_SWATCHES;
