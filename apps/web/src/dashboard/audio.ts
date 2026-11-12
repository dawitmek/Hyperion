import type { AlertSound, ServerToOverlay } from '@hyperion/shared';
import { playSound } from '../sounds';
import { SpeechPlayer } from '../speech-player';

// One AudioContext for previewing sounds and voices on the dashboard, made on first use (after a click).
let context: AudioContext | null = null;
export const previewAudio = () => (context ??= new AudioContext());

let speech: SpeechPlayer | null = null;

// One sound previews at a time: starting one stops the one before.
let playing: { stop: () => void; owner?: unknown } | null = null;
export function playingPreview(stop: () => void, owner?: unknown) {
  if (owner === undefined || playing?.owner !== owner) playing?.stop();
  playing = { stop, owner };
}

export function previewSound(sound: AlertSound, volume: number) {
  const audio = previewAudio();
  void audio.resume();
  const out = playSound(audio, sound, volume);
  playingPreview(() => out.disconnect());
}

export function previewFile(id: string, volume: number) {
  const file = new Audio(`/media/${id}`);
  file.volume = volume;
  playingPreview(() => file.pause());
  void file.play();
}

// Plays an alert's sound and voice here, the way the overlay would.
export function playAlertPreview(alert: Extract<ServerToOverlay, { type: 'alert' }>) {
  if (alert.sound) previewSound(alert.sound, (alert.soundVolume ?? 100) / 100);
  if (alert.soundFile) previewFile(alert.soundFile, (alert.soundFileVolume ?? 100) / 100);
  if (alert.speech) (speech ??= new SpeechPlayer(previewAudio)).say(alert.speech);
}
