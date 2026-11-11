import { QUEUE_JOIN } from '@hyperion/shared';

// Auto chat for test mode: a made-up crowd that types the host's real commands and sends their real gifts, at a
// human pace, so a recording of the game and overlay looks like a live stream. Each run invents a new crowd, so no two
// recordings share names; within a run the same viewers keep coming back, the way regulars do.

export type Pace = 'calm' | 'busy' | 'hype' | 'hypest';
export type ChatEvent =
  | { viewer: string; text: string }
  | { viewer: string; gift: string; count: number }
  | { viewer: string; event: 'follow' | 'share' | 'like'; count?: number };

export const PACES: Record<Pace, { label: string; minMs: number; maxMs: number }> = {
  calm: { label: 'Calm', minMs: 1400, maxMs: 3200 },
  busy: { label: 'Busy', minMs: 600, maxMs: 1800 },
  hype: { label: 'Hype', minMs: 250, maxMs: 900 },
  // About four a second: well under the server's 600 requests a minute, though most keys will hit cooldowns.
  hypest: { label: 'Hypest', minMs: 100, maxMs: 350 },
};

const FIRST = [
  'nova', 'pixel', 'luna', 'kai', 'mango', 'echo', 'blaze', 'mochi', 'zara', 'drift', 'ember', 'koda', 'sunny', 'jinx', 'orbit',
  'peach', 'rio', 'storm', 'tofu', 'vibe', 'wren', 'yuki', 'ace', 'bean', 'cosmo', 'dash', 'fizz', 'gigi', 'hazel', 'indie',
  'juno', 'kiwi', 'lexi', 'milo', 'nico', 'olive', 'pip', 'quinn', 'remy', 'sage', 'theo', 'uma', 'violet', 'willow', 'zed',
];
const SECOND = [
  'gamer', 'plays', 'cat', 'fox', 'wolf', 'bun', 'star', 'moon', 'gg', 'tv', 'ttv', 'xd', 'core', 'bytes', 'loop', 'zone',
  'craft', 'run', 'bee', 'boo', 'byte', 'hero', 'ninja', 'owl', 'ray', 'skye', 'tea', 'wave', 'xo', 'yeet',
];
const CHATTER = [
  'lol', 'W', 'LETS GOOO', 'no way', 'haha', 'gg', 'omg', 'this is so fun', 'again!!', 'bro', '😂', '🔥', 'hi from 🇧🇷',
  'first time here', 'how does this work', 'L', 'clutch', 'noooo', 'W stream', 'who did that 😭',
];
const SPLIT = ['', '_', '.', ''];

const pick = <T>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length)]!;

// A handle shaped like a real one: two words, maybe a separator, maybe some digits, or one of those reversed.
export function randomHandle(random: () => number) {
  const a = pick(FIRST, random);
  const b = pick(SECOND, random);
  const digits = random() < 0.55 ? String(Math.floor(random() * (random() < 0.5 ? 100 : 10_000))) : '';
  const name = random() < 0.2 ? `${b}${pick(SPLIT, random)}${a}` : `${a}${pick(SPLIT, random)}${b}`;
  return random() < 0.15 ? `${a}${digits || Math.floor(random() * 1000)}` : `${name}${digits}`;
}

export function makeCrowd(random: () => number, size = 10 + Math.floor(random() * 7)) {
  const crowd = new Set<string>();
  while (crowd.size < size) crowd.add(randomHandle(random));
  return [...crowd];
}

// Queue mode as the live feed last showed it: whose turn it is and who's waiting.
export interface QueueView {
  turn: string | null;
  waiting: string[];
}

// One thing chat does next. A few viewers do most of the talking, like a real stream. Without `extras`, viewers only
// chat: no gifts, follows, likes or shares. In queue mode, viewers type "join" to line up and the one whose turn it is
// does most of the pressing, as nobody else's commands count.
export function nextEvent(
  crowd: string[],
  commands: string[],
  gifts: string[],
  random: () => number,
  extras = true,
  queue?: QueueView,
): ChatEvent {
  if (queue?.turn && commands.length && random() < 0.5) return { viewer: queue.turn, text: pick(commands, random) };
  const viewer = crowd[Math.floor(random() ** 1.8 * crowd.length)]!;
  // Without extras, rolls land past their share, so chatter and commands keep the same mix.
  const roll = extras ? random() : 0.12 + random() * 0.88;
  if (roll < 0.06 && gifts.length) {
    const count = random() < 0.75 ? 1 : pick([3, 5, 10], random);
    return { viewer, gift: pick(gifts, random), count };
  }
  if (roll < 0.09) return { viewer, event: 'follow' };
  if (roll < 0.11) return { viewer, event: 'like', count: pick([15, 30, 50], random) };
  if (roll < 0.12) return { viewer, event: 'share' };
  if (roll < 0.27 || !commands.length) return { viewer, text: pick(CHATTER, random) };
  if (queue) {
    const lined = viewer === queue.turn || queue.waiting.includes(viewer);
    return { viewer, text: lined ? pick(CHATTER, random) : QUEUE_JOIN };
  }
  // Real chat often repeats a command or shouts it.
  const command = pick(commands, random);
  return { viewer, text: random() < 0.12 ? command.toUpperCase() : command };
}

export const nextDelay = (pace: Pace, random: () => number) => {
  const { minMs, maxMs } = PACES[pace];
  return minMs + random() * (maxMs - minMs);
};
