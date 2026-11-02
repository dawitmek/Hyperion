import { readFileSync } from 'node:fs';
import type { Gift } from '@hyperion/shared';

const LIST = 'https://webcast.tiktok.com/webcast/gift/list/?aid=1988&app_name=tiktok_web&device_platform=web_pc&region=US&language=en-US';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const MIN_GIFTS = 50; // fewer is a broken answer, not TikTok's catalog

type RawGift = { name?: string; diamond_count?: number; image?: { url_list?: string[] } };

const rank = (a: Gift, b: Gift) => a.coins - b.coins || a.name.localeCompare(b.name);

// TikTok's answer as gifts, cheapest first, one per name.
export function parseGiftList(body: unknown): Gift[] {
  const raw = (body as { data?: { gifts?: RawGift[] } } | null)?.data?.gifts ?? [];
  const byName = new Map<string, Gift>();
  for (const g of raw) {
    const name = g.name?.trim();
    const image = g.image?.url_list?.[0];
    if (name && image && g.diamond_count && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { name, coins: g.diamond_count, image });
  }
  return [...byName.values()].sort(rank);
}

// The catalog plus what this host received, marked, including any gift the catalog doesn't have.
export function withReceived(catalog: Gift[], received: { name: string; coins: number | null; image: string | null }[]): Gift[] {
  const got = new Map(received.map((g) => [g.name.toLowerCase(), g]));
  const listed = catalog.map((g) => {
    const mine = got.delete(g.name.toLowerCase());
    return mine ? { ...g, received: true } : g;
  });
  return [...listed, ...[...got.values()].map((g) => ({ name: g.name, coins: g.coins ?? 0, image: g.image, received: true }))].sort(rank);
}

// TikTok's gifts, from the copy shipped with Hyperion until a daily refresh gets a newer one. Refreshing never holds up
// a request, and a failed one keeps the last good list.
export function createGiftCatalog(load: () => Promise<unknown> = () => fetch(LIST, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.json())) {
  let gifts = JSON.parse(readFileSync(new URL('../../assets/gifts.json', import.meta.url), 'utf8')) as Gift[];
  let checked = 0;
  return {
    list(now = Date.now()) {
      if (now - checked >= REFRESH_MS) {
        checked = now;
        load()
          .then(parseGiftList)
          .then((fresh) => {
            if (fresh.length >= MIN_GIFTS) gifts = fresh;
          })
          .catch(() => {});
      }
      return gifts;
    },
  };
}
