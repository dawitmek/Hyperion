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
  const move = (m: globalThis.PointerEvent) =>
    onMove({ x: clamp(((m.clientX - grab.x - box.left) / box.width) * 100, half.x), y: clamp(((m.clientY - grab.y - box.top) / box.height) * 100, half.y) });
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}
