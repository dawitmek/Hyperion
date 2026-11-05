import { useEffect, useRef } from 'react';
import type { ScreenEffect } from '@hyperion/shared';
import { useBursts, useEffects, type GiftBus } from './overlay-widgets';

// Full-screen animations, which actions play. Any of them can
// stand in for any other: each is only a recipe for particles, and one canvas pair draws them all.

export const EFFECT_LABELS: Record<ScreenEffect, string> = {
  fireworks: 'Fireworks',
  confetti: 'Confetti',
  hearts: 'Hearts',
  coins: 'Coin rain',
  balloons: 'Balloons',
  snow: 'Snow',
  stars: 'Stars',
  bubbles: 'Bubbles',
};

type Look = 'glow' | 'paper' | 'heart' | 'coin' | 'balloon' | 'flake' | 'star' | 'bubble' | 'emoji';
type Particle = {
  look: Look;
  color: string; // the emoji itself, for that look
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  life: number; // 1 down to 0
  fade: number; // life lost per frame
  size: number; // half its width, in pixels
  angle: number;
  spin: number;
  sway: number; // side to side, in pixels per frame
  phase: number;
  flip: boolean; // turns over as it moves, like paper or a coin
  pulse: boolean; // grows in and shrinks out, like a twinkle
  wait: number; // ms until it appears, so one recipe can unfold over time
  rate: number; // how fast it all plays: 1 is normal
};
type New = Partial<Particle> & Pick<Particle, 'look' | 'color' | 'x' | 'y' | 'size'>;

const MIXED = ['#ff4d8d', '#a855f7', '#ffd166', '#60a5fa', '#34d399', '#ffffff'];
const OWN: Partial<Record<ScreenEffect, string[]>> = {
  hearts: ['#ff4d8d', '#ff2d55', '#f472b6'],
  coins: ['#ffd166', '#f5a524'],
  snow: ['#ffffff', '#dbeafe'],
  stars: ['#ffd166', '#ffffff', '#fde68a'],
  bubbles: ['#93c5fd', '#a5f3fc', '#ddd6fe'],
};
const MAX_PARTICLES = 1600;
const SPRITE = 32; // half a sprite's width

const HEART = new Path2D('M0 22C-30 2-22-20-8-20c5 0 8 4 8 8 0-4 3-8 8-8 14 0 22 22-8 42Z');
const STAR = new Path2D('M0-28 8-9 28-7 13 6 18 26 0 15-18 26-13 6-28-7-8-9Z');

