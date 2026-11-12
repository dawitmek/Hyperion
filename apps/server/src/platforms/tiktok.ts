import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import type { Badge, RoomStats, ViewerEvent } from '@hyperion/shared';
import type { PlatformAdapter } from './types.js';

// Live payloads (connector 2.5, verified Oct 2026) use `content` and `user.displayId`; the README still
// shows `comment` and `user.uniqueId`. Read both so a docs-driven change can't break real streams.
type RawImage = { urlList?: string[]; mUrls?: string[]; url?: string[] };
type RawUser = { uniqueId?: string; displayId?: string; userId?: string; id?: string; nickname?: string; avatarThumb?: RawImage; avatarLarge?: RawImage };
type RawIdentity = { isFollowerOfAnchor?: boolean; isSubscriberOfAnchor?: boolean; isModeratorOfAnchor?: boolean };
type RawPayload = {
  user?: RawUser;
  userIdentity?: RawIdentity;
  subMonth?: string | number;
  emoteList?: { emoteId?: string }[];
  comment?: string;
  content?: string;
  giftId?: number | string;
  repeatCount?: number;
  repeatEnd?: boolean | number;
  giftDetails?: { giftName?: string; giftType?: number; diamondCount?: number; giftImage?: RawImage };
  gift?: { name?: string; type?: number; diamondCount?: number; image?: RawImage; icon?: RawImage }; // connector 2.5's shape; giftDetails is the legacy one
  likeCount?: number;
  count?: number;
};

// The connector's emitter typings come from a CommonJS package that NodeNext can't resolve, so `.on` goes untyped.
type Emitter = { on(event: string, listener: (data: unknown) => void): unknown };

const MAPPED = [
  WebcastEvent.CHAT,
  WebcastEvent.GIFT,
  WebcastEvent.LIKE,
  WebcastEvent.FOLLOW,
  WebcastEvent.SHARE,
  WebcastEvent.MEMBER,
  WebcastEvent.SUB_NOTIFY,
  WebcastEvent.EMOTE,
] as const;
type MappedEvent = (typeof MAPPED)[number];

const viewerIdOf = (user: RawUser | undefined) => user?.uniqueId || user?.displayId || user?.userId || user?.id;
const httpsUrl = (image: RawImage | undefined) => (image?.urlList ?? image?.mUrls ?? image?.url)?.find((url) => url.startsWith('https://'));

// Only chat, gift and emote messages carry the viewer's relationship to the host.
function badgesOf(identity: RawIdentity | undefined): Badge[] | undefined {
  if (!identity) return undefined;
  const badges: Badge[] = [];
  if (identity.isFollowerOfAnchor) badges.push('follower');
  if (identity.isSubscriberOfAnchor) badges.push('subscriber');
  if (identity.isModeratorOfAnchor) badges.push('moderator');
  return badges;
}

export function toViewerEvent(type: MappedEvent, data: RawPayload, at = Date.now()): ViewerEvent | null {
  const event = mapEvent(type, data, at);
  if (!event) return null;
  const badges = badgesOf(data.userIdentity);
  const avatar = httpsUrl(data.user?.avatarThumb) ?? httpsUrl(data.user?.avatarLarge);
  const name = data.user?.nickname?.trim();
  return { ...event, ...(badges && { badges }), ...(avatar && { avatar }), ...(name && name !== event.viewerId && { name }) };
}

function mapEvent(type: MappedEvent, data: RawPayload, at: number): ViewerEvent | null {
  const viewerId = viewerIdOf(data.user);
  if (!viewerId) return null;

  switch (type) {
    case WebcastEvent.CHAT: {
      const text = data.comment ?? data.content;
      return text ? { kind: 'comment', viewerId, text, at } : null;
    }
    case WebcastEvent.GIFT: {
      const giftType = data.giftDetails?.giftType ?? data.gift?.type;
      // Streakable gifts (type 1) arrive once per tick; only the final event carries the total.
      if (giftType === 1 && !data.repeatEnd) return null;
      const image = httpsUrl(data.gift?.image) ?? httpsUrl(data.gift?.icon) ?? httpsUrl(data.giftDetails?.giftImage);
      return {
        kind: 'gift',
        viewerId,
        giftId: Number(data.giftId),
        giftName: data.giftDetails?.giftName ?? data.gift?.name ?? '',
        count: data.repeatCount || 1,
        diamonds: data.giftDetails?.diamondCount ?? data.gift?.diamondCount ?? 0,
        at,
        ...(image && { image }),
      };
    }
    case WebcastEvent.LIKE:
      return { kind: 'like', viewerId, count: data.likeCount ?? data.count ?? 1, at };
    case WebcastEvent.FOLLOW:
      return { kind: 'follow', viewerId, at };
    case WebcastEvent.SHARE:
      return { kind: 'share', viewerId, at };
    case WebcastEvent.MEMBER:
      return { kind: 'join', viewerId, at };
    case WebcastEvent.SUB_NOTIFY:
      return { kind: 'subscribe', viewerId, months: Number(data.subMonth) || 1, at };
    case WebcastEvent.EMOTE: {
      const emoteId = data.emoteList?.[0]?.emoteId;
      return emoteId ? { kind: 'emote', viewerId, emoteId, at } : null;
    }
  }
}

