import { describe, expect, it } from 'vitest';
import { MAX_KEY_REPEATS, type ViewerEvent } from '@hyperion/shared';
import { commandSpeech, createActions, fillTemplate, parseBlockedWords, type ActionContext, type ActionRule, type TtsConfig } from '../src/actions/engine.js';

let nextId = 0;
const rule = (r: Partial<ActionRule> & Pick<ActionRule, 'trigger'>): ActionRule => ({
  id: `a${nextId++}`,
  giftName: null,
  minDiamonds: null,
  likeStep: null,
  likeGrowth: null,
  command: null,
  goalId: null,
  audience: 'everyone',
  audienceViewer: null,
  cooldownMs: 0,
  viewerCooldownMs: 0,
  random: false,
  text: null,
  sound: 'chime',
  soundVolume: 100,
  soundFileVolume: 100,
  soundMediaId: null,
  media: null,
  speak: false,
  durationMs: 5000,
  effect: null,
  effectAmount: 3,
  effectColor: null,
  effectSpeed: 100,
  alertFx: null,
  alertPos: null,
  alertScale: 100,
  keyword: null,
  repeatWithCount: false,
  points: 0,
  screenId: null,
  enabled: true,
  ...r,
});

const baseTts: TtsConfig = { mode: 'prefix', prefix: '!tts', maxLength: 150, maxWords: 0, unlockGifts: [], unlockMs: 0, template: '{viewer} says {text}', commands: false, commandTemplate: '{viewer} pressed {command}', cooldownMs: 0, autoMaxViewers: 25, minLevel: 1, blockedWords: [] };

function setup(
  actions: ActionRule[],
  tts: Partial<TtsConfig> = {},
  levels: Record<string, number> = {},
  progression = false,
  extra: Partial<ActionContext> = {},
) {
  let t = 0;
  const ctx: ActionContext = {
    config: { actions, tts: { ...baseTts, ...tts }, progression, points: true },
    now: () => t,
    levelOf: (v) => levels[v] ?? 1,
    isCommand: (text) => ['left', 'join'].includes(text.trim().toLowerCase()),
    topGifters: () => [],
    viewers: () => 0,
    ...extra,
  };
  const engine = createActions(ctx);
  const say = (viewerId: string, text: string, badges?: ViewerEvent['badges']) =>
    engine.handle({ kind: 'comment', viewerId, text, at: 0, ...(badges && { badges }) });
  // The text spoken for a comment, or null.
  const spoken = (viewerId: string, text: string) => {
    const m = say(viewerId, text).find((o) => o.type === 'tts');
    return m?.type === 'tts' ? m.text : null;
  };
  return { engine, ctx, say, spoken, advance: (ms: number) => (t += ms) };
}

const gift = (giftName: string, count = 1, diamonds = 1, viewerId = 'alice'): ViewerEvent => ({ kind: 'gift', viewerId, giftId: 1, giftName, count, diamonds, at: 0 });
const like = (count: number): ViewerEvent => ({ kind: 'like', viewerId: 'bob', count, at: 0 });
const follow = (viewerId = 'alice'): ViewerEvent => ({ kind: 'follow', viewerId, at: 0 });
const texts = (out: ReturnType<ReturnType<typeof createActions>['handle']>) => out.flatMap((m) => (m.type === 'alert' ? [m.text] : []));

