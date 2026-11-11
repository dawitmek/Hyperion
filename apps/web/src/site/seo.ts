// What search engines and link previews show for each public page. The build turns these into each page's <head>
// (scripts/prerender.mjs), and the app keeps the tab title in step as you move between pages.
export interface PageMeta {
  title: string;
  description: string;
}

export const SITE_PAGES: Record<string, PageMeta> = {
  '/': {
    title: 'Hyperion: TikTok LIVE Interactive Games, Let Chat Play Your Game',
    description:
      'Free, open-source TikTok LIVE interactive tool. Viewers type commands or send gifts and Hyperion presses keys in your game, spawns mobs in Minecraft, reads chat aloud and shows alerts. Windows and macOS.',
  },
  '/features': {
    title: 'Features: TikTok LIVE Gifts, Chat Commands, Alerts and TTS | Hyperion',
    description:
      'Five crowd modes, gift-triggered key presses and alerts, chat read aloud with voice effects, viewer levels, a leaderboard and per-stream analytics for TikTok LIVE.',
  },
  '/integrations': {
    title: 'TikTok LIVE Minecraft Integration: Gifts Spawn Mobs and TNT | Hyperion',
    description:
      'Connect TikTok LIVE gifts to Minecraft Java and Bedrock. A rose spawns a creeper, a lion drops TNT, and the mob wears the gifter’s name. No mods required.',
  },
  '/how-it-works': {
    title: 'How TikTok LIVE Chat Plays Your Game | Hyperion',
    description:
      'From a TikTok LIVE comment to a key press: how Hyperion reads chat, applies your crowd mode and cooldowns, and tells the companion app on your PC what to press.',
  },
  '/self-hosting': {
    title: 'Self-Host Hyperion with Docker | TikTok LIVE Interactive Server',
    description: 'Run your own Hyperion server and database with one Docker command. Free and open source under the GPL-3.0.',
  },
  '/faq': {
    title: 'FAQ: TikTok LIVE Interactive Games and Chat Control | Hyperion',
    description: 'Answers about Hyperion: supported games, Windows and macOS, safety limits on key presses, gifts, voices and self-hosting.',
  },
  '/download': {
    title: 'Download Hyperion Companion for Windows and macOS',
    description:
      'Download the free Hyperion companion app. It presses the keys your TikTok LIVE chat asks for in the game you choose, on Windows 10/11 and macOS 11 or later.',
  },
  '/changelog': {
    title: 'Changelog | Hyperion',
    description: 'What’s new in Hyperion, the free and open-source TikTok LIVE interactive tool.',
  },
  '/privacy': {
    title: 'Privacy | Hyperion',
    description: 'What Hyperion stores, why, and how to delete it.',
  },
  '/terms': {
    title: 'Terms of Use | Hyperion',
    description: 'The rules for using a Hyperion server: who can use it, TikTok and your games, uploads, gifts and raffles.',
  },
};

export const DEFAULT_TITLE = 'Hyperion';
