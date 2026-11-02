import { useEffect, useState } from 'react';
import type { Gift } from '@hyperion/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { Seg } from '../ui';

export const coinCount = (coins: number) => `${coins.toLocaleString()} coin${coins === 1 ? '' : 's'}`;
const same = (a: string, b: string | null | undefined) => a.toLowerCase() === b?.toLowerCase();
export const findGift = (gifts: Gift[], name: string | null) => gifts.find((g) => same(g.name, name));

export function useGifts() {
  const [gifts, setGifts] = useState<Gift[]>([]);
  useEffect(() => void api<Gift[]>('GET', '/actions/gifts').then(setGifts), []);
  return gifts;
}

// TikTok's gifts by their pictures, ranked by coins. Any other name can be typed in.
export function GiftPicker({ gifts, picked, onPick }: { gifts: Gift[]; picked: string[]; onPick: (name: string) => void }) {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<'low' | 'high'>('low');
  const [onlyReceived, setOnlyReceived] = useState(false);
  const query = search.trim().toLowerCase();
  const received = gifts.filter((g) => g.received).length;
  const shown = gifts.filter((g) => (!onlyReceived || g.received) && g.name.toLowerCase().includes(query));
  if (order === 'high') shown.reverse();
  const exact = gifts.some((g) => g.name.toLowerCase() === query);
  return (
    <>
      <div className="gift-tools">
        <input className="input" type="search" aria-label="Find a gift" placeholder={`Find one of ${gifts.length.toLocaleString()} gifts`} value={search} maxLength={64} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
        <Seg<'low' | 'high'>
          label="Sort by coins"
          value={order}
          options={[
            ['low', 'Fewest coins'],
            ['high', 'Most coins'],
          ]}
          onChange={setOrder}
        />
        {received > 0 && (
          <button type="button" className={`btn btn-sm ${onlyReceived ? 'on' : ''}`} aria-pressed={onlyReceived} onClick={() => setOnlyReceived(!onlyReceived)}>
            Received ({received})
          </button>
        )}
      </div>
      {query && !exact && (
        <button type="button" className="link-button small" onClick={() => onPick(search.trim())}>
          Use “{search.trim()}” as the gift's name
        </button>
      )}
      <div className="gift-grid" role="group" aria-label="Gifts, by coins">
        {shown.map((g) => (
          <button key={g.name} type="button" className="gift-tile" aria-pressed={picked.some((p) => same(g.name, p))} onClick={() => onPick(g.name)}>
            {g.image ? <img src={g.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="gift" size={36} />}
            <span className="gift-name">{g.name}</span>
            <span className="gift-coins" aria-label={g.coins > 0 ? coinCount(g.coins) : 'Coins unknown'}>
              <Icon name="coin" size={14} />
              {g.coins > 0 ? g.coins.toLocaleString() : '?'}
            </span>
          </button>
        ))}
        {gifts.length > 0 && shown.length === 0 && <p className="muted small">No gift matches.</p>}
      </div>
    </>
  );
}
