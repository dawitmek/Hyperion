import { ALERT_FONTS, type AlertFont } from '@hyperion/shared';
import { ALERT_FONT_STACKS } from '../alert-style';

// Every font, each showing sample text in that font. A native select can't: browsers ignore fonts on its options.
export function FontPicker({ value, onChange }: { value: AlertFont; onChange: (font: AlertFont) => void }) {
  return (
    <div className="field">
      Font
      <div className="font-picker" role="radiogroup" aria-label="Font">
        {ALERT_FONTS.map((f) => {
          const [name, stack] = ALERT_FONT_STACKS[f];
          return (
            <button key={f} type="button" role="radio" aria-checked={value === f} aria-label={name} className="font-tile" onClick={() => onChange(f)}>
              <span className="font-sample" data-font={f} style={{ fontFamily: stack }}>
                Hello 123
              </span>
              <span className="font-name">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
