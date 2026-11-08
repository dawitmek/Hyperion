// What the action list and packs share: a game action, its game's tag, and a command with its blanks shown as pills.
import { Icon } from "./icons";

// Commands sent straight into a game, set up and kept on this PC.
export interface GameAction {
  name: string;
  game: Game;
  commands: string[];
  repeat: number;
  delayMs: number;
}

export type Game = "minecraftJava" | "minecraftBedrock";
export const GAME_NAMES: Record<Game, string> = { minecraftJava: "Minecraft Java", minecraftBedrock: "Minecraft Bedrock" };

// Each game's colour, used for its badge, tag and choice card.
export const GAME_HUES: Record<Game, string> = { minecraftJava: "orange", minecraftBedrock: "sky" };

// A game's mark: a block on a tile in the game's colour.
export function GameBadge({ game, size = 34 }: { game: Game; size?: number }) {
  return (
    <span className={`game-badge ${GAME_HUES[game]}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="cube" size={Math.round(size * 0.5)} />
    </span>
  );
}

export function GameTag({ game }: { game: Game }) {
  return game === "minecraftJava" ? <span className="tag orange">Java</span> : <span className="tag sky">Bedrock</span>;
}

export const BLANK = /\{(viewer|count|player)\}/;

// A command as written, with its blanks as pills.
export function CommandLine({ text }: { text: string }) {
  const parts = text.split(BLANK);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={`blank ${part}`}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
