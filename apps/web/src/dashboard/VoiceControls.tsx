import { useEffect, useState } from 'react';
import { TIKTOK_VOICES } from '@hyperion/shared';
import { api, type Host, type TtsEngine, type TtsMode } from '../api';
import { Icon } from '../icons';
import { Link } from '../router';
import { ErrorNotice, NumberCell, Scrubber, Seg, useError } from '../ui';
import type { PageProps } from './Dashboard';
import { enginesFor, useVoices } from './VoicePage';

type Options = { piperVoices: { name: string; speakers: number }[]; espeakVoices: string[] };
type Choice = { value: string; list: [string, string][]; pick: (value: string) => void };

// The Live page's quick voice controls: what's read aloud, the voice and the volume, each applied at once.
// Everything else (filters, effects, cloud keys) stays on the Voice page.
export function VoiceControls({ host, refreshHost }: PageProps) {
  const { error, guard } = useError();
  const save = (patch: Partial<Host>) => guard(() => api('PATCH', '/settings', patch).then(refreshHost))();
  const browserVoices = useVoices();
  const [options, setOptions] = useState<Options>({ piperVoices: [], espeakVoices: [] });
  useEffect(() => void api<Options>('GET', '/tts/options').then(setOptions), []);

  // The voices to pick from for the chosen engine, and which setting the pick goes to. Cloud voices need the
  // provider's list, so they're picked on the Voice page.
  const voiceChoice = (): Choice | null => {
    switch (host.ttsEngine) {
      case 'piper':
        if (options.piperVoices.length === 0) return null;
        return {
          value: host.ttsPiperVoice ?? '',
          list: [['', `Default (${options.piperVoices[0]!.name})`], ...options.piperVoices.map((v): [string, string] => [v.name, v.name])],
          // A speaker number from the previous voice means nothing for the new one.
          pick: (v) => save({ ttsPiperVoice: v || null, ttsPiperSpeaker: null }),
        };
      case 'espeak':
        return { value: host.ttsEspeakVoice, list: options.espeakVoices.map((v): [string, string] => [v, v]), pick: (v) => save({ ttsEspeakVoice: v }) };
      case 'tiktok':
        return {
          value: host.ttsTiktokVoice ?? '',
          list: TIKTOK_VOICES.map((v, i): [string, string] => [i === 0 ? '' : v.id, v.label]),
          pick: (v) => save({ ttsTiktokVoice: v || null }),
        };
      case 'browser':
        return {
          value: host.ttsVoice ?? '',
          list: [['', 'Default voice'], ...browserVoices.map((v): [string, string] => [v.name, `${v.name} (${v.lang})`])],
          pick: (v) => save({ ttsVoice: v || null }),
        };
      case 'cloud':
        return null;
    }
  };
  const choice = voiceChoice();
  const modeHints: Record<TtsMode, string> = {
    off: 'Only alerts marked "Read aloud" are spoken.',
    auto: `All chat up to ${host.ttsAutoMaxViewers} viewers, then only ${host.ttsPrefix}.`,
    prefix: `Only comments starting with ${host.ttsPrefix}.`,
    all: 'Every comment. Busy chat gets skipped.',
  };

  return (
    <section className="card stack voice-controls" aria-labelledby="live-voice">
      <div className="mode-card-head">
        <h2 id="live-voice">Voice</h2>
        <Link href="/dashboard/voice" className="small">
          All voice settings
        </Link>
      </div>
      <ErrorNotice error={error} />
      <div className="field">
        Read chat aloud
        <Seg<TtsMode>
          label="Read chat aloud"
          value={host.ttsMode}
          options={[
            ['off', 'Off'],
            ['auto', 'Auto'],
            ['prefix', host.ttsPrefix],
            ['all', 'All'],
          ]}
          onChange={(ttsMode) => save({ ttsMode })}
        />
        <span className="hint">{modeHints[host.ttsMode]}</span>
      </div>
      {host.ttsMode === 'auto' && (
        <label className="field">
          All chat up to
          <NumberCell value={host.ttsAutoMaxViewers} min={0} max={100000} label="All chat up to this many viewers" onSave={(ttsAutoMaxViewers) => save({ ttsAutoMaxViewers })} />
        </label>
      )}
      <label className="field">
        Engine
        <select className="input" value={host.ttsEngine} onChange={(e) => save({ ttsEngine: e.target.value as TtsEngine })}>
          {enginesFor(options.piperVoices.length > 0, host.ttsEngine).map(([engine, label]) => (
            <option key={engine} value={engine}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {choice ? (
        <label className="field">
          Voice
          <select className="input" value={choice.value} onChange={(e) => choice.pick(e.target.value)}>
            {choice.list.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        host.ttsEngine === 'cloud' && (
          <p className="muted small">
            Cloud voices are picked on the <Link href="/dashboard/voice">Voice page</Link>.
          </p>
        )
      )}
      <div className="field">
        Volume
        <Scrubber value={host.ttsVolume} min={0} max={100} buttonStep={5} unit="%" label="Voice volume" onSave={(ttsVolume) => save({ ttsVolume })} />
      </div>
      <button className="btn" onClick={guard(() => api('POST', '/tts/skip'))}>
        <Icon name="skip" size={16} />
        Skip this message
      </button>
    </section>
  );
}
