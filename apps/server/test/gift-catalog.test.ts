import { describe, expect, it } from 'vitest';
import { createGiftCatalog, parseGiftList, withReceived } from '../src/actions/gift-catalog.js';

const raw = (name: string, diamond_count: number) => ({ name, diamond_count, image: { url_list: [`https://x/${name}.png`] } });
const tick = () => new Promise((r) => setTimeout(r));

describe('gift catalog', () => {
  it('ranks by coins, keeps one per name and skips gifts without a price or picture', () => {
    const gifts = parseGiftList({ data: { gifts: [raw('Lion', 29999), raw('Rose', 1), raw('rose', 1), raw('Free', 0), { name: 'Bare', diamond_count: 5 }, raw('Corgi', 299)] } });
    expect(gifts.map((g) => g.name)).toEqual(['Rose', 'Corgi', 'Lion']);
  });

  it('survives an answer of the wrong shape', () => {
    expect(parseGiftList(null)).toEqual([]);
    expect(parseGiftList({ status_code: 1 })).toEqual([]);
  });

  it('marks received gifts and adds ones the catalog lacks, in coin order', () => {
    const gifts = withReceived([{ name: 'Rose', coins: 1, image: 'r' }, { name: 'Lion', coins: 29999, image: 'l' }], [{ name: 'rose', coins: 1, image: null }, { name: 'New', coins: 50, image: 'n' }]);
    expect(gifts.map((g) => [g.name, g.received ?? false])).toEqual([['Rose', true], ['New', true], ['Lion', false]]);
  });

  it('ships with a usable list, ranked', () => {
    const gifts = createGiftCatalog(async () => null).list();
    expect(gifts.length).toBeGreaterThan(100);
    expect(gifts.every((g, i) => i === 0 || gifts[i - 1]!.coins <= g.coins)).toBe(true);
    expect(gifts.find((g) => g.name === 'Rose')?.coins).toBe(1);
  });

  it('refreshes daily, and keeps the list when TikTok fails or answers badly', async () => {
    const day = 24 * 60 * 60 * 1000;
    const many = Array.from({ length: 60 }, (_, i) => raw(`Gift ${i}`, i + 1));
    let calls = 0;
    const answers: (() => Promise<unknown>)[] = [async () => { throw new Error('blocked'); }, async () => ({ data: { gifts: [raw('Only', 1)] } }), async () => ({ data: { gifts: many } })];
    const catalog = createGiftCatalog(() => answers[calls++]!());
    const shipped = catalog.list(day);
    await tick();
    expect(catalog.list(day + 1)).toBe(shipped); // not a day yet, and the failure changed nothing
    expect(calls).toBe(1);
    catalog.list(2 * day);
    await tick();
    expect(catalog.list(2 * day + 1)).toBe(shipped);
    catalog.list(3 * day);
    await tick();
    expect(catalog.list(3 * day + 1)).toHaveLength(60);
  });
});
