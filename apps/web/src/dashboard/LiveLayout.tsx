import { useState, type DragEvent, type ReactNode } from 'react';
import { DEFAULT_LIVE_LAYOUT, LIVE_CARDS, type LiveCard, type LiveColumn, type LiveLayout } from '@hyperion/shared';
import { api } from '../api';
import { ErrorNotice, useError } from '../ui';
import { Icon } from '../icons';
import type { PageProps } from './Dashboard';

const COLUMNS: { id: LiveColumn; className: string }[] = [
  { id: 'main', className: 'stack live-main' },
  { id: 'side', className: 'stack live-side' },
];

export const CARD_LABELS: Record<LiveCard, string> = {
  commands: 'Commands',
  feed: 'Activity feed',
  stream: 'This stream',
  mode: 'Crowd mode',
  voice: 'Voice',
  activity: 'Activity',
  players: 'Top players',
  viewers: 'Viewers now',
  'peak-viewers': 'Peak viewers',
  interactors: 'Interactors',
  gifts: 'Gifts received',
  coins: 'Coins',
  likes: 'Likes',
  follows: 'New followers',
  shares: 'Shares',
  'top-gift': 'Top gift',
  'last-follower': 'Last follower',
};

// Takes the card out of wherever it is and puts it at `index` of `column`, counted with the card still in place.
export function moveCard(layout: LiveLayout, card: LiveCard, column: LiveColumn, index: number): LiveLayout {
  const from = layout[column].indexOf(card);
  const without = { main: layout.main.filter((c) => c !== card), side: layout.side.filter((c) => c !== card) };
  const at = from !== -1 && from < index ? index - 1 : index;
  return { ...without, [column]: [...without[column].slice(0, at), card, ...without[column].slice(at)] };
}

const removeCard = (layout: LiveLayout, card: LiveCard): LiveLayout => ({
  main: layout.main.filter((c) => c !== card),
  side: layout.side.filter((c) => c !== card),
});

// The Live page's cards, in the host's order. `card` draws one; `extra` goes above the main column whatever the layout.
export function LiveCards({ host, refreshHost, card, extra }: Pick<PageProps, 'host' | 'refreshHost'> & { card: (id: LiveCard, editing: boolean) => ReactNode; extra: ReactNode }) {
  const saved = host.liveLayout ?? DEFAULT_LIVE_LAYOUT;
  const [draft, setDraft] = useState<LiveLayout | null>(null); // the layout being edited; nothing's saved until Done
  const [dragging, setDragging] = useState<LiveCard | null>(null);
  const [drop, setDrop] = useState<{ column: LiveColumn; index: number } | null>(null);
  const { error, guard } = useError();
  const layout = draft ?? saved;
  const editing = draft !== null;
  const hidden = LIVE_CARDS.filter((c) => !layout.main.includes(c) && !layout.side.includes(c));

  const done = guard(async () => {
    await api('PATCH', '/settings', { liveLayout: draft });
    await refreshHost();
    setDraft(null);
  });
  const endDrag = () => (setDragging(null), setDrop(null));
  const finishDrag = () => {
    if (dragging && drop) setDraft(moveCard(layout, dragging, drop.column, drop.index));
    endDrag();
  };
  // Over a card, the drop goes before or after it, whichever half the pointer is on.
  const overCard = (e: DragEvent<HTMLElement>, column: LiveColumn, index: number) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const box = e.currentTarget.getBoundingClientRect();
    setDrop({ column, index: e.clientY > box.top + box.height / 2 ? index + 1 : index });
  };
  const overColumn = (e: DragEvent<HTMLElement>, column: LiveColumn) => {
    if (!dragging) return;
    e.preventDefault();
    setDrop({ column, index: layout[column].length });
  };

  return (
    <>
      <ErrorNotice error={error} />
      {editing ? (
        <section className="live-editor" aria-label="Edit layout">
          <div className="live-editor-head">
            <p className="muted small">Hiding a card only takes it off this page. Whatever it controls keeps working.</p>
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => setDraft(DEFAULT_LIVE_LAYOUT)}>
                Reset to default
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={done}>
                Done
              </button>
            </div>
          </div>
          {hidden.length > 0 && (
            <div className="live-hidden">
              <span className="muted small">Add a card</span>
              {hidden.map((c) => (
                <button key={c} className="btn btn-ghost btn-sm" onClick={() => setDraft(moveCard(layout, c, DEFAULT_LIVE_LAYOUT.side.includes(c) ? 'side' : 'main', Infinity))}>
                  <Icon name="plus" size={14} />
                  {CARD_LABELS[c]}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="live-edit-open">
          <button className="btn btn-ghost btn-sm" onClick={() => setDraft(saved)}>
            Edit layout
          </button>
        </div>
      )}
      <div className="live-columns">
        {COLUMNS.map(({ id: column, className }) => {
          const cards = layout[column];
          const other = column === 'main' ? 'side' : 'main';
          const showExtra = column === 'main' && extra;
          if (!editing && cards.length === 0 && !showExtra) return null;
          return (
            <div
              key={column}
              className={className}
              {...(column === 'side' && { role: 'complementary', 'aria-label': 'Happening now' })}
              onDragOver={editing ? (e) => overColumn(e, column) : undefined}
              onDrop={editing ? (e) => (e.preventDefault(), finishDrag()) : undefined}
            >
              {showExtra}
              {cards.map((c, i) => (
                <div
                  key={c}
                  className={`live-slot ${editing ? 'editing' : ''} ${dragging === c ? 'dragging' : ''} ${drop?.column === column && drop.index === i ? 'drop-before' : ''}`}
                  draggable={editing}
                  onDragStart={(e) => (e.dataTransfer.setData('text/plain', c), setDragging(c))}
                  onDragEnd={endDrag}
                  onDragOver={editing ? (e) => overCard(e, column, i) : undefined}
                >
                  {editing && (
                    <div className="live-slot-bar">
                      <strong className="small">{CARD_LABELS[c]}</strong>
                      <span className="row">
                        <button className="btn btn-ghost btn-sm btn-icon flip" title="Move up" aria-label={`Move ${CARD_LABELS[c]} up`} disabled={i === 0} onClick={() => setDraft(moveCard(layout, c, column, i - 1))}>
                          <Icon name="chevron" size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Move down" aria-label={`Move ${CARD_LABELS[c]} down`} disabled={i === cards.length - 1} onClick={() => setDraft(moveCard(layout, c, column, i + 2))}>
                          <Icon name="chevron" size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm" aria-label={`Move ${CARD_LABELS[c]} to the other column`} onClick={() => setDraft(moveCard(layout, c, other, layout[other].length))}>
                          Other column
                        </button>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Hide" aria-label={`Hide ${CARD_LABELS[c]}`} onClick={() => setDraft(removeCard(layout, c))}>
                          <Icon name="close" size={14} />
                        </button>
                      </span>
                    </div>
                  )}
                  <div className="live-slot-body" inert={editing}>
                    {card(c, editing)}
                  </div>
                </div>
              ))}
              {editing && (
                <div className={`live-column-end ${drop?.column === column && drop.index === cards.length ? 'active' : ''}`}>
                  {cards.length === 0 ? 'Drag a card here' : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!editing && layout.main.length === 0 && layout.side.length === 0 && !extra && <p className="empty">Every card is hidden. Use Edit layout to add some back.</p>}
    </>
  );
}
