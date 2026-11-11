import { useEffect, useState } from 'react';
import type { LeaderboardEntry, ModeState, ServerToOverlay, StreamStats } from '@hyperion/shared';
import { openOverlaySocket, type OverlaySocket } from '../demo/socket';

export type ActivityKind = 'Key' | 'Alert' | 'Level' | 'Voice';
export interface Activity {
  id: number;
  kind: ActivityKind;
  text: string;
  at: number;
  viewer?: string; // who did it, when someone did: the text starts with their name
}

export interface LiveFeed {
  activity: Activity[];
  pressed: Record<string, number>; // presses per keyword this stream (or, offline, the last one this page saw)
  perSecond: number; // presses in the last second
  lastPress: string | null; // keyword pressed in the last moment, for a brief highlight
  mode: { state: ModeState; clockOffset: number } | null;
  leaderboard: LeaderboardEntry[] | null; // null until the server sends one
  stats: StreamStats | null; // this stream's totals; null when not live
}

const MAX_ACTIVITY = 100; // the Live page's card shows the newest few, its expanded view all of them

// The dashboard listens on the overlay's read-only socket, so it sees exactly what the stream sees.
export function useLiveFeed(overlayToken: string): LiveFeed {
  const [feed, setFeed] = useState<LiveFeed>({ activity: [], pressed: {}, perSecond: 0, lastPress: null, mode: null, leaderboard: null, stats: null });

  useEffect(() => {
    let socket: OverlaySocket;
    let retry: number | undefined;
    let closed = false;
    let nextId = 0;
    let presses: number[] = [];
    let clearPress: number | undefined;

    const log = (kind: ActivityKind, text: string, viewer?: string) =>
      setFeed((f) => ({ ...f, activity: [{ id: nextId++, kind, text, at: Date.now(), viewer }, ...f.activity].slice(0, MAX_ACTIVITY) }));

    const connect = () => {
      socket = openOverlaySocket(overlayToken, true);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerToOverlay;
        switch (message.type) {
          case 'command':
            presses.push(Date.now());
            setFeed((f) => ({
              ...f,
              lastPress: message.keyword,
              pressed: { ...f.pressed, [message.keyword]: (f.pressed[message.keyword] ?? 0) + 1 },
            }));
            clearTimeout(clearPress);
            clearPress = window.setTimeout(() => setFeed((f) => ({ ...f, lastPress: null })), 400);
            log('Key', `${message.viewer} pressed ${message.keyword}`, message.viewer);
            break;
          case 'levelUp':
            log('Level', `${message.viewer} reached level ${message.level}`, message.viewer);
            break;
          case 'alert':
            log('Alert', message.text || (message.media ? 'Picture or video alert' : 'Sound alert'));
            break;
          case 'tts':
            log('Voice', `${message.viewer}: ${message.text}`, message.viewer);
            break;
          case 'mode':
            setFeed((f) => ({ ...f, mode: { state: message.state, clockOffset: Date.now() - message.serverNow } }));
            break;
          case 'leaderboard':
            setFeed((f) => ({ ...f, leaderboard: message.entries }));
            break;
          case 'stats':
            setFeed((f) => ({ ...f, stats: message.stats }));
            break;
          case 'presses':
            setFeed((f) => ({ ...f, pressed: message.counts }));
            break;
          case 'live':
            // A stream starting counts from zero; on connect, `presses` follows with where it's at.
            if (message.state === 'started') setFeed((f) => ({ ...f, pressed: {} }));
            if (message.state === 'stopped') setFeed((f) => ({ ...f, mode: null, stats: null }));
            break;
        }
      };
      // A bad token is permanent (4001); anything else is worth retrying.
      socket.onclose = (event) => {
        if (!closed && event.code !== 4001) retry = window.setTimeout(connect, 3000);
      };
    };
    connect();

    const rate = window.setInterval(() => {
      const cutoff = Date.now() - 1000;
      presses = presses.filter((t) => t > cutoff);
      setFeed((f) => (f.perSecond === presses.length ? f : { ...f, perSecond: presses.length }));
    }, 250);

    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(rate);
      clearTimeout(clearPress);
      socket.close();
    };
  }, [overlayToken]);

  return feed;
}
