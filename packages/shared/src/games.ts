// Ready-made profiles for popular games: each game's default keyboard controls as chat commands.
// Hyperion presses keys only (no mouse), so these are games that play well from the keyboard.
// Movement on WASD is typed as the key itself (w, a, s, d). Hold times are longer for moving and driving, short for
// one-off presses.

export interface GameTemplate {
  id: string;
  name: string;
  processes: string[]; // the Windows executables, as the companion lists them: any of them counts as the game
  commands: { keyword: string; key: string; holdMs: number }[];
}

export const GAME_TEMPLATES: readonly GameTemplate[] = [
  {
    id: 'gta5',
    name: 'GTA V',
    processes: ['gta5.exe', 'gta5_enhanced.exe'], // the original and the Enhanced edition
    commands: [
      { keyword: 'w', key: 'KeyW', holdMs: 1500 },
      { keyword: 's', key: 'KeyS', holdMs: 1000 },
      { keyword: 'a', key: 'KeyA', holdMs: 600 },
      { keyword: 'd', key: 'KeyD', holdMs: 600 },
      { keyword: 'run', key: 'Shift+KeyW', holdMs: 1500 },
      { keyword: 'jump', key: 'Space', holdMs: 300 },
      { keyword: 'enter', key: 'KeyF', holdMs: 300 },
      { keyword: 'reload', key: 'KeyR', holdMs: 200 },
      { keyword: 'horn', key: 'KeyE', holdMs: 500 },
    ],
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    processes: ['javaw.exe', 'minecraft.windows.exe'], // Java and Bedrock
    commands: [
      { keyword: 'w', key: 'KeyW', holdMs: 1000 },
      { keyword: 's', key: 'KeyS', holdMs: 600 },
      { keyword: 'a', key: 'KeyA', holdMs: 600 },
      { keyword: 'd', key: 'KeyD', holdMs: 600 },
      { keyword: 'jump', key: 'Space', holdMs: 300 },
      { keyword: 'sneak', key: 'ShiftLeft', holdMs: 1000 },
      { keyword: 'inventory', key: 'KeyE', holdMs: 100 },
      { keyword: 'drop', key: 'KeyQ', holdMs: 100 },
      { keyword: 'swap', key: 'KeyF', holdMs: 100 },
      { keyword: 'slot1', key: 'Digit1', holdMs: 100 },
      { keyword: 'slot2', key: 'Digit2', holdMs: 100 },
      { keyword: 'slot3', key: 'Digit3', holdMs: 100 },
    ],
  },
  {
    id: 'roblox',
    name: 'Roblox',
    processes: ['robloxplayerbeta.exe'],
    commands: [
      { keyword: 'w', key: 'KeyW', holdMs: 1000 },
      { keyword: 's', key: 'KeyS', holdMs: 600 },
      { keyword: 'a', key: 'KeyA', holdMs: 600 },
      { keyword: 'd', key: 'KeyD', holdMs: 600 },
      { keyword: 'jump', key: 'Space', holdMs: 300 },
      { keyword: 'turnleft', key: 'ArrowLeft', holdMs: 400 },
      { keyword: 'turnright', key: 'ArrowRight', holdMs: 400 },
      { keyword: 'tool1', key: 'Digit1', holdMs: 100 },
      { keyword: 'tool2', key: 'Digit2', holdMs: 100 },
    ],
  },
  {
    id: 'ets2',
    name: 'Euro Truck Simulator 2',
    processes: ['eurotrucks2.exe'],
    commands: [
      { keyword: 'w', key: 'KeyW', holdMs: 2000 },
      { keyword: 's', key: 'KeyS', holdMs: 1000 },
      { keyword: 'a', key: 'KeyA', holdMs: 700 },
      { keyword: 'd', key: 'KeyD', holdMs: 700 },
      { keyword: 'handbrake', key: 'Space', holdMs: 300 },
      { keyword: 'horn', key: 'KeyH', holdMs: 500 },
      { keyword: 'lights', key: 'KeyL', holdMs: 100 },
      { keyword: 'engine', key: 'KeyE', holdMs: 100 },
      { keyword: 'cruise', key: 'KeyC', holdMs: 100 },
    ],
  },
  {
    id: 'hollow-knight',
    name: 'Hollow Knight',
    processes: ['hollow_knight.exe'],
    commands: [
      { keyword: 'left', key: 'ArrowLeft', holdMs: 400 },
      { keyword: 'right', key: 'ArrowRight', holdMs: 400 },
      { keyword: 'up', key: 'ArrowUp', holdMs: 200 }, // look up, or aim a spell or strike up
      { keyword: 'down', key: 'ArrowDown', holdMs: 200 },
      { keyword: 'jump', key: 'KeyZ', holdMs: 300 }, // held longer, it jumps higher
      { keyword: 'attack', key: 'KeyX', holdMs: 100 },
      { keyword: 'dash', key: 'KeyC', holdMs: 100 },
      { keyword: 'heal', key: 'KeyA', holdMs: 1200 }, // Focus: held until it heals a mask
      { keyword: 'cast', key: 'KeyF', holdMs: 100 }, // Quick Cast
    ],
  },
];
