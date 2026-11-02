import type { CSSProperties } from 'react';
import { DEFAULT_ALERT_STYLE, type AlertAnimation, type AlertFont, type AlertStyle } from '@hyperion/shared';

// Fonts for alerts and widgets. Most come with Hyperion (fonts.css); Impact, Georgia, Courier and Comic Sans are on
// Windows and macOS, with fallbacks. Browsers fetch a bundled font only once something uses it.
export const ALERT_FONT_STACKS: Record<AlertFont, [string, string]> = {
  geist: ['Geist', "'Geist Variable', system-ui, sans-serif"],
  oxanium: ['Oxanium', "'Oxanium Variable', system-ui, sans-serif"],
  'dm-sans': ['DM Sans', "'DM Sans Variable', system-ui, sans-serif"],
  jakarta: ['Plus Jakarta Sans', "'Plus Jakarta Sans Variable', system-ui, sans-serif"],
  fredoka: ['Fredoka', "'Fredoka Variable', system-ui, sans-serif"],
  bebas: ['Bebas Neue', "'Bebas Neue', Impact, sans-serif"],
  anton: ['Anton', "Anton, Impact, sans-serif"],
  impact: ['Impact', "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif"],
  orbitron: ['Orbitron', "'Orbitron Variable', system-ui, sans-serif"],
  righteous: ['Righteous', "Righteous, system-ui, sans-serif"],
  'press-start': ['Press Start 2P', "'Press Start 2P', monospace"],
  bangers: ['Bangers', "Bangers, Impact, cursive"],
  'permanent-marker': ['Permanent Marker', "'Permanent Marker', cursive"],
  pacifico: ['Pacifico', "Pacifico, cursive"],
  lobster: ['Lobster', "Lobster, cursive"],
  caveat: ['Caveat', "'Caveat Variable', cursive"],
  comic: ['Comic Sans', "'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', cursive"],
  georgia: ['Georgia', "Georgia, 'Times New Roman', serif"],
  courier: ['Courier', "'Courier New', Courier, monospace"],
};

// How long each entrance takes at normal speed, in seconds.
const ANIMATION_SECONDS: Record<AlertAnimation, number> = { pop: 0.4, 'slide-up': 0.5, 'slide-down': 0.5, fade: 0.6, bounce: 0.8, zoom: 0.45 };
export const animationSeconds = (s: AlertStyle) => ANIMATION_SECONDS[s.animation] / ((s.speed ?? 100) / 100);

const fade = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
const NONE = '0 0 #0000';

// An alert's look as a class and CSS variables for .overlay-alert (overlay.css), so the overlay and the dashboard's
// previews draw it the same way.
export function alertLook(style: AlertStyle | null): { className: string; style: CSSProperties } {
  const s = style ?? DEFAULT_ALERT_STYLE;
  const background =
    s.background === 'none'
      ? 'none'
      : s.background === 'solid'
        ? fade(s.color1, s.opacity)
        : `linear-gradient(${s.angle}deg, ${fade(s.color1, s.opacity)}, ${fade(s.color2, s.opacity)})`;
  return {
    className: `anim-${s.animation}${s.shine ? '' : ' no-shine'}`,
    style: {
      '--a-bg': background,
      '--a-ink': s.textColor,
      '--a-font': ALERT_FONT_STACKS[s.font][1],
      '--a-size': `${s.size}px`,
      '--a-weight': s.weight,
      '--a-radius': `${s.radius}px`,
      '--a-border': s.borderWidth ? `inset 0 0 0 ${s.borderWidth}px ${s.borderColor}` : NONE,
      '--a-glow': s.glow ? `0 18px 50px -12px ${fade(s.glowColor, s.glow)}, 0 0 60px -12px ${fade(s.glowColor, s.glow * 0.8)}` : NONE,
      '--a-text-shadow': s.textShadow ? '0 2px 6px rgba(0, 0, 0, 0.35)' : 'none',
      '--a-case': s.uppercase ? 'uppercase' : 'none',
      '--a-speed': (s.speed ?? 100) / 100,
      '--a-duration': `${animationSeconds(s)}s`,
    } as CSSProperties,
  };
}