// Each look in each color, drawn once. Stamping a picture is far cheaper than drawing a shape on every frame.
const sprites = new Map<string, HTMLCanvasElement>();
function sprite(look: Look, color: string) {
  const key = `${look}${color}`;
  let image = sprites.get(key);
  if (image) return image;
  image = document.createElement('canvas');
  image.width = image.height = SPRITE * (look === 'emoji' ? 4 : 2); // emoji are detailed, and drawn big
  const g = image.getContext('2d')!;
  g.translate(image.width / 2, image.height / 2);
  g.fillStyle = color;
  g.strokeStyle = color;
  if (look === 'emoji') {
    g.fillStyle = '#000';
    g.font = `${SPRITE * 3}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(color, 0, SPRITE * 0.2);
  } else if (look === 'glow') {
    const gradient = g.createRadialGradient(0, 0, 0, 0, 0, SPRITE);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(1, 'transparent');
    g.fillStyle = gradient;
    g.fillRect(-SPRITE, -SPRITE, SPRITE * 2, SPRITE * 2);
  } else if (look === 'paper') g.fillRect(-14, -24, 28, 48);
  else if (look === 'heart') g.fill(HEART);
  else if (look === 'star') g.fill(STAR);
  else if (look === 'coin') {
    g.beginPath();
    g.arc(0, 0, 28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.45)';
    g.beginPath();
    g.arc(0, 0, 18, 0, Math.PI * 2);
    g.fill();
  } else if (look === 'balloon') {
    g.beginPath();
    g.ellipse(0, -6, 20, 24, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-4, 17);
    g.lineTo(4, 17);
    g.lineTo(0, 24);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.55)';
    g.beginPath();
    g.ellipse(-8, -15, 4, 7, 0.4, 0, Math.PI * 2);
    g.fill();
  } else if (look === 'flake') {
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath();
      g.moveTo(-26, 0);
      g.lineTo(26, 0);
      g.stroke();
    }
  } else {
    g.globalAlpha = 0.25;
    g.beginPath();
    g.arc(0, 0, 26, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.9;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(-10, -10, 4, 7, 0.7, 0, Math.PI * 2);
    g.fill();
  }
  sprites.set(key, image);
  return image;
}

// Each emoji in the text, whole: flags and skin tones are several characters.
const emojiIn = (text: string) => [...new Intl.Segmenter().segment(text)].map((s) => s.segment).filter((s) => s.trim());

const between = (low: number, high: number) => low + Math.random() * (high - low);

// Each animation's recipe. `unit` keeps it the same size relative to the screen, whether stream or small preview.
type Scene = { w: number; h: number; unit: number; add: (p: New) => void; color: () => string };
const RECIPES: Record<ScreenEffect, (scene: Scene, amount: number) => void> = {
  fireworks({ w, h, unit, add, color }, amount) {
    for (let burst = 0; burst < amount; burst++) {
      const x = w * between(0.2, 0.8);
      const y = h * between(0.15, 0.5);
      const shade = color();
      for (let i = 0; i < 90; i++) {
        const angle = (i / 90) * Math.PI * 2 + Math.random() * 0.1;
        const speed = between(2.5, 7) * unit;
        add({ look: 'glow', color: Math.random() < 0.2 ? '#ffffff' : shade, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, gravity: 0.05 * unit, drag: 0.985, fade: 0.011, size: 16 * unit, wait: burst * 350 });
      }
    }
  },
  confetti({ w, h, unit, add, color }, amount) {
    for (let i = 0; i < 70 * amount; i++) {
      const left = i % 2 === 0;
      add({ look: 'paper', color: color(), x: left ? 0 : w, y: h, vx: (left ? 1 : -1) * between(4, 19) * unit, vy: -between(12, 28) * unit, gravity: 0.3 * unit, drag: 0.985, fade: 0.0055, size: between(9, 15) * unit, spin: between(-0.2, 0.2), flip: true, wait: between(0, 500) });
    }
  },
  hearts({ w, h, unit, add, color }, amount) {
    for (let i = 0; i < 16 * amount; i++) add({ look: 'heart', color: color(), x: w * Math.random(), y: h + 40 * unit, vy: -between(3, 6) * unit, sway: between(0.6, 1.6) * unit, fade: 0.004, size: between(20, 46) * unit, spin: between(-0.01, 0.01), wait: between(0, 1800) });
  },
  coins({ w, unit, add, color }, amount) {
    for (let i = 0; i < 32 * amount; i++) add({ look: 'coin', color: color(), x: w * Math.random(), y: -40 * unit, vy: between(3, 7) * unit, gravity: 0.14 * unit, fade: 0.003, size: between(14, 26) * unit, flip: true, wait: between(0, 1600) });
  },
  balloons({ w, h, unit, add, color }, amount) {
    for (let i = 0; i < 9 * amount; i++) add({ look: 'balloon', color: color(), x: w * Math.random(), y: h + 80 * unit, vy: -between(2.5, 4.5) * unit, sway: between(0.5, 1.2) * unit, fade: 0.0022, size: between(44, 74) * unit, wait: between(0, 1800) });
  },
  snow({ w, unit, add, color }, amount) {
    for (let i = 0; i < 60 * amount; i++) add({ look: 'flake', color: color(), x: w * Math.random(), y: -30 * unit, vy: between(1.5, 4) * unit, sway: between(0.4, 1.3) * unit, fade: 0.0028, size: between(7, 20) * unit, spin: between(-0.03, 0.03), wait: between(0, 2600) });
  },
  stars({ w, h, unit, add, color }, amount) {
    for (let i = 0; i < 24 * amount; i++) add({ look: 'star', color: color(), x: w * Math.random(), y: h * Math.random(), vy: -0.3 * unit, fade: 0.017, size: between(14, 40) * unit, spin: between(-0.04, 0.04), pulse: true, wait: between(0, 2200) });
  },
  bubbles({ w, h, unit, add, color }, amount) {
    for (let i = 0; i < 26 * amount; i++) add({ look: 'bubble', color: color(), x: w * Math.random(), y: h + 30 * unit, vy: -between(2, 5.5) * unit, sway: between(0.8, 2) * unit, fade: between(0.003, 0.007), size: between(12, 42) * unit, wait: between(0, 2000) });
  },
};

// Plays the effects and bursts that come through the bus.
export function ScreenEffects({ bus }: { bus: GiftBus }) {
  const trails = useRef<HTMLCanvasElement>(null); // fades rather than clears, for sparks' trails
  const crisp = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef<number | null>(null);
  const last = useRef(0);

  const draw = (time: number) => {
    const a = trails.current;
    const b = crisp.current;
    const faded = a?.getContext('2d');
    const clean = b?.getContext('2d');
    if (!a || !b || !faded || !clean) return;
    for (const c of [a, b]) if (c.width !== c.clientWidth || c.height !== c.clientHeight) (c.width = c.clientWidth), (c.height = c.clientHeight);
    const ms = Math.min(time - last.current, 50);
    const frames = ms / (1000 / 60); // the recipes' speeds are per frame at 60 frames a second
    last.current = time;

    faded.setTransform(1, 0, 0, 1, 0, 0);
    faded.globalCompositeOperation = 'destination-out';
    faded.globalAlpha = 1;
    faded.fillStyle = 'rgba(0, 0, 0, 0.22)';
    faded.fillRect(0, 0, a.width, a.height);
    faded.globalCompositeOperation = 'lighter';
    clean.setTransform(1, 0, 0, 1, 0, 0);
    clean.clearRect(0, 0, b.width, b.height);

    particles.current = particles.current.filter((p) => p.life > 0);
    for (const p of particles.current) {
      if (p.wait > 0) {
        p.wait -= ms * p.rate;
        continue;
      }
      const step = frames * p.rate;
      p.vy += p.gravity * step;
      p.vx *= p.drag ** step;
      p.vy *= p.drag ** step;
      p.phase += 0.06 * step;
      p.x += (p.vx + Math.sin(p.phase) * p.sway) * step;
      p.y += p.vy * step;
      p.angle += p.spin * step;
      p.life -= p.fade * step;
      const g = p.look === 'glow' ? faded : clean;
      g.globalAlpha = p.look === 'glow' ? Math.max(0, p.life) : Math.min(1, Math.max(0, p.life) * 4);
      const size = p.size * (p.look === 'glow' ? 0.4 + 0.6 * p.life : p.pulse ? Math.sin(Math.PI * Math.max(0, p.life)) : 1);
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);
      const turn = p.flip ? Math.cos(p.phase * 2) : 1;
      g.setTransform(cos * turn, sin * turn, -sin, cos, p.x, p.y);
      g.drawImage(sprite(p.look, p.color), -size, -size, size * 2, size * 2);
    }
    if (particles.current.length > 0) frame.current = requestAnimationFrame(draw);
    else {
      faded.setTransform(1, 0, 0, 1, 0, 0);
      faded.clearRect(0, 0, a.width, a.height);
      frame.current = null;
    }
  };

  const add = (p: New, speed: number) => {
    if (particles.current.length < MAX_PARTICLES) particles.current.push({ vx: 0, vy: 0, gravity: 0, drag: 1, life: 1, fade: 0.01, angle: 0, spin: 0, sway: 0, phase: Math.random() * 6, flip: false, pulse: false, wait: 0, rate: speed / 100, ...p });
  };

  const start = () => {
    if (frame.current !== null) return;
    last.current = performance.now();
    frame.current = requestAnimationFrame(draw);
  };

  const play = (effect: ScreenEffect, amount: number, speed: number, color?: string) => {
    const c = crisp.current;
    // A hidden tab doesn't draw, so particles would pile up and all draw at once on return.
    if (!c || document.hidden) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const shades = OWN[effect] ?? MIXED;
    RECIPES[effect](
      {
        w,
        h,
        unit: Math.max(0.3, Math.min(w, h) / 1080),
        color: () => color ?? shades[Math.floor(Math.random() * shades.length)]!,
        add: (p) => add(p, speed),
      },
      amount,
    );
    start();
  };

  // Out from a point in every direction, then gravity takes over and they fall away below it.
  useBursts(bus, ({ box, emoji, amount, speed }) => {
    const c = crisp.current;
    const shapes = emojiIn(emoji);
    if (!c || document.hidden || shapes.length === 0) return;
    const canvas = c.getBoundingClientRect();
    const across = c.clientWidth / canvas.width; // the overlay is scaled to fit its browser source
    const unit = Math.max(0.3, Math.min(c.clientWidth, c.clientHeight) / 1080);
    const x = (box.left + box.width / 2 - canvas.left) * across;
    const y = (box.top + box.height / 2 - canvas.top) * across;
    for (let i = 0; i < 14 * amount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const push = between(5, 15) * unit;
      add({ look: 'emoji', color: shapes[i % shapes.length]!, x, y, vx: Math.cos(angle) * push * 1.3, vy: Math.sin(angle) * push - 5 * unit, gravity: 0.3 * unit, drag: 0.99, fade: 0.0065, size: between(24, 46) * unit, spin: between(-0.08, 0.08), wait: between(0, 160) }, speed);
    }
    start();
  });
  useEffects(bus, ({ effect, amount, speed, color }) => play(effect, amount, speed, color));
  useEffect(() => {
    // React's dev mode unmounts and remounts once, which can land just after the first play.
    if (particles.current.length > 0) start();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);
  return (
    <>
      <canvas ref={trails} className="w-fireworks" aria-hidden="true" />
      <canvas ref={crisp} className="w-fireworks" aria-hidden="true" />
    </>
  );
}