describe('actions', () => {
  it('fills templates and leaves unknown placeholders alone', () => {
    expect(fillTemplate('{viewer} sent {count}× {gift} {nope}', { viewer: 'a', count: 3, gift: 'Rose' })).toBe('a sent 3× Rose {nope}');
  });

  it('shows alerts for follows and shares, skipping disabled actions', () => {
    const followed = rule({ trigger: 'follow', text: '{viewer} followed', speak: true });
    const { engine } = setup([followed, rule({ trigger: 'share', text: 'off', enabled: false })]);
    expect(engine.handle(follow())).toEqual([
      { type: 'alert', action: followed.id, text: 'alice followed', sound: 'chime', soundVolume: 100, soundFile: null, soundFileVolume: 100, media: null, speak: true, durationMs: 5000, screen: null, pos: null, scale: 100, fx: null },
    ]);
    expect(engine.handle({ kind: 'share', viewerId: 'alice', at: 0 })).toEqual([]);
  });

  it('plays an animation, with or without an alert', () => {
    const { engine } = setup([rule({ trigger: 'follow', sound: null, effect: 'hearts', effectAmount: 5, effectColor: '#ff0000', effectSpeed: 200, screenId: 's' })]);
    expect(engine.handle({ kind: 'follow', viewerId: 'a', at: 0 })).toEqual([{ type: 'effect', effect: 'hearts', amount: 5, speed: 200, color: '#ff0000', screen: 's' }]);
  });

  it('sends an alert animation with its alert, even with nothing else to show', () => {
    const fx = { effect: 'emoji_burst', emoji: '💸', shape: 'star', color: null, amount: 2, speed: 150 } as const;
    const { engine } = setup([rule({ trigger: 'follow', sound: null, alertFx: fx })]);
    expect(engine.handle({ kind: 'follow', viewerId: 'a', at: 0 })).toMatchObject([{ type: 'alert', text: '', fx }]);
  });

  it("lets a gift's own animation replace any-gift animations, and leaves the any-gift alert alone", () => {
    const any = rule({ trigger: 'gift', text: 'thanks', effect: 'confetti' });
    const rose = rule({ trigger: 'gift', giftName: 'rose', sound: null, effect: 'hearts' });
    const { engine } = setup([any, rose]);
    const rosy = engine.handle(gift('Rose'));
    expect(rosy.filter((o) => o.type === 'effect')).toMatchObject([{ effect: 'hearts' }]);
    expect(rosy.filter((o) => o.type === 'alert')).toMatchObject([{ text: 'thanks' }]);
    expect(engine.handle(gift('Lion')).filter((o) => o.type === 'effect')).toMatchObject([{ effect: 'confetti' }]);
  });

  it('keeps the any-gift animation for a gift whose own action has none', () => {
    const { engine } = setup([rule({ trigger: 'gift', effect: 'confetti' }), rule({ trigger: 'gift', giftName: 'rose', text: 'a rose!' })]);
    expect(engine.handle(gift('Rose')).filter((o) => o.type === 'effect')).toMatchObject([{ effect: 'confetti' }]);
  });

  it('picks one for random', () => {
    const { engine } = setup([rule({ trigger: 'follow', sound: null, effect: 'random' })], {}, {}, false, { random: () => 0.99 });
    expect(engine.handle({ kind: 'follow', viewerId: 'a', at: 0 })).toMatchObject([{ type: 'effect', effect: 'bubbles' }]);
  });

  it("shows only the exact gift's alert, while any-gift key presses and points still happen", () => {
    const { engine } = setup([
      rule({ trigger: 'gift', text: 'any {gift}', keyword: 'jump', points: 5 }),
      rule({ trigger: 'gift', giftName: 'lion', text: 'LION x{count}', sound: 'fanfare' }),
    ]);
    const lion = engine.handle(gift('Lion', 2));
    expect(texts(lion)).toEqual(['LION x2']);
    expect(lion).toContainEqual({ type: 'key', keyword: 'jump', viewer: 'alice', repeats: 1, count: 2 });
    expect(lion).toContainEqual({ type: 'points', viewer: 'alice', amount: 5 });
    expect(texts(engine.handle(gift('Rose')))).toEqual(['any Rose']);
  });

  it('matches gifts by total diamonds, and repeats key presses for a streak', () => {
    const { engine } = setup([rule({ trigger: 'gift', minDiamonds: 100, text: 'big {coins} {diamonds}', keyword: 'jump', repeatWithCount: true })]);
    expect(engine.handle(gift('Rose', 50))).toEqual([]);
    const big = engine.handle(gift('Rose', 99, 2));
    expect(texts(big)).toEqual(['big 198 198']);
    expect(big).toContainEqual({ type: 'key', keyword: 'jump', viewer: 'alice', repeats: MAX_KEY_REPEATS, count: 99 });
  });

  it("fires viewer_likes actions on one viewer's own likes, not the stream's", () => {
    const { engine } = setup([rule({ trigger: 'viewer_likes', likeStep: 100, text: '{viewer}: {total} likes' })]);
    const likes = (viewerId: string, count: number) => engine.handle({ kind: 'like', viewerId, count, at: 0 });
    expect(texts(likes('ann', 60))).toEqual([]);
    expect(texts(likes('bob', 60))).toEqual([]); // 120 together, but neither has 100
    expect(texts(likes('ann', 45))).toEqual(['ann: 100 likes']);
    expect(texts(likes('ann', 50))).toEqual([]);
    expect(texts(likes('ann', 300))).toEqual(['ann: 400 likes']); // one per batch
    expect(texts(likes('bob', 40))).toEqual(['bob: 100 likes']);
  });

  it('can multiply its like target each time', () => {
    const { engine } = setup([rule({ trigger: 'likes', likeStep: 100, likeGrowth: 2, text: '{total}' })]);
    expect(texts(engine.handle(like(99)))).toEqual([]);
    expect(texts(engine.handle(like(1)))).toEqual(['100']);
    expect(texts(engine.handle(like(99)))).toEqual([]);
    expect(texts(engine.handle(like(1)))).toEqual(['200']);
    expect(texts(engine.handle(like(199)))).toEqual([]); // 399: not 300, which plain steps would fire at
    expect(texts(engine.handle(like(1)))).toEqual(['400']);
    expect(texts(engine.handle(like(2000)))).toEqual(['1600']); // one per batch
  });

  it('fires likes actions each time the stream total passes a multiple of the step', () => {
    const { engine } = setup([rule({ trigger: 'likes', likeStep: 100, text: '{total} likes, thanks {viewer}' })]);
    expect(engine.handle(like(60))).toEqual([]);
    expect(texts(engine.handle(like(60)))).toEqual(['100 likes, thanks bob']);
    expect(engine.handle(like(50))).toEqual([]); // 170
    expect(texts(engine.handle(like(250)))).toEqual(['400 likes, thanks bob']); // one per batch
  });

  it('runs chat commands with the rest of the message, and never reads them aloud', () => {
    const { say } = setup([rule({ trigger: 'command', command: '!shout', text: '{viewer}: {text}' })], { mode: 'all' });
    expect(texts(say('alice', '!SHOUT hello there'))).toEqual(['alice: hello there']);
    expect(say('alice', '!shout')).toMatchObject([{ type: 'alert', text: 'alice: ' }]);
    expect(say('alice', '!shouting')).toEqual([{ type: 'tts', viewer: 'alice', text: '!shouting', spoken: 'alice says !shouting' }]);
  });

  it("greets a viewer's first activity of the stream once, ignoring joins", () => {
    const { engine, say } = setup([rule({ trigger: 'first_activity', text: 'welcome {viewer}' })]);
    expect(engine.handle({ kind: 'join', viewerId: 'alice', at: 0 })).toEqual([]);
    expect(texts(say('alice', 'hi'))).toEqual(['welcome alice']);
    expect(texts(say('alice', 'hi again'))).toEqual([]);
    expect(texts(engine.handle(follow('bob')))).toEqual(['welcome bob']);
  });

  it('limits actions to followers, subscribers, moderators, top gifters or one viewer', () => {
    const only = (audience: ActionRule['audience'], audienceViewer: string | null = null) =>
      setup([rule({ trigger: 'command', command: '!hi', text: 'hi', audience, audienceViewer })], {}, {}, false, { topGifters: () => ['g1', 'g2', 'g3', 'g4'] });
    const followers = only('followers');
    expect(texts(followers.say('stranger', '!hi'))).toEqual([]); // the platform hasn't said
    expect(texts(followers.say('fan', '!hi', ['follower']))).toEqual(['hi']);
    followers.engine.handle(follow('newfan'));
    expect(texts(followers.say('newfan', '!hi'))).toEqual(['hi']); // following just now counts
    expect(texts(only('moderators').say('fan', '!hi', ['follower']))).toEqual([]);
    expect(texts(only('moderators').say('mod', '!hi', ['moderator']))).toEqual(['hi']);
    const subs = only('subscribers');
    subs.engine.handle({ kind: 'subscribe', viewerId: 'sub', months: 1, at: 0 });
    expect(texts(subs.say('sub', '!hi'))).toEqual(['hi']);
    expect(texts(only('top_gifters').say('g3', '!hi'))).toEqual(['hi']);
    expect(texts(only('top_gifters').say('g4', '!hi'))).toEqual([]); // top three only
    expect(texts(only('viewer', 'Alice').say('alice', '!hi'))).toEqual(['hi']);
    expect(texts(only('viewer', 'Alice').say('bob', '!hi'))).toEqual([]);
  });

  it('keeps to its cooldowns, for everyone and per viewer', () => {
    const { say, advance } = setup([
      rule({ trigger: 'command', command: '!a', text: 'a', cooldownMs: 10_000 }),
      rule({ trigger: 'command', command: '!b', text: 'b', viewerCooldownMs: 10_000 }),
    ]);
    expect(texts(say('alice', '!a'))).toEqual(['a']);
    expect(texts(say('bob', '!a'))).toEqual([]);
    expect(texts(say('alice', '!b'))).toEqual(['b']);
    expect(texts(say('alice', '!b'))).toEqual([]);
    expect(texts(say('bob', '!b'))).toEqual(['b']);
    advance(10_000);
    expect(texts(say('bob', '!a'))).toEqual(['a']);
  });

  it('runs one of the random actions an event matches, plus all the others', () => {
    const actions = [
      rule({ trigger: 'follow', text: 'always' }),
      rule({ trigger: 'follow', text: 'one', random: true }),
      rule({ trigger: 'follow', text: 'two', random: true }),
    ];
    expect(texts(setup(actions, {}, {}, false, { random: () => 0 }).engine.handle(follow()))).toEqual(['always', 'one']);
    expect(texts(setup(actions, {}, {}, false, { random: () => 0.99 }).engine.handle(follow()))).toEqual(['always', 'two']);
  });

  it('runs goal actions for the goal that was reached, crediting the viewer who reached it', () => {
    const { engine } = setup([rule({ trigger: 'goal', goalId: 'g1', text: '{goal} done at {target}, thanks {viewer}!', points: 3 })]);
    const by: ViewerEvent = { kind: 'like', viewerId: 'bob', count: 5, at: 0 };
    expect(engine.goalReached({ id: 'g2', name: 'Other', target: 1 }, by)).toEqual([]);
    const out = engine.goalReached({ id: 'g1', name: 'Like goal', target: 1000 }, by);
    expect(texts(out)).toEqual(['Like goal done at 1000, thanks bob!']);
    expect(out).toContainEqual({ type: 'points', viewer: 'bob', amount: 3 });
  });

  it("gives points only with points on, and doesn't show an alert with nothing in it", () => {
    const action = rule({ trigger: 'share', sound: null, points: 10 });
    expect(setup([action]).engine.handle({ kind: 'share', viewerId: 'alice', at: 0 })).toEqual([{ type: 'points', viewer: 'alice', amount: 10 }]);
    const off = setup([action]);
    off.ctx.config.points = false;
    expect(off.engine.handle({ kind: 'share', viewerId: 'alice', at: 0 })).toEqual([]);
  });
});

