// The window's sections: each one folds away to its title and a one-line summary, and a bar that sticks to the top
// jumps to any of them. Every section starts folded; which ones were opened is remembered on this PC.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

const OPENED_KEY = "hyperion.companion.opened";

interface Entry {
  id: string;
  label: string; // its name in the bar
  icon: IconName;
  hue: string;
  badge?: string; // something waiting there, like approvals
}

interface Sections {
  opened: Set<string>;
  toggle: (id: string) => void;
  open: (id: string) => void;
  entries: Entry[];
  register: (entry: Entry) => () => void;
}

const SectionsContext = createContext<Sections | null>(null);

function savedOpened(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function SectionsProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState(savedOpened);
  const [entries, setEntries] = useState<Entry[]>([]);
  const save = (next: Set<string>) => {
    setOpened(next);
    try {
      localStorage.setItem(OPENED_KEY, JSON.stringify([...next]));
    } catch {
      // Not remembered on this PC; the section still folds.
    }
  };
  const value: Sections = {
    opened,
    toggle: (id) => {
      const next = new Set(opened);
      if (!next.delete(id)) next.add(id);
      save(next);
    },
    open: (id) => {
      if (opened.has(id)) return;
      save(new Set(opened).add(id));
    },
    entries,
    register: (entry) => {
      setEntries((list) => [...list.filter((e) => e.id !== entry.id), entry]);
      return () => setEntries((list) => list.filter((e) => e.id !== entry.id));
    },
  };
  return <SectionsContext.Provider value={value}>{children}</SectionsContext.Provider>;
}

function useSections() {
  const sections = useContext(SectionsContext);
  if (!sections) throw new Error("Section outside SectionsProvider");
  return sections;
}

export function Section({
  id,
  label,
  icon,
  hue,
  title,
  description,
  summary,
  badge,
  children,
}: {
  id: string;
  label: string;
  icon: IconName;
  hue: string;
  title: string;
  description: ReactNode;
  summary?: string; // shown in place of the section while it's folded
  badge?: string;
  children: ReactNode;
}) {
  const { opened, toggle, register } = useSections();
  const closed = !opened.has(id);
  useEffect(() => register({ id, label, icon, hue, badge }), [id, label, icon, hue, badge]);
  return (
    <section id={`section-${id}`} className={`card stack section ${closed ? "folded" : ""}`} aria-labelledby={`${id}-title`}>
      <div className="section-head">
        <span className={`hue-icon ${hue}`}>
          <Icon name={icon} />
        </span>
        <div className="section-head-text">
          <h2 id={`${id}-title`}>
            <button type="button" className="section-toggle" aria-expanded={!closed} aria-controls={`${id}-body`} onClick={() => toggle(id)}>
              <span className="section-title">{title}</span>
              {closed && badge && <span className="section-summary waiting">{badge}</span>}
              {closed && !badge && summary && <span className="section-summary">{summary}</span>}
              <Icon name="chevron" size={16} />
            </button>
          </h2>
          {!closed && <p className="muted small">{description}</p>}
        </div>
      </div>
      {!closed && (
        <div id={`${id}-body`} className="stack section-body">
          {children}
        </div>
      )}
    </section>
  );
}

// Chips for every section on screen, in the window's order. The one being read is lit.
export function JumpBar() {
  const { entries, open, opened } = useSections();
  const [current, setCurrent] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null); // the section being jumped to
  const [more, setMore] = useState({ left: false, right: false }); // chips scrolled out of sight on either side
  const bar = useRef<HTMLElement>(null);
  const ordered = [...entries].sort((a, b) => {
    const [x, y] = [document.getElementById(`section-${a.id}`), document.getElementById(`section-${b.id}`)];
    return x && y && x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
  });
  const ids = ordered.map((e) => e.id).join();

  // The current section is the last one whose top has passed just under the bar, or the last section once the window
  // is scrolled to the bottom, since a short last section can never reach the top.
  useEffect(() => {
    const update = () => {
      const line = (bar.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let found: string | null = null;
      for (const e of ordered) {
        const top = document.getElementById(`section-${e.id}`)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) found = e.id;
      }
      const bottom = scrollY > 0 && innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      setCurrent(bottom ? (ordered[ordered.length - 1]?.id ?? found) : found);
    };
    const edges = () => {
      const el = bar.current;
      if (el) setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    };
    update();
    edges();
    bar.current?.addEventListener("scroll", edges, { passive: true });
    addEventListener("resize", edges);
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      bar.current?.removeEventListener("scroll", edges);
      removeEventListener("resize", edges);
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [ids]);

  // Keeps the current section's chip in sight when the bar scrolls sideways. Only the bar moves, not the window.
  useEffect(() => {
    const el = bar.current;
    const chip = el?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!el || !chip) return;
    if (chip.offsetLeft < el.scrollLeft) el.scrollLeft = chip.offsetLeft - 16;
    else if (chip.offsetLeft + chip.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = chip.offsetLeft + chip.offsetWidth - el.clientWidth + 16;
  }, [current]);

  // Runs once the section is open, so it lands at the top with its contents below.
  useEffect(() => {
    if (!target) return;
    const section = document.getElementById(`section-${target}`);
    section?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    section?.querySelector<HTMLElement>(".section-toggle")?.focus({ preventScroll: true });
    setCurrent(target);
    setTarget(null);
  }, [target, opened]);

  const jump = (id: string) => {
    open(id);
    setTarget(id);
  };

  if (ordered.length < 2) return null;
  return (
    <nav className={`jump-bar ${more.left ? "more-left" : ""} ${more.right ? "more-right" : ""}`} aria-label="Sections" ref={bar}>
      {ordered.map((e) => (
        <button key={e.id} type="button" className={`jump ${e.hue}`} aria-current={current === e.id ? "location" : undefined} onClick={() => jump(e.id)}>
          <Icon name={e.icon} size={13} />
          {e.label}
          {e.badge && <span className="jump-badge" title={e.badge} />}
        </button>
      ))}
    </nav>
  );
}
