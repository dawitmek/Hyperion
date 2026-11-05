import { and, eq, isNull, or } from 'drizzle-orm';
import { aliasedTable } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { actions, commands, hosts, media } from '../db/schema.js';
import type { ActionRule } from './engine.js';

const mediaFile = aliasedTable(media, 'media_file');

// The host's actions that apply with this profile, as the engine needs them.
export async function loadActionRules(db: Db, hostId: string, profileId: string, actionId?: string): Promise<ActionRule[]> {
  const rows = await db
    .select({ action: actions, keyword: commands.keyword, mediaKind: mediaFile.kind, defaultStyle: hosts.alertStyle, secondStyle: hosts.alertStyle2, soundVolumes: hosts.soundVolumes })
    .from(actions)
    .innerJoin(hosts, eq(hosts.id, actions.hostId))
    .leftJoin(commands, and(eq(commands.id, actions.keyCommandId), eq(commands.profileId, profileId)))
    .leftJoin(mediaFile, eq(mediaFile.id, actions.mediaId))
    .where(
      and(
        eq(actions.hostId, hostId),
        or(isNull(actions.profileId), eq(actions.profileId, profileId)),
        actionId ? eq(actions.id, actionId) : undefined,
      ),
    )
    .orderBy(actions.position);
  return rows.map(({ action: a, keyword, mediaKind, defaultStyle, secondStyle, soundVolumes }) => ({
    id: a.id,
    trigger: a.trigger,
    giftName: a.giftName,
    minDiamonds: a.minDiamonds,
    likeStep: a.likeStep,
    likeGrowth: a.likeGrowth,
    command: a.command,
    goalId: a.goalId,
    audience: a.audience,
    audienceViewer: a.audienceViewer,
    cooldownMs: a.cooldownMs,
    viewerCooldownMs: a.viewerCooldownMs,
    random: a.random,
    text: a.text,
    sound: a.sound,
    soundVolume: (a.sound && soundVolumes[a.sound]) ?? 100,
    soundFileVolume: (a.soundMediaId ? soundVolumes[a.soundMediaId] : undefined) ?? 100,
    soundMediaId: a.soundMediaId,
    media: a.mediaId && mediaKind ? { id: a.mediaId, kind: mediaKind } : null,
    speak: a.speak,
    durationMs: a.durationMs,
    effect: a.effect,
    effectAmount: a.effectAmount,
    effectColor: a.effectColor,
    effectSpeed: a.effectSpeed,
    alertFx: a.alertEffect ? { effect: a.alertEffect, emoji: a.alertEmoji, shape: a.alertShape, color: a.alertEffectColor, amount: a.alertEffectAmount, speed: a.alertEffectSpeed } : null,
    alertPos: a.alertX !== null && a.alertY !== null ? { x: a.alertX, y: a.alertY } : null,
    alertScale: a.alertScale,
    alertStyle: a.alertStyle ?? (a.useAlertStyle2 ? secondStyle : null) ?? defaultStyle, // its own look, or the host's second or main one
    keyword: keyword ?? null,
    repeatWithCount: a.repeatWithCount,
    points: a.points,
    screenId: a.screenId,
    enabled: a.enabled,
  }));
}