describe('text-to-speech', () => {
  it('auto waits for a viewer count: no count is not a small stream', () => {
    let viewers = 0;
    const auto = setup([], { mode: 'auto', autoMaxViewers: 25 }, {}, false, { viewers: () => viewers });
    expect(auto.spoken('alice', 'hello')).toBeNull();
    expect(auto.spoken('alice', '!tts asked for it')).toBe('asked for it');
    viewers = 700;
    expect(auto.spoken('bob', 'hello')).toBeNull();
    viewers = 25;
    expect(auto.spoken('carol', 'hello')).toBe('hello');
  });

  it('skips emoji spam and reads what people can hear', () => {
    const { spoken } = setup([], { mode: 'all' });
    expect(spoken('a', '😂'.repeat(30))).toBeNull();
    expect(spoken('b', 'so funny 😂😂😂😂😂😂')).toBeNull();
    expect(spoken('c', 'so funny 😂😂')).toBe('so funny');
    expect(spoken('d', '🔥')).toBeNull();
    expect(spoken('e', '𝔗𝔶𝔰𝔬𝔫 won')).toBe('Tyson won');
    expect(spoken('f', 'heyyyyyyyyy!!!!!!')).toBe('heyyy!');
    expect(spoken('g', 'go go go go go go')).toBe('go go go');
    expect(spoken('h', '★ hello ★')).toBe('hello');
    expect(spoken('i', '.......')).toBeNull();
    expect(spoken('j', 'te\u0301\u0302\u0303\u0304xt')).toBe('téxt'); // one accent stays, the pile-up goes
    expect(spoken('k', 'café crème')).toBe('café crème');
    expect(spoken('l', 'привет 你好')).toBe('привет 你好');
  });

  it('reads decorative names plainly, and falls back to the username', () => {
    const { engine } = setup([], { mode: 'all', blockedWords: ['rude'] });
    const viewer = (name: string, viewerId: string) => engine.handle({ kind: 'comment', viewerId, name, text: 'hi', at: 0 }).find((o) => o.type === 'tts');
    expect(viewer('𝔗𝔶𝔰𝔬𝔫', 'a')).toMatchObject({ viewer: 'Tyson' });
    expect(viewer('🔥🔥🔥', 'b')).toMatchObject({ viewer: 'b' });
    expect(viewer('𝔯𝔲𝔡𝔢', 'c')).toMatchObject({ viewer: 'c' }); // a blocked word doesn't hide behind fancy letters
  });

  it('blocks words hidden behind decorative letters', () => {
    const { spoken } = setup([], { mode: 'all', blockedWords: ['rude'] });
    expect(spoken('a', 'you 𝔯𝔲𝔡𝔢 person')).toBeNull();
  });

  it('reads only prefixed comments by default, without the prefix', () => {
    const { spoken, say } = setup([]);
    expect(spoken('alice', '!TTS hello there')).toBe('hello there');
    expect(spoken('alice', 'hello there')).toBeNull();
    expect(say('alice', '!tts hi')).toEqual([{ type: 'tts', viewer: 'alice', text: 'hi', spoken: 'alice says hi' }]);
  });

  it('reads all chat except game commands in "all" mode, and nothing when off', () => {
    const all = setup([], { mode: 'all' });
    expect(all.spoken('alice', 'nice play')).toBe('nice play');
    expect(all.spoken('bob', 'LEFT')).toBeNull();
    expect(all.spoken('carol', 'join')).toBeNull();
    expect(all.spoken('dave', '!tts left')).toBe('left'); // explicitly asked to be read
    expect(setup([], { mode: 'off' }).spoken('alice', '!tts hello')).toBeNull();
    let viewers = 25;
    const auto = setup([], { mode: 'auto' }, {}, false, { viewers: () => viewers });
    expect(auto.spoken('alice', 'hello')).toBe('hello');
    expect(auto.spoken('bob', 'left')).toBeNull(); // still a game command
    viewers = 26;
    expect(auto.spoken('carol', 'hello')).toBeNull();
    expect(auto.spoken('dave', '!tts hello')).toBe('hello');
    const small = setup([], { mode: 'auto', autoMaxViewers: 5 }, {}, false, { viewers: () => viewers });
    expect(small.spoken('erin', 'hello')).toBeNull();
    viewers = 5;
    expect(small.spoken('erin', 'hello')).toBe('hello');
  });

  it('drops links, caps length and blocks listed words (whole words only)', () => {
    const { spoken } = setup([], { maxLength: 12, blockedWords: parseBlockedWords(' Ass , bad phrase') });
    expect(spoken('a', '!tts look https://x.example/y here')).toBe('look here');
    expect(spoken('b', '!tts this is a very long message')).toBe('this is a ve');
    expect(spoken('c', '!tts you ass')).toBeNull();
    expect(spoken('d', '!tts class')).toBe('class');
    expect(spoken('e', '!tts a BAD PHRASE')).toBeNull();
    expect(spoken('f', '!tts https://only.a/link')).toBeNull();
  });

  it('calls viewers by display name in alerts and speech, unless the name has a blocked word', () => {
    const { engine } = setup([rule({ trigger: 'follow', text: 'hi {viewer}' })], { mode: 'all', blockedWords: ['rude'] });
    expect(engine.handle({ kind: 'follow', viewerId: 'owl', name: 'Night Owl', at: 0 })).toContainEqual(expect.objectContaining({ text: 'hi Night Owl' }));
    const tts = (name: string, viewerId: string) => engine.handle({ kind: 'comment', viewerId, name, text: 'hello', at: 0 }).find((o) => o.type === 'tts');
    expect(tts('Night Owl', 'a')).toMatchObject({ viewer: 'Night Owl' });
    expect(tts('so rude', 'b')).toMatchObject({ viewer: 'b' });
  });

  it('applies a per-viewer cooldown', () => {
    const { spoken, advance } = setup([], { cooldownMs: 10_000 });
    expect(spoken('alice', '!tts one')).toBe('one');
    expect(spoken('alice', '!tts two')).toBeNull();
    expect(spoken('bob', '!tts three')).toBe('three');
    advance(10_000);
    expect(spoken('alice', '!tts four')).toBe('four');
  });

  it('enforces a minimum level only when progression is on', () => {
    expect(setup([], { minLevel: 3 }, { alice: 1 }).spoken('alice', '!tts hi')).toBe('hi');
    const gated = setup([], { minLevel: 3 }, { alice: 1, vet: 3 }, true);
    expect(gated.spoken('alice', '!tts hi')).toBeNull();
    expect(gated.spoken('vet', '!tts hi')).toBe('hi');
  });
});

