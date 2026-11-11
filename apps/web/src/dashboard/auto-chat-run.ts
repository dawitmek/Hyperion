import { useSyncExternalStore } from 'react';
import { api, ApiError, type Action, type Command } from '../api';
import type { ModeState } from '@hyperion/shared';
import { makeCrowd, nextDelay, nextEvent, PACES, type Pace, type QueueView } from './auto-chat';

// The auto chat run lives here rather than in the Live page, so it keeps going while you visit other pages of the
// dashboard. It ends when you stop it, when test mode ends (the server then turns simulated chat away), or on an error.
// The pace and the extras switch are remembered in this browser.

interface State {
  crowd: string[] | null; // the made-up viewers, while running
  pace: Pace;
  extras: boolean; // gifts, follows, likes and shares as well as chat
  error: string | null;
}

const SETTINGS_KEY = 'hyperion-auto-chat';
function remembered(): Pick<State, 'pace' | 'extras'> {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<State> | null;
    return { pace: saved?.pace && saved.pace in PACES ? saved.pace : 'busy', extras: saved?.extras ?? true };
  } catch {
    return { pace: 'busy', extras: true };
  }
}

let state: State = { crowd: null, error: null, ...remembered() };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
// Each run gets a number; stopping moves it on, so a request still in flight can't schedule the next one.
let run = 0;
// The queue as the live feed shows it, so in queue mode the crowd lines up and the viewer whose turn it is plays.
let queue: QueueView | undefined;
export function setAutoChatMode(mode: ModeState | undefined) {
  queue = mode?.mode === 'queue' ? { turn: mode.viewer, waiting: mode.queue } : undefined;
}

function set(change: Partial<State>) {
  state = { ...state, ...change };
  if ('pace' in change || 'extras' in change) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ pace: state.pace, extras: state.extras }));
    } catch {
      // not remembered, that's all
    }
  }
  listeners.forEach((l) => l());
}

export const setPace = (pace: Pace) => set({ pace });
export const autoChatRunning = () => state.crowd !== null;
export const setExtras = (extras: boolean) => set({ extras });

export function stopAutoChat(error: string | null = null) {
  run++;
  clearTimeout(timer);
  set({ crowd: null, error });
}

export async function startAutoChat() {
  const id = ++run;
  set({ error: null });
  try {
    const [commands, actions] = await Promise.all([api<Command[]>('GET', '/commands'), api<Action[]>('GET', '/actions')]);
    const keywords = commands.filter((c) => c.enabled).map((c) => c.keyword);
    const gifts = [...new Set(actions.flatMap((a) => (a.enabled && a.trigger === 'gift' ? [a.giftName ?? 'Rose'] : [])))];
    const viewers = makeCrowd(Math.random);
    const topGifters = state.extras ? viewers.slice(0, 3) : [];
    await api('POST', '/live/simulate', { viewers: 80 + Math.floor(Math.random() * 900), topGifters });
    if (id !== run) return;
    set({ crowd: viewers });
    const tick = () => {
      if (id !== run) return;
      api('POST', '/live/simulate', nextEvent(viewers, keywords, gifts, Math.random, state.extras, queue)).then(
        () => {
          if (id === run) timer = setTimeout(tick, nextDelay(state.pace, Math.random));
        },
        (e) => id === run && fail(e),
      );
    };
    tick();
  } catch (e) {
    if (id === run) fail(e);
  }
}

// Test mode ending is the normal way a run ends; anything else is worth saying.
function fail(e: unknown) {
  if (e instanceof ApiError && e.status === 409) return stopAutoChat();
  stopAutoChat(`Auto chat stopped: ${e instanceof Error ? e.message : String(e)}`);
}

export function useAutoChat() {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    () => state,
  );
}
