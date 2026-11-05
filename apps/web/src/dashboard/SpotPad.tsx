import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

// One place the knob can rest, across and down the screen from 0 to 1.
export type PadSpot<T extends string> = { id: T; x: number; y: number; label: string };

// Distances are measured as the spots are drawn: across counts for more than down on a wide pad, less on a tall one.
const distanceOn = (aspect: number) => (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const ARROWS: Record<string, { x: number; y: number }> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

// A small screen with a knob on it: drag the knob (or press anywhere) and it lands on the nearest spot when let go.
// Each spot is a dot that can be clicked too, and arrow keys move between them. `custom` is where something placed by
// hand sits instead, as a hollow knob, until a spot is picked. A portrait pad is a phone screen, with the parts TikTok
// covers shaded: the spots are in the part between, and `custom` can be out over the shading.
export function SpotPad<T extends string>({
  spots,
  value,
  custom,
  label,
  portrait,
  onPick,
}: {
  spots: PadSpot<T>[];
  value: T | null;
  custom?: { x: number; y: number } | null;
  label: string;
  portrait?: boolean; // a phone screen's shape
  onPick: (id: T) => void;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const area = () => pad.current!.querySelector('.spot-pad-area')!.getBoundingClientRect();
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const { width, height } = area();
    return distanceOn(width / height || 1)(a, b);
  };
  const nearest = (at: { x: number; y: number }) => spots.reduce((best, s) => (distance(s, at) < distance(best, at) ? s : best));
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const picked = spots.find((s) => s.id === value && !custom);
  const knob = drag ?? picked ?? custom ?? { x: 0.5, y: 0.5 };
  const aimed = drag ? nearest(drag).id : picked?.id;

  // Where the pointer is on the pad, kept to the area the spots cover.
  const at = (e: { clientX: number; clientY: number }) => {
    const inner = area();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return { x: clamp((e.clientX - inner.left) / inner.width), y: clamp((e.clientY - inner.top) / inner.height) };
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(at(e));
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => drag && setDrag(at(e));
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const landed = nearest(at(e));
    setDrag(null);
    if (landed.id !== picked?.id) onPick(landed.id);
  };
  // The nearest spot that way, from the one picked (or the knob).
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const way = ARROWS[e.key];
    if (!way) return;
    e.preventDefault();
    const from = picked ?? knob;
    const ahead = spots.filter((s) => (s.x - from.x) * way.x + (s.y - from.y) * way.y > 0.01);
    if (ahead.length === 0) return;
    // Mostly in that direction first, then closest.
    const { width, height } = area();
    const score = (s: PadSpot<T>) => distance(s, from) + Math.abs((s.x - from.x) * way.y * (width / height || 1) + (s.y - from.y) * way.x) * 2;
    const next = ahead.reduce((best, s) => (score(s) < score(best) ? s : best));
    onPick(next.id);
    (pad.current!.querySelector(`[data-spot="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  const place = (p: { x: number; y: number }) => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` });

  return (
    <div ref={pad} className={`spot-pad ${portrait ? 'portrait' : ''} ${drag ? 'dragging' : ''}`} role="radiogroup" aria-label={label} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onKeyDown={key}>
      <div className="spot-pad-area">
        {spots.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            data-spot={s.id}
            aria-checked={s.id === picked?.id}
            aria-label={s.label}
            title={s.label}
            tabIndex={s.id === (picked ?? spots[0]!).id ? 0 : -1}
            className={`spot-pad-dot ${s.id === aimed ? 'aimed' : ''}`}
            style={place(s)}
            onPointerDown={(e) => e.button === 0 && e.preventDefault()} // the pad drags; this keeps focus off the dot until the pick
            onClick={(e) => e.detail === 0 && onPick(s.id)} // keyboard; a click is the pad's drag
          />
        ))}
        <span className={`spot-pad-knob ${!drag && !picked && custom ? 'custom' : ''}`} style={place(knob)} aria-hidden="true" />
      </div>
    </div>
  );
}
