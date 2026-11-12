import { LoopVideo } from './LoopVideo';

// The home page's hero: a LIVE stream where chat drives the game. The clip is real GTA V gameplay with the Hyperion
// overlay on it, framed like a phone showing a TikTok LIVE.
export function LiveScene() {
  return (
    <div className="h-scene" aria-hidden="true">
      <div className="h-frame">
        <LoopVideo className="h-hero-video" src="/hero.mp4" poster="/hero.jpg" />
        <div className="h-live-top">
          <span className="h-live-pill">LIVE</span>
          <span className="h-live-viewers">1.2K</span>
        </div>
      </div>
    </div>
  );
}