type RawRoomUser = { viewerCount?: number; total?: string | number; ranks?: { user?: RawUser }[] };

export function toRoomStats(data: RawRoomUser): RoomStats {
  return {
    viewers: Number(data.viewerCount) || Number(data.total) || 0, // an absent count arrives as 0, not undefined
    topGifters: (data.ranks ?? []).map((r) => viewerIdOf(r.user)).filter((id): id is string => !!id),
  };
}

export class TikTokAdapter implements PlatformAdapter {
  private connection: TikTokLiveConnection;
  private eventListener: (event: ViewerEvent) => void = () => {};
  private endListener: (reason: string) => void = () => {};
  private statsListener: (stats: RoomStats) => void = () => {};
  private stopping = false;
  private retried = false;

  constructor(username: string, signApiKey?: string) {
    this.connection = new TikTokLiveConnection(username, { signApiKey, processInitialData: false });
    const events = this.connection as unknown as Emitter;

    for (const type of MAPPED) {
      events.on(type, (data) => {
        const event = toViewerEvent(type, data as RawPayload);
        if (event) this.eventListener(event);
      });
    }
    events.on(WebcastEvent.ROOM_USER, (data) => this.statsListener(toRoomStats(data as RawRoomUser)));
    events.on(WebcastEvent.STREAM_END, () => this.end('stream ended'));
    events.on(ControlEvent.DISCONNECTED, () => {
      if (this.stopping) return;
      // One reconnect attempt covers network blips; anything else ends the session.
      if (this.retried) return this.end('disconnected');
      this.retried = true;
      this.connection.connect().catch(() => this.end('disconnected'));
    });
  }

  async start() {
    await this.connection.connect();
  }

  async stop() {
    this.stopping = true;
    await this.connection.disconnect();
  }

  onEvent(listener: (event: ViewerEvent) => void) {
    this.eventListener = listener;
  }

  onEnd(listener: (reason: string) => void) {
    this.endListener = listener;
  }

  onRoomStats(listener: (stats: RoomStats) => void) {
    this.statsListener = listener;
  }

  private end(reason: string) {
    if (this.stopping) return;
    this.stopping = true;
    this.endListener(reason);
  }
}

const AVATAR_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const AVATAR_MAX_BYTES = 200 * 1024;
const LOOKUP_TIMEOUT_MS = 5000;

const withTimeout = <T>(promise: Promise<T>) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), LOOKUP_TIMEOUT_MS))]);

/**
 * The account's small profile picture, as a data: URL, or null if TikTok doesn't say or can't be reached. Works when the
 * account isn't live. Kept as data because TikTok's picture links are signed and expire, and so the dashboard never
 * loads anything from TikTok itself.
 */
export async function fetchTiktokAvatar(username: string, signApiKey?: string): Promise<string | null> {
  try {
    const web = new TikTokLiveConnection(username, { signApiKey, processInitialData: false }).webClient;
    const room = (await withTimeout(
      web.getJsonObjectFromTikTokApi('api-live/user/room/', { ...web.clientParams, uniqueId: username, sourceType: '54' }),
    )) as { data?: { user?: { uniqueId?: string; avatarThumb?: unknown; avatarMedium?: unknown } } };
    const user = room.data?.user;
    if (!user || user.uniqueId?.toLowerCase() !== username.toLowerCase()) return null;
    const link = [user.avatarThumb, user.avatarMedium].find((u): u is string => typeof u === 'string');
    const url = link ? new URL(link) : null;
    // Only TikTok's own image servers.
    if (!url || url.protocol !== 'https:' || !/(^|\.)tiktokcdn(-[a-z]+)?\.com$/.test(url.hostname)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), redirect: 'error' });
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!res.ok || !AVATAR_TYPES.includes(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > AVATAR_MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
