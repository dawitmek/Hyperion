import { useId, useState, type ReactNode } from 'react';

// Small hand-made charts for the Live and Analytics pages. Series colours are --series-1 (blue), --series-2
// (orange) and --series-3 (teal, for coins), validated for both themes; text never takes a series colour. Every chart has a hover tooltip and a
// table for screen readers.

export interface Series {
  name: string;
  slot: 1 | 2 | 3;
}

// The smallest of 2, 4, 6, 8 or 10 times a power of ten at or above n: close enough that bars use the height, and
// even, so the halfway gridline is a whole number too.
function niceCeil(n: number) {
  if (n <= 2) return 2;
  const power = 10 ** Math.floor(Math.log10(n));
  return [2, 4, 6, 8, 10].map((m) => m * power).find((v) => v >= n)!;
}

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="chart-legend">
      {series.map((s) => (
        <span key={s.name}>
          <i className={`swatch slot-${s.slot}`} aria-hidden="true" />
          {s.name}
        </span>
      ))}
    </div>
  );
}

export interface Column {
  label: string; // tooltip title and table row
  tick?: string; // x-axis label, shown on a few columns only
  values: number[]; // one per series, stacked bottom to top
  extra?: string[]; // more tooltip lines
  marks?: { icon: ReactNode; lines: string[] }; // events at this point, shown above the column
}

// A value's position in a 100 by 100 box, with the first at the left edge's centre of its share of the width.
const linePoints = (values: number[], top: number) => values.map((v, i) => [((i + 0.5) / values.length) * 100, 100 - (v / top) * 100] as const);

function LineArea({ values, top, slot, className }: { values: number[]; top: number; slot: Series['slot']; className: string }) {
  const id = useId();
  const points = linePoints(values, top);
  const path = points.map(([x, y]) => `${x},${y}`).join(' L');
  return (
    <svg className={className} style={{ color: `var(--series-${slot})` }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M${points[0]![0]},100 L${path} L${points.at(-1)![0]},100 Z`} fill={`url(#${id})`} />
      <path d={`M${path}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// A small trend line for a stat tile, ending in a dot on the latest value. One value is no trend, so it draws nothing.
export function Sparkline({ values, slot }: { values: number[]; slot: Series['slot'] }) {
  if (values.length < 2) return null;
  const top = Math.max(...values, 1);
  const [x, y] = linePoints(values, top).at(-1)!;
  return (
    <span className="sparkline" aria-hidden="true">
      <LineArea values={values} top={top} slot={slot} className="spark-line" />
      <i className={`slot-${slot}`} style={{ left: `${x}%`, top: `${y}%` }} />
    </span>
  );
}

// Stacked columns from one baseline, with clean y ticks and an optional row of event marks above. `line` draws the
// first series as a line instead, for time with no gaps. `selected` picks out one column; `onSelect` makes them clickable.
export function ColumnChart({
  columns,
  series,
  height = 160,
  caption,
  line,
  selected,
  onSelect,
}: {
  columns: Column[];
  series: Series[];
  height?: number;
  caption: string;
  line?: boolean;
  selected?: number;
  onSelect?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceCeil(Math.max(...columns.map((c) => c.values.reduce((a, b) => a + b, 0)), 1));
  const ticks = [top, top / 2, 0];
  const hovered = hover === null ? null : columns[hover];
  const asLine = line && columns.length > 1;
  const values = columns.map((c) => c.values[0]!);
  const peak = values.indexOf(Math.max(...values));

  return (
    <figure className="chart">
      {series.length > 1 && <Legend series={series} />}
      <div
        className={`col-chart ${columns.some((c) => c.marks) ? 'has-marks' : ''} ${asLine ? 'is-line' : ''} ${selected !== undefined ? 'has-selected' : ''} ${onSelect ? 'selectable' : ''}`}
        style={{ height }}
      >
        <div className="col-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="col-plot" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <i key={t} className="col-grid" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true" />
          ))}
          {asLine && <LineArea values={values} top={top} slot={series[0]!.slot} className="col-line" />}
          {columns.map((c, i) => (
            <div
              key={i}
              className={`col-slot ${hover === i ? 'hover' : ''} ${selected === i ? 'selected' : ''}`}
              onMouseEnter={() => setHover(i)}
              onClick={onSelect && (() => onSelect(i))}
              aria-hidden="true"
            >
              {c.marks && <span className="col-mark">{c.marks.icon}</span>}
              {asLine ? (
                <>
                  <i className={`col-dot slot-${series[0]!.slot}`} style={{ bottom: `${(values[i]! / top) * 100}%` }} />
                  {i === peak && values[i]! > 0 && (
                    <span className="col-peak" style={{ bottom: `calc(${(values[i]! / top) * 100}% + 8px)` }}>
                      {compact(values[i]!)}
                    </span>
                  )}
                </>
              ) : (
                <div className="col-bar">
                  {c.values.map((v, s) =>
                    v > 0 ? <i key={s} className={`slot-${series[s]!.slot}`} style={{ height: `${(v / top) * 100}%` }} /> : null,
                  )}
                </div>
              )}
              {c.tick && <span className="col-tick">{c.tick}</span>}
            </div>
          ))}
          {hovered && hover !== null && (
            <div className="chart-tip" style={{ left: `${((hover + 0.5) / columns.length) * 100}%` }} role="status">
              <strong>{hovered.label}</strong>
              {series.map((s, i) => (
                <span key={s.name}>
                  <i className={`swatch slot-${s.slot}`} aria-hidden="true" />
                  {s.name}: {hovered.values[i]}
                </span>
              ))}
              {hovered.extra?.map((line, i) => (
                <span key={`x${i}`}>{line}</span>
              ))}
              {hovered.marks?.lines.map((line, i) => (
                <span key={i} className="muted">
                  {line}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <table className="sr-only">
        <thead>
          <tr>
            <th>{caption}</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((c, i) => (
            <tr key={i}>
              <td>{c.label}</td>
              {c.values.map((v, s) => (
                <td key={s}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface BarRow {
  label: string;
  icon?: ReactNode; // before the label
  values: number[]; // one per series, laid end to end
  value: string; // shown at the end of the bar
  detail?: string; // extra line in the tooltip
}

// Horizontal bars, longest first, each labelled at its end.
export function BarList({ rows, series, caption }: { rows: BarRow[]; series: Series[]; caption: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.values.reduce((a, b) => a + b, 0)), 1);

  return (
    <figure className="chart">
      {series.length > 1 && <Legend series={series} />}
      <ul className="bar-list" onMouseLeave={() => setHover(null)} aria-hidden="true">
        {rows.map((r, i) => (
          <li key={r.label} onMouseEnter={() => setHover(i)} className={hover === i ? 'hover' : ''}>
            <span className="bar-label">
              {r.icon}
              {r.label}
            </span>
            <span className="bar-track">
              {r.values.map((v, s) =>
                v > 0 ? <i key={s} className={`slot-${series[s]!.slot}`} style={{ width: `${(v / max) * 100}%` }} /> : null,
              )}
            </span>
            <span className="bar-value">{r.value}</span>
            {hover === i && r.detail && <span className="chart-tip bar-tip">{r.detail}</span>}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              <td>
                {r.value}
                {r.detail ? `. ${r.detail}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
