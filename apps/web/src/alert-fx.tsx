import type { CSSProperties, ReactNode } from 'react';
import { DEFAULT_ALERT_STYLE, type AlertEffect, type AlertFx, type AlertShape, type AlertStyle } from '@hyperion/shared';

// Alert animations: unlike screen animations, these play around the alert itself. The overlay and the dashboard's
// previews share this, so a preview is what goes on stream.

export const ALERT_EFFECT_LABELS: Record<AlertEffect, string> = {
  emoji_burst: 'Emoji burst',
  character_reveal: 'Character reveal',
  graphic_banner: 'Graphic and banner',
};

export const ALERT_SHAPE_LABELS: Record<AlertShape, string> = { star: 'Star', heart: 'Heart', circle: 'Circle', diamond: 'Diamond' };

// A character reveal opens in the middle of the screen, unless the action's alert was placed by hand.
export const revealsInMiddle = (fx: AlertFx | null | undefined) => fx?.effect === 'character_reveal';
export const MIDDLE = { x: 50, y: 50 };

const SHAPES: Record<AlertShape, string> = {
  star: 'M0-46 13-14 47-14 20 7 30 40 0 21-30 40-20 7-47-14-13-14Z',
  heart: 'M0 42C-58 2-44-40-20-40-9-40-3-33 0-26 3-33 9-40 20-40 44-40 58 2 0 42Z',
  circle: 'M0-45A45 45 0 1 1 0 45 45 45 0 1 1 0-45Z',
  diamond: 'M0-47 42 0 0 47-42 0Z',
};
const SPARKLES = [40, 75, 110, 250, 285, 320];

// Stands in until the host sets a picture or video of their own.
function PlaceholderCharacter() {
  return (
    <svg className="fx-placeholder" viewBox="0 0 120 120" role="img" aria-label="Placeholder character">
      <path d="M38 24 28 6M82 24l10-18" stroke="#4d85ff" strokeWidth="6" strokeLinecap="round" />
      <circle cx="28" cy="6" r="5" fill="#ffd166" />
      <circle cx="92" cy="6" r="5" fill="#ffd166" />
      <rect x="12" y="20" width="96" height="92" rx="42" fill="#4d85ff" />
      <ellipse cx="60" cy="88" rx="30" ry="18" fill="#9cc2ff" />
      <circle cx="42" cy="56" r="11" fill="#fff" />
      <circle cx="78" cy="56" r="11" fill="#fff" />
      <circle cx="44" cy="58" r="5.5" fill="#1b1c3a" />
      <circle cx="80" cy="58" r="5.5" fill="#1b1c3a" />
      <path d="M46 78q14 14 28 0" fill="none" stroke="#1b1c3a" strokeWidth="5" strokeLinecap="round" />
      <circle cx="28" cy="72" r="6" fill="#ff8fb8" />
      <circle cx="92" cy="72" r="6" fill="#ff8fb8" />
    </svg>
  );
}

export const alertFxClass = (fx: AlertFx | null | undefined) => (fx ? `fx-${fx.effect}` : '');
// `showMs` is how long the alert stays up, so a character reveal can fade out just before it goes.
export function alertFxStyle(fx: AlertFx | null | undefined, showMs: number, look: AlertStyle | null) {
  if (!fx) return undefined;
  return { '--fx-speed': fx.speed / 100, '--fx-show': `${showMs}ms`, ...fxColors(fx.color, look ?? DEFAULT_ALERT_STYLE) } as CSSProperties;
}

const FALLBACK_COLOR = '#1ea1ff';
const SEE_THROUGH = 10; // percent: a background this faint can't carry a banner

export const lookHasBackground = (s: AlertStyle) => s.background !== 'none' && s.opacity >= SEE_THROUGH;

// Black or white, whichever reads better on `hex`.
function inkOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 170 ? '#0b0c12' : '#fff';
}

// The banner, its text, and the accents around it: the action's own color, or the alert look's, or a default when the
// look has no background to borrow.
function fxColors(color: string | null, look: AlertStyle) {
  if (color) return { '--fx-plate': color, '--fx-accent': color, '--fx-ink': inkOn(color) };
  if (lookHasBackground(look)) return { '--fx-plate': 'var(--a-bg)', '--fx-accent': look.color1, '--fx-ink': look.textColor };
  return { '--fx-plate': FALLBACK_COLOR, '--fx-accent': FALLBACK_COLOR, '--fx-ink': '#fff' };
}

// When a character reveal's banner has finished arriving, at normal speed, and a fair time to read it.
const REVEAL_MS = 3500;
const READ_MS = 1500;
export const revealNeedsMs = (speed: number) => Math.ceil((REVEAL_MS / (speed / 100) + READ_MS) / 500) * 500;

// What's inside the alert. `media` is its picture or video; the graphic and banner falls back on the emoji without one.
export function AlertContent({ fx, media, text }: { fx: AlertFx | null | undefined; media: ReactNode; text: string }) {
  if (fx?.effect === 'character_reveal') {
    // The banner's two lines: who, usually the first word of the text, then what they did.
    const [first, ...rest] = text.split(' ');
    return (
      <div className="fx-row">
        <div className="fx-lead">
          <span className="fx-slash" aria-hidden="true" />
          <span className="fx-slash" aria-hidden="true" />
          <svg className="fx-zig" viewBox="-50 -50 100 100" aria-hidden="true">
            <path pathLength="1" d="M-14-38H22V-20H9" />
            <path pathLength="1" d="M14 38H-22V20H-9" />
          </svg>
          <svg className="fx-outline" viewBox="-50 -50 100 100" aria-hidden="true">
            <path d={SHAPES[fx.shape]} />
          </svg>
          <span className="fx-streak" aria-hidden="true" />
          <span className="fx-streak" aria-hidden="true" />
          <span className="fx-streak" aria-hidden="true" />
          <span className="fx-symbol" aria-hidden="true">
            {fx.emoji}
          </span>
          <svg className="fx-swoosh" viewBox="-50 -50 100 100" aria-hidden="true">
            <path d="M-34 8Q-30-34 12-40" />
            <path d="M34-8Q30 34-12 40" />
          </svg>
          {SPARKLES.map((angle) => (
            <i key={angle} className="fx-sparkle" style={{ '--angle': `${angle}deg` } as CSSProperties} aria-hidden="true" />
          ))}
          <div className="fx-character">
            <div className="fx-tint">{media || <PlaceholderCharacter />}</div>
          </div>
        </div>
        {text && (
          <div className="fx-plate">
            <span className="fx-plate-text">
              <strong>{first}</strong>
              {rest.length > 0 && <span>{rest.join(' ')}</span>}
            </span>
          </div>
        )}
      </div>
    );
  }
  if (fx?.effect === 'graphic_banner') {
    return (
      <>
        <div className="fx-graphic">{media || <span className="fx-emoji">{fx.emoji}</span>}</div>
        {text && <span className="fx-banner">{text}</span>}
      </>
    );
  }
  return (
    <>
      {media}
      {text && <span>{text}</span>}
    </>
  );
}
