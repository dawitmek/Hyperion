import type { PointerEvent } from 'react';

// Drags an alert by its middle, in percent of `stage`, keeping all of it on the screen.
export function dragAlert(e: PointerEvent<HTMLElement>, stage: HTMLElement, onMove: (pos: { x: number; y: number }) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  const box = stage.getBoundingClientRect();
  const alert = e.currentTarget.getBoundingClientRect();
  const grab = { x: e.clientX - (alert.left + alert.width / 2), y: e.clientY - (alert.top + alert.height / 2) };
  const half = { x: (alert.width / 2 / box.width) * 100, y: (alert.height / 2 / box.height) * 100 };
  const clamp = (n: number, h: number) => Math.round(Math.min(Math.max(n, Math.min(h, 50)), Math.max(100 - h, 50)) * 10) / 10;
  // A press that barely moves is a click: it leaves the alert where it is.
  let moved = false;
  const move = (m: globalThis.PointerEvent) => {
    if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
    moved = true;
    onMove({ x: clamp(((m.clientX - grab.x - box.left) / box.width) * 100, half.x), y: clamp(((m.clientY - grab.y - box.top) / box.height) * 100, half.y) });
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}

// Resizes by dragging a handle: the size grows as the pointer gets farther from `anchor` (in page px), the point that
// stays put as it grows, in proportion to how far from it the drag started. Whole percents, within 50% to 200%.
export function dragResize(e: PointerEvent<HTMLElement>, anchor: { x: number; y: number }, start: number, onSize: (size: number) => void, onEnd?: () => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation(); // a resize, not a move
  const from = Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y) || 1;
  const move = (m: globalThis.PointerEvent) => onSize(Math.round(Math.min(200, Math.max(50, (start * Math.hypot(m.clientX - anchor.x, m.clientY - anchor.y)) / from))));
  const stop = () => {
    onEnd?.();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}

// Resizes an alert by a handle on it. An alert grows from its transform origin: the edge it's kept at, or its middle.
export function dragAlertSize(e: PointerEvent<HTMLElement>, start: number, onSize: (size: number) => void, onEnd?: () => void) {
  const alert = e.currentTarget.parentElement!;
  const box = alert.getBoundingClientRect();
  const [x, y] = getComputedStyle(alert).transformOrigin.split(' ').map(parseFloat);
  dragResize(e, { x: box.left + (x! / alert.offsetWidth) * box.width, y: box.top + (y! / alert.offsetHeight) * box.height }, start, onSize, onEnd);
}

// An alert's resize handle: the corner away from where it grows from (the top for one kept at the bottom).
export const alertHandleCorner = (keptAtBottom: boolean) => (keptAtBottom ? 'tr' : 'br');
