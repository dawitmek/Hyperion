import { useEffect, useMemo, useState } from 'react';
import { ALERT_EFFECTS, ALERT_SHAPES, EFFECT_SPEEDS, MAX_ALERT_EMOJI_LENGTH, MAX_EFFECT_AMOUNT, pickEffect, SCREEN_EFFECTS, type ActionEffect, type AlertEffect, type AlertStyle } from '@hyperion/shared';
import type { Action } from '../api';
import { ALERT_EFFECT_LABELS, ALERT_SHAPE_LABELS, lookHasBackground, revealNeedsMs } from '../alert-fx';
import { EFFECT_LABELS, ScreenEffects } from '../effects';
import { GiftBus } from '../overlay-widgets';
import { Seg } from '../ui';

export function EffectOptions() {
  return (
    <>
      {SCREEN_EFFECTS.map((effect) => (
        <option key={effect} value={effect}>
          {EFFECT_LABELS[effect]}
        </option>
      ))}
      <option value="random">Random</option>
    </>
  );
}

export const speedLabel = (speed: number) => `${speed / 100}×`;
const SPEEDS = EFFECT_SPEEDS.map((speed) => [String(speed), speedLabel(speed)] as const);

const COLORS = [
  ['#ff3b30', 'Red'],
  ['#ff4d8d', 'Pink'],
  ['#a855f7', 'Purple'],
  ['#3b82f6', 'Blue'],
  ['#14b8a6', 'Teal'],
  ['#22c55e', 'Green'],
  ['#ffd166', 'Yellow'],
  ['#f97316', 'Orange'],
  ['#ffffff', 'White'],
] as const;

type Value = Pick<Action, 'effect' | 'effectAmount' | 'effectColor' | 'effectSpeed'>;
const AMOUNTS = Array.from({ length: MAX_EFFECT_AMOUNT }, (_, i) => [String(i + 1), String(i + 1)] as const);

