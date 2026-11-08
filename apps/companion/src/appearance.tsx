// The companion's look. It matches the dashboard's (Settings → Appearance), unless a look of its own is picked here,
// which is kept on this PC only.
import { THEME_SWATCHES, type ThemeId } from "@hyperion/theme/swatches";
import { Modal } from "./modal";

export type Mode = "system" | "light" | "dark";
export type Style = "full" | "colors";
export interface Look {
  theme: string;
  style: Style;
  mode: Mode;
}

const KEY = "hyperion.companion.look";

export function savedLook(): Look | null {
  try {
    const look = JSON.parse(localStorage.getItem(KEY) ?? "null") as Look | null;
    return look && look.theme in THEME_SWATCHES ? look : null;
  } catch {
    return null;
  }
}

export function saveLook(look: Look | null) {
  try {
    if (look) localStorage.setItem(KEY, JSON.stringify(look));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage can be off; the look still applies until the companion closes.
  }
}

// Puts a look on the page, and follows the computer's light or dark while it's "system".
export function applyLook(look: Look): () => void {
  const root = document.documentElement;
  if (look.theme !== "default") root.dataset.theme = look.theme;
  else delete root.dataset.theme;
  if (look.style === "full") root.dataset.themeStyle = "full";
  else delete root.dataset.themeStyle;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => (root.dataset.mode = look.mode === "dark" || (look.mode === "system" && system.matches) ? "dark" : "light");
  apply();
  system.addEventListener("change", apply);
  return () => system.removeEventListener("change", apply);
}

const themeName = (theme: string) => THEME_SWATCHES[theme as ThemeId]?.label ?? "Default";
const MODE_NAMES: Record<Mode, string> = { system: "matching your computer's light or dark", light: "light", dark: "dark" };

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([option, name]) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onChange(option)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export function Appearance({ dashboard, own, paired, onChange, onClose }: { dashboard: Look; own: Look | null; paired: boolean; onChange: (look: Look | null) => void; onClose: () => void }) {
  const look = own ?? dashboard;
  const set = (change: Partial<Look>) => onChange({ ...look, ...change });
  return (
    <Modal
      title="Appearance"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <label className="switch look-follow">
        <input type="checkbox" checked={own === null} onChange={(e) => onChange(e.target.checked ? null : dashboard)} />
        <span>
          Match the dashboard
          <small>
            {paired
              ? `Uses the look picked on the dashboard under Settings → Appearance: ${themeName(dashboard.theme)}, ${MODE_NAMES[dashboard.mode]}.`
              : "Uses the look picked on the dashboard under Settings → Appearance, once this PC is paired."}
          </small>
        </span>
      </label>
      {own && (
        <>
          <div className="field">
            Light or dark
            <Seg<Mode> label="Light or dark" value={look.mode} options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]} onChange={(mode) => set({ mode })} />
          </div>
          <div className="field">
            Theme
            <div className="choices look-themes" role="radiogroup" aria-label="Theme">
              {(Object.keys(THEME_SWATCHES) as ThemeId[]).map((id) => (
                <label key={id} className={`choice ${look.theme === id ? "selected" : ""}`}>
                  <input type="radio" name="companion-theme" checked={look.theme === id} onChange={() => set({ theme: id })} />
                  <span className="theme-swatch" aria-hidden="true">
                    {(["light", "dark"] as const).map((mode) => {
                      const [page, card, accent, second] = THEME_SWATCHES[id][mode];
                      return (
                        <span key={mode} className="theme-swatch-half" style={{ background: page }}>
                          <span className="theme-swatch-card" style={{ background: card }}>
                            <span style={{ background: accent }} />
                            <span style={{ background: second }} />
                          </span>
                        </span>
                      );
                    })}
                  </span>
                  <strong>{THEME_SWATCHES[id].label}</strong>
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            What the theme changes
            <Seg<Style> label="What the theme changes" value={look.style} options={[["colors", "Colors only"], ["full", "Full theme"]]} onChange={(style) => set({ style })} />
          </div>
        </>
      )}
    </Modal>
  );
}