describe('chat text-to-speech options', () => {
  const setup = (tts: Partial<TtsConfig>, viewers = 100) => {
    const clock = { now: 0 };
    const engine = createActions({
      config: { actions: [], tts: { ...baseTts, ...tts }, progression: false, points: false },
      now: () => clock.now,
      levelOf: () => 1,
      isCommand: () => false,
      topGifters: () => [],
      viewers: () => viewers,
    });
    return {
      say: (text: string, viewerId = 'ann') => {
        const m = engine.handle({ kind: 'comment', viewerId, name: 'Ann', text, at: 0 }).find((o) => o.type === 'tts');
        return m?.type === 'tts' ? m : null;
      },
      gift: (viewerId: string, count: number, giftName: string) => engine.handle({ kind: 'gift', viewerId, giftId: 1, giftName, count, diamonds: 1, at: 0 }),
      clock,
    };
  };

  it('stops at the word limit, and 0 means no limit', () => {
    expect(setup({ maxWords: 3 }).say('!tts one two three four five')?.text).toBe('one two three');
    expect(setup({ maxWords: 0 }).say('!tts one two three four five')?.text).toBe('one two three four five');
  });

  it('applies the character limit after the word limit', () => {
    expect(setup({ maxWords: 2, maxLength: 10 }).say('!tts wonderful weather today')?.text).toBe('wonderful');
  });

  it('speaks the template, with or without the name', () => {
    expect(setup({}).say('!tts hello')?.spoken).toBe('Ann says hello');
    expect(setup({ template: '{text}' }).say('!tts hello')?.spoken).toBe('hello');
    expect(setup({ template: '{viewer}: {text}, over' }).say('!tts hello')?.spoken).toBe('Ann: hello, over');
  });

  it('reads only viewers who sent a chosen gift, with the prefix', () => {
    const { say, gift } = setup({ unlockGifts: ['rose', 'lion'] });
    expect(say('!tts hello')).toBeNull();
    gift('bob', 1, 'Rose'); // someone else's gift doesn't count
    gift('ann', 1, 'Corgi'); // nor another gift, whatever it's worth
    expect(say('!tts hello')).toBeNull();
    gift('ann', 1, 'ROSE');
    expect(say('!tts hello')?.text).toBe('hello');
  });

  it('needs the gift in all chat and auto too', () => {
    const all = setup({ mode: 'all', unlockGifts: ['rose'] });
    expect(all.say('hello')).toBeNull();
    all.gift('ann', 1, 'Rose');
    expect(all.say('hello')?.text).toBe('hello');
    expect(setup({ mode: 'auto', unlockGifts: ['rose'] }, 10).say('hello')).toBeNull();
  });

  it('reads anyone with no gifts chosen', () => {
    expect(setup({ mode: 'all' }).say('hello')?.text).toBe('hello');
  });

  it('with no time set, stays unlocked for the stream', () => {
    const { say, gift, clock } = setup({ unlockGifts: ['rose'] });
    gift('ann', 1, 'Rose');
    clock.now = 24 * 3_600_000;
    expect(say('!tts hello')?.text).toBe('hello');
  });

  it('runs out after the time set, and more gifts add time', () => {
    const min = 60_000;
    const { say, gift, clock } = setup({ unlockGifts: ['rose'], unlockMs: 5 * min });
    gift('ann', 1, 'Rose');
    clock.now = 5 * min - 1;
    expect(say('!tts hello')?.text).toBe('hello');
    clock.now = 5 * min;
    expect(say('!tts hello')).toBeNull();
    gift('ann', 1, 'Rose'); // until 10
    clock.now = 6 * min;
    gift('ann', 2, 'Rose'); // a streak of two: 10 more, until 20
    clock.now = 20 * min - 1;
    expect(say('!tts hello')?.text).toBe('hello');
    clock.now = 20 * min;
    expect(say('!tts hello')).toBeNull();
  });
});

describe('reading commands aloud', () => {
  const cfg = { commandTemplate: '{viewer} pressed {command}', blockedWords: ['badword'] };
  it('names who sent it, "Chat" for a vote, and "Someone" for a name that can\'t or shouldn\'t be said', () => {
    expect(commandSpeech(cfg, 'Night Owl', 'jump')).toBe('Night Owl pressed jump');
    expect(commandSpeech(cfg, null, 'left')).toBe('Chat pressed left');
    expect(commandSpeech(cfg, '🔥🔥', 'jump')).toBe('Someone pressed jump');
    expect(commandSpeech(cfg, 'badword king', 'jump')).toBe('Someone pressed jump');
    expect(commandSpeech({ ...cfg, commandTemplate: '{command}!' }, 'alice', 'jump')).toBe('jump!');
  });
});