// Presets, a picker for anything else, and a way back to no color of its own.
function ColorChoice({ color, ownLabel, name, onChange }: { color: string | null; ownLabel: string; name: string; onChange: (color: string | null) => void }) {
  const custom = !!color && !COLORS.some(([hex]) => hex === color.toLowerCase());
  return (
    <div className="effect-colors">
      <button type="button" className="btn btn-sm effect-own" aria-pressed={!color} onClick={() => onChange(null)}>
        {ownLabel}
      </button>
      {COLORS.map(([hex, label]) => (
        <button key={hex} type="button" className="effect-swatch" style={{ background: hex }} title={label} aria-label={label} aria-pressed={color?.toLowerCase() === hex} onClick={() => onChange(hex)} />
      ))}
      {/* A color input can't be empty, so this stands in front of it and shows when there's no color. */}
      <label className={`effect-color ${color ? '' : 'unset'} ${custom ? 'chosen' : ''}`}>
        <span className="effect-color-chip" style={color ? { background: color } : undefined} />
        Custom
        <input type="color" aria-label={`Custom ${name} color`} value={color ?? '#808080'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

const SHAPES = ALERT_SHAPES.map((s) => [s, ALERT_SHAPE_LABELS[s]] as const);
const EMOJI = ['🎉', '$', '💸', '💖', '🔥', '⭐', '🎁', '👑', '🌹'];
type AlertValue = Pick<Action, 'durationMs' | 'alertEffect' | 'alertEmoji' | 'alertShape' | 'alertEffectColor' | 'alertEffectAmount' | 'alertEffectSpeed'>;

// An action's alert animation. It plays in the alert preview, since it happens around the alert.
export function AlertEffectFields({ value, hasMedia, look, onChange }: { value: AlertValue; hasMedia: boolean; look: AlertStyle; onChange: (patch: Partial<AlertValue>) => void }) {
  const { alertEffect: effect, alertEmoji: emoji, alertShape: shape, alertEffectColor: color, alertEffectAmount: amount, alertEffectSpeed: speed } = value;
  const burst = effect === 'emoji_burst';
  const reveal = effect === 'character_reveal';
  return (
    <div className="effect-fields">
      <div className="form-grid">
        <label className="field">
          Alert animation
          <span className="hint">Plays around the alert itself.</span>
          <select className="input" value={effect ?? ''} onChange={(e) => onChange({ alertEffect: (e.target.value || null) as AlertEffect | null })}>
            <option value="">None</option>
            {ALERT_EFFECTS.map((e) => (
              <option key={e} value={e}>
                {ALERT_EFFECT_LABELS[e]}
              </option>
            ))}
          </select>
        </label>
        {burst && (
          <div className="field">
            Amount
            <span className="hint">How many burst out.</span>
            <Seg label="Alert animation amount" value={String(amount)} options={AMOUNTS} onChange={(n) => onChange({ alertEffectAmount: Number(n) })} />
          </div>
        )}
        {effect && (
          <div className="field">
            Speed
            <span className="hint">1× is normal.</span>
            <Seg label="Alert animation speed" value={String(speed)} options={SPEEDS} onChange={(n) => onChange({ alertEffectSpeed: Number(n) })} />
          </div>
        )}
        {reveal && (
          <div className="field effect-color-field">
            Outline shape
            <span className="hint">{hasMedia ? 'Your picture or video is the character, and becomes the banner\'s badge.' : 'Add a picture or video to replace the placeholder character.'}</span>
            <Seg label="Outline shape" value={shape} options={SHAPES} onChange={(alertShape) => onChange({ alertShape })} />
          </div>
        )}
        {effect && !burst && (
          <div className="field effect-color-field">
            Color
            <span className="hint">{color ? 'The banner and accents in this color.' : lookHasBackground(look) ? "Using your alert look's color." : "Your alert look has no background, so this uses blue."}</span>
            <ColorChoice color={color} ownLabel="Alert look" name="alert animation" onChange={(alertEffectColor) => onChange({ alertEffectColor })} />
          </div>
        )}
        {reveal && value.durationMs < revealNeedsMs(speed) && (
          <p className="notice-inline small effect-color-field">
            This takes a while to reach its banner. Set <strong>Show for</strong> to at least {revealNeedsMs(speed) / 1000} seconds, or viewers won't have time to read it.
          </p>
        )}
        {effect && (burst || reveal || !hasMedia) && (
          <div className="field effect-color-field">
            {reveal ? 'Symbol' : 'Emoji'}
            <span className="hint">{burst ? 'Type several to mix them.' : reveal ? 'The symbol that flashes up first, before the character.' : 'The big graphic. A picture or video takes its place.'}</span>
            <div className="effect-colors">
              <input className="input effect-emoji" aria-label="Emoji" maxLength={MAX_ALERT_EMOJI_LENGTH} value={emoji} onChange={(e) => e.target.value.trim() && onChange({ alertEmoji: e.target.value })} />
              {EMOJI.map((e) => (
                <button key={e} type="button" className="effect-emoji-pick" aria-label={`Use ${e}`} aria-pressed={emoji === e} onClick={() => onChange({ alertEmoji: e })}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// An action's animation, playing on a small stand-in for the stream whenever it changes.
export function EffectFields({ value, onChange }: { value: Value; onChange: (patch: Partial<Value>) => void }) {
  const bus = useMemo(() => new GiftBus(), []);
  const [replays, setReplays] = useState(0);
  const { effect, effectAmount: amount, effectColor: color, effectSpeed: speed } = value;
  useEffect(() => {
    if (effect) bus.emitEffect({ effect: pickEffect(effect), amount, speed, ...(color && { color }) });
  }, [bus, effect, amount, speed, color, replays]);

  return (
    <div className="effect-fields">
      <div className="form-grid">
        <label className="field">
          Screen animation
          <span className="hint">Plays across the whole screen.</span>
          <select className="input" value={effect ?? ''} onChange={(e) => onChange({ effect: (e.target.value || null) as ActionEffect | null })}>
            <option value="">None</option>
            <EffectOptions />
          </select>
        </label>
        {effect && (
          <>
            <div className="field">
              Amount
              <span className="hint">How much of it plays.</span>
              <Seg label="Amount" value={String(amount)} options={AMOUNTS} onChange={(n) => onChange({ effectAmount: Number(n) })} />
            </div>
            <div className="field">
              Speed
              <span className="hint">1× is normal.</span>
              <Seg label="Speed" value={String(speed)} options={SPEEDS} onChange={(n) => onChange({ effectSpeed: Number(n) })} />
            </div>
            <div className="field effect-color-field">
              Color
              <span className="hint">{color ? 'All of it in this color.' : "Using the animation's own colors."}</span>
              <ColorChoice color={color} ownLabel="Own colors" name="animation" onChange={(effectColor) => onChange({ effectColor })} />
            </div>
          </>
        )}
      </div>
      {effect && (
        <div className="alert-preview effect-preview" aria-label="Screen animation preview">
          <ScreenEffects bus={bus} />
          <button type="button" className="btn btn-sm effect-replay" onClick={() => setReplays((n) => n + 1)}>
            Play again
          </button>
        </div>
      )}
    </div>
  );
}
