import { useEffect, useState } from 'react';
import { CLOUD_PROVIDERS, DEFAULT_TTS_TEMPLATE, MAX_TTS_TEMPLATE_LENGTH, templateProblem, TTS_PLACEHOLDERS, MAX_LEVEL, TIKTOK_VOICES, VOICE_EFFECTS } from '@hyperion/shared';
import { api, ApiError, type CloudProvider, type Host, type Speech, type TtsEngine, type VoiceEffect } from '../api';
import { Icon } from '../icons';
import { SpeechPlayer } from '../speech-player';
import { findGift, GiftPicker, useGifts } from './GiftPicker';
import { Card, Choices, cleanTyped, ErrorNotice, HueIcon, NumberCell, Scrubber, Seg, Switch, TextCell, useError } from '../ui';
import type { PageProps } from './Dashboard';
import { previewAudio } from './audio';

// Installed voices only: cloud "Online" voices exist in one browser (Edge) and never in OBS.
export function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => v.localService));
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

export const ENGINES: [TtsEngine, string, string][] = [
  ['tiktok', 'TikTok voices', "TikTok's own voices, through your TikTok account. Unofficial: TikTok may change or block it."],
  ['piper', 'Piper (server)', 'Natural offline voices made on the Hyperion server. Plays through OBS.'],
  ['espeak', 'eSpeak (overlay)', 'Robotic voice made inside the overlay, many languages. Plays through OBS.'],
  ['cloud', 'Your cloud key', 'Google, Azure or ElevenLabs with your own API key (you pay them). Plays through OBS.'],
  ['browser', 'Browser voices', "The streaming PC's built-in voices. Plays outside OBS's mixer; capture Desktop Audio."],
];
// Piper is opt-in for self-hosters, so it's only offered on servers that have it (or to a host who already picked it).
export const enginesFor = (piperInstalled: boolean, current: TtsEngine) =>
  ENGINES.filter(([engine]) => engine !== 'piper' || piperInstalled || current === 'piper');
const CLOUD_LABELS: Record<CloudProvider, string> = { google: 'Google Cloud', azure: 'Azure Speech', elevenlabs: 'ElevenLabs' };
const CLOUD_VOICE_HINTS: Record<CloudProvider, string> = {
  google: 'e.g. en-US-Neural2-F',
  azure: 'e.g. en-US-AriaNeural',
  elevenlabs: 'a voice ID, e.g. 21m00Tcm4TlvDq8ikWAM',
};
const EFFECT_LABELS: Record<VoiceEffect, string> = {
  none: 'None',
  chipmunk: 'Chipmunk',
  deep: 'Deep',
  monster: 'Monster',
  robot: 'Robot',
  radio: 'Radio',
  echo: 'Echo',
};

let previewPlayer: SpeechPlayer | null = null;

// Secrets the dashboard can set or clear but never reads back.
type SettingsPatch = Partial<Host> | { ttsCloudKey: string | null } | { ttsTiktokSession: null };

export function VoicePage({ host, refreshHost }: PageProps) {
  const { error, guard, setError } = useError();
  const save = (patch: SettingsPatch) =>
    guard(() => api('PATCH', '/settings', patch).then(refreshHost))();

  return (
    <div className="stack">
      <ErrorNotice error={error} />
      <Card
        badge="chat"
        hue="sky"
        title="What gets read aloud"
        description='Your overlay reads chat aloud as "viewer says …", and speaks alerts marked "Read aloud". Links are never read, and in "all chat" mode game commands are skipped.'
      >
        <Choices
          label="Text-to-speech mode"
          value={host.ttsMode}
          options={[
            ['off', 'Off', 'Only alerts marked "Read aloud" are spoken.'],
            ['auto', 'Auto (recommended)', `All chat up to ${host.ttsAutoMaxViewers} viewers, then prefixed chat, switching as your stream grows or shrinks.`],
            ['prefix', 'Prefixed chat', `Comments starting with ${host.ttsPrefix}, e.g. "${host.ttsPrefix} hello". Best above ${host.ttsAutoMaxViewers} viewers.`],
            ['all', 'All chat', `Every comment that passes the filters below. Best up to ${host.ttsAutoMaxViewers} viewers; busier chat gets skipped.`],
          ]}
          onChange={(ttsMode) => save({ ttsMode })}
        />
        {host.ttsMode === 'auto' && (
          <label className="field">
            All chat up to this many viewers
            <NumberCell value={host.ttsAutoMaxViewers} min={0} max={100000} onSave={(ttsAutoMaxViewers) => save({ ttsAutoMaxViewers })} />
          </label>
        )}
        <Switch
          checked={host.ttsCommands}
          onChange={(ttsCommands) => save({ ttsCommands })}
          hint="Says who pressed what when a command fires, even with chat reading off. At most one every few seconds, so a busy crowd doesn't drown out chat."
        >
          Read commands aloud
        </Switch>
        {host.ttsCommands && (
          <label className="field">
            Read each command as
            <span className="hint">Use {'{command}'} for the command and, if you like, {'{viewer}'} for who sent it ("Chat" for a democracy vote).</span>
            <TextCell
              value={host.ttsCommandTemplate}
              required
              label="Command wording"
              maxLength={MAX_TTS_TEMPLATE_LENGTH}
              check={(t) => templateProblem(t, TTS_PLACEHOLDERS.command, 'command')}
              onSave={(ttsCommandTemplate) => save({ ttsCommandTemplate })}
            />
          </label>
        )}
      </Card>
      <VoiceCard host={host} save={save} guard={guard} setError={setError} refreshHost={refreshHost} />
      <GiftUnlock host={host} save={save} />
      <Card
        badge="shield"
        hue="amber"
        title="Chat filters"
        description={host.ttsMode === 'off' ? 'Turn on reading chat above to use these.' : 'Applies to chat only; alerts are always read.'}
      >
        <fieldset className="stack" disabled={host.ttsMode === 'off'}>
          <div className="form-grid">
            <label className="field">
              Prefix
              <TextCell value={host.ttsPrefix} required label="Prefix" maxLength={16} allowed={/\S/} onSave={(ttsPrefix) => save({ ttsPrefix })} />
            </label>
            <label className="field">
              Max length, in characters
              <NumberCell value={host.ttsMaxLength} min={10} max={300} onSave={(ttsMaxLength) => save({ ttsMaxLength })} />
            </label>
            <label className="field">
              Max length, in words
              <span className="hint">0 for no word limit.</span>
              <NumberCell value={host.ttsMaxWords} min={0} max={100} onSave={(ttsMaxWords) => save({ ttsMaxWords })} />
            </label>
            <label className="field">
              Cooldown per viewer, in seconds
              <NumberCell value={host.ttsCooldownMs / 1000} min={0} max={600} onSave={(s) => save({ ttsCooldownMs: s * 1000 })} />
            </label>
            {host.progression && (
              <label className="field">
                Minimum level
                <NumberCell value={host.ttsMinLevel} min={1} max={MAX_LEVEL} onSave={(ttsMinLevel) => save({ ttsMinLevel })} />
              </label>
            )}
          </div>
          <ReadAs template={host.ttsTemplate} onSave={(ttsTemplate) => save({ ttsTemplate })} />
          <BlockedWords value={host.ttsBlockedWords} onSave={(ttsBlockedWords) => save({ ttsBlockedWords })} />
        </fieldset>
      </Card>
    </div>
  );
}

function VoiceCard({
  host,
  save,
  guard,
  setError,
  refreshHost,
}: {
  host: Host;
  save: (patch: SettingsPatch) => void;
  guard: ReturnType<typeof useError>['guard'];
  setError: (e: string | null) => void;
  refreshHost: () => void;
}) {
  const voices = useVoices();
  const [options, setOptions] = useState<{
    piperVoices: { name: string; speakers: number }[];
    espeakVoices: string[];
    tiktokServerAccount: boolean;
  }>({ piperVoices: [], espeakVoices: [], tiktokServerAccount: false });
  const [cloudVoices, setCloudVoices] = useState<{ id: string; label: string }[] | null>(null);
  const loadCloudVoices = guard(() => api<{ id: string; label: string }[]>('GET', '/tts/cloud-voices').then(setCloudVoices));
  // A list from another provider or key would offer voices this account can't use.
  useEffect(() => setCloudVoices(null), [host.ttsCloudProvider, host.ttsCloudKeySet]);
  const [cloudKey, setCloudKey] = useState('');
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => void api<typeof options>('GET', '/tts/options').then(setOptions), []);

  // Plays exactly what the overlay would get, so a bad cloud key or missing voice shows up here.
  const preview = async () => {
    setError(null);
    setPreviewing(true);
    try {
      const speech = await api<Speech>('POST', '/tts/preview', { text: 'viewer says hello from Hyperion' });
      previewPlayer ??= new SpeechPlayer(previewAudio);
      previewPlayer.setVolume(host.ttsVolume / 100);
      await previewPlayer.play(speech);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Could not play the preview: ${String(e)}`);
    } finally {
      setPreviewing(false);
    }
  };
  const piperMissing = host.ttsEngine === 'piper' && options.piperVoices.length === 0;
  // TikTok and cloud voices that fail use Piper, or eSpeak on a server without it.
  const fallsBack = host.ttsEngine === 'cloud' || host.ttsEngine === 'tiktok';
  const showPiper = host.ttsEngine === 'piper' || (fallsBack && options.piperVoices.length > 0);
  const tiktokWaiting = host.ttsEngine === 'tiktok' && !host.ttsTiktokConnected && !options.tiktokServerAccount;
  // The sign-in happens in the companion app; notice it here without a reload.
  useEffect(() => {
    if (!tiktokWaiting) return;
    const timer = setInterval(refreshHost, 3000);
    return () => clearInterval(timer);
  }, [tiktokWaiting, refreshHost]);
  const piperVoice = options.piperVoices.find((v) => v.name === host.ttsPiperVoice) ?? options.piperVoices[0];

  return (
    <Card
      badge="voice"
      hue="violet"
      title="Voice"
      description={host.ttsMode === 'off' ? 'Chat isn\u2019t read aloud right now. This voice is still used for alerts marked "Read aloud".' : undefined}
      actions={
        <button className="btn btn-primary" onClick={() => void preview()} disabled={previewing}>
          {previewing ? 'Speaking…' : 'Preview voice'}
        </button>
      }
    >
      <div className={`stack ${host.ttsMode === 'off' ? 'dimmed' : ''}`}>
        <Choices label="Voice engine" value={host.ttsEngine} options={enginesFor(options.piperVoices.length > 0, host.ttsEngine)} onChange={(ttsEngine) => save({ ttsEngine })} />
        {tiktokWaiting && (
          <p className="notice info">
            Sign in to TikTok from the companion app: open it on your PC and choose Sign in to TikTok. Until then, chat is read
            with {options.piperVoices.length > 0 ? 'Piper' : 'eSpeak'}.
          </p>
        )}
        {piperMissing && (
          <p className="notice warning">This server doesn’t have Piper installed, so eSpeak is used instead. Pick another engine, or ask whoever runs the server to add Piper.</p>
        )}
        <div className="form-grid">
          {showPiper && options.piperVoices.length > 0 && (
            <label className="field">
              Piper voice{fallsBack && ' (fallback)'}
              <select
                value={host.ttsPiperVoice ?? ''}
                // A speaker number from the previous voice means nothing for the new one.
                onChange={(e) => save({ ttsPiperVoice: e.target.value || null, ttsPiperSpeaker: null })}
              >
                <option value="">Default ({options.piperVoices[0]!.name})</option>
                {options.piperVoices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                    {v.speakers > 1 ? ` (${v.speakers} speakers)` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showPiper && piperVoice && piperVoice.speakers > 1 && (
            <div className="field">
              Speaker
              <span className="hint">0–{piperVoice.speakers - 1}; each one sounds different.</span>
              <span className="row" style={{ flexWrap: 'nowrap' }}>
                <NumberCell
                  value={host.ttsPiperSpeaker ?? 0}
                  min={0}
                  max={piperVoice.speakers - 1}
                  label="Speaker"
                  onSave={(ttsPiperSpeaker) => save({ ttsPiperSpeaker })}
                />
                <button className="btn" onClick={() => save({ ttsPiperSpeaker: Math.floor(Math.random() * piperVoice.speakers) })}>
                  Random
                </button>
              </span>
            </div>
          )}
          {host.ttsEngine === 'tiktok' && (
            <>
              <label className="field">
                TikTok voice
                <select value={host.ttsTiktokVoice ?? ''} onChange={(e) => save({ ttsTiktokVoice: e.target.value || null })}>
                  {TIKTOK_VOICES.map((v, i) => (
                    <option key={v.id} value={i === 0 ? '' : v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {(host.ttsEngine === 'espeak' || piperMissing || (fallsBack && !showPiper)) && (
            <label className="field">
              eSpeak language{host.ttsEngine !== 'espeak' && ' (fallback)'}
              <select value={host.ttsEspeakVoice} onChange={(e) => save({ ttsEspeakVoice: e.target.value })}>
                {options.espeakVoices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
          {host.ttsEngine === 'browser' && (
            <label className="field">
              Voice installed on this PC
              <select value={host.ttsVoice ?? ''} onChange={(e) => save({ ttsVoice: e.target.value || null })}>
                <option value="">Default voice</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
          )}
          {host.ttsEngine === 'cloud' && (
            <>
              <label className="field">
                Provider
                <select value={host.ttsCloudProvider ?? ''} onChange={(e) => save({ ttsCloudProvider: (e.target.value || null) as CloudProvider | null })}>
                  <option value="">Choose…</option>
                  {CLOUD_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {CLOUD_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                API key
                {host.ttsCloudKeySet && <span className="hint">Saved. Enter a new one to replace it.</span>}
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={cloudKey}
                    placeholder={host.ttsCloudKeySet ? '••••••••' : 'paste your key'}
                    maxLength={300}
                    onChange={(e) => setCloudKey(e.target.value.replace(/\s/g, ''))}
                    aria-label="Cloud API key"
                  />
                  <button className="btn" disabled={!cloudKey.trim()} onClick={() => (save({ ttsCloudKey: cloudKey.trim() }), setCloudKey(''))}>
                    Save key
                  </button>
                  {host.ttsCloudKeySet && (
                    <button className="btn btn-ghost btn-delete" onClick={() => save({ ttsCloudKey: null })}>
                      Remove
                    </button>
                  )}
                </span>
              </div>
              {host.ttsCloudProvider && (
                <div className="field">
                  Cloud voice
                  <span className="row" style={{ flexWrap: 'nowrap' }}>
                    {cloudVoices ? (
                      <select className="input" value={host.ttsCloudVoice ?? ''} onChange={(e) => save({ ttsCloudVoice: e.target.value || null })}>
                        <option value="">Default</option>
                        {cloudVoices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <TextCell
                        value={host.ttsCloudVoice ?? ''}
                        placeholder={CLOUD_VOICE_HINTS[host.ttsCloudProvider]}
                        label="Cloud voice"
                        maxLength={100}
                        allowed={/[A-Za-z0-9_.:-]/}
                        onSave={(v) => save({ ttsCloudVoice: v || null })}
                      />
                    )}
                    {host.ttsCloudKeySet && !cloudVoices && (
                      <button className="btn" onClick={loadCloudVoices}>
                        List my voices
                      </button>
                    )}
                  </span>
                </div>
              )}
              {host.ttsCloudProvider === 'azure' && (
                <label className="field">
                  Region
                  <TextCell
                    value={host.ttsCloudRegion ?? ''}
                    placeholder="e.g. eastus"
                    label="Azure region"
                    maxLength={40}
                    allowed={/[A-Za-z0-9]/}
                    onSave={(v) => save({ ttsCloudRegion: v.toLowerCase() || null })}
                  />
                </label>
              )}
            </>
          )}
          <label className="field">
            Voice effect
            <span className="hint">Any engine; browser voices only get pitch and speed.</span>
            <select value={host.ttsEffect} onChange={(e) => save({ ttsEffect: e.target.value as VoiceEffect })}>
              {VOICE_EFFECTS.map((effect) => (
                <option key={effect} value={effect}>
                  {EFFECT_LABELS[effect]}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            Volume
            <span className="hint">Of every voice on your overlays, chat and alerts alike. Changes right away, even mid-sentence.</span>
            <Scrubber value={host.ttsVolume} min={0} max={100} buttonStep={5} unit="%" label="Voice volume" onSave={(ttsVolume) => save({ ttsVolume })} />
          </div>
        </div>
      </div>
    </Card>
  );
}

type ReadStyle = 'name' | 'message' | 'custom';
const READ_TEMPLATES: Partial<Record<ReadStyle, string>> = { name: DEFAULT_TTS_TEMPLATE, message: '{text}' };

// What's said for a chat line: the name and message, only the message, or the host's own wording.
function ReadAs({ template, onSave }: { template: string; onSave: (template: string) => void }) {
  const preset = template === READ_TEMPLATES.message ? 'message' : template === READ_TEMPLATES.name ? 'name' : 'custom';
  const [picked, setPicked] = useState<ReadStyle>(preset);
  return (
    <div className="field">
      Read each message as
      <Seg<ReadStyle>
        label="Read each message as"
        value={picked}
        options={[
          ['name', 'Name says message'],
          ['message', 'Message only'],
          ['custom', 'Custom'],
        ]}
        onChange={(style) => {
          setPicked(style);
          const next = READ_TEMPLATES[style];
          if (next) onSave(next);
        }}
      />
      {picked === 'custom' && (
        <>
          <span className="hint">Use {'{text}'} for the message and, if you like, {'{viewer}'} for the name.</span>
          <TextCell
            value={template}
            required
            label="Custom wording"
            maxLength={MAX_TTS_TEMPLATE_LENGTH}
            check={(t) => templateProblem(t, TTS_PLACEHOLDERS.chat, 'text')}
            onSave={onSave}
          />
        </>
      )}
      <span className="hint">
        Sounds like: “{template.replaceAll('{viewer}', 'Night Owl').replaceAll('{text}', 'hello everyone')}”
      </span>
    </div>
  );
}

// Words and phrases that stop a comment (or a name) being read: chips to remove, and a box to add more that only opens
// when asked. Saved as the comma-separated list the server reads.
function BlockedWords({ value, onSave }: { value: string; onSave: (list: string) => void }) {
  const [words, setWords] = useState(() => parseWords(value)); // kept here so quick edits build on each other
  useEffect(() => setWords(parseWords(value)), [value]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [full, setFull] = useState(false);
  const commit = (next: string[]) => (setWords(next), onSave(next.join(', ')));
  const add = () => {
    const fresh = parseWords(text)
      .map((w) => w.slice(0, MAX_BLOCKED_WORD))
      .filter((w, i, all) => ![...words, ...all.slice(0, i)].some((x) => x.toLowerCase() === w.toLowerCase()));
    const next = [...words, ...fresh];
    // The server keeps the list to so many characters, written out with ", " between.
    if (next.join(', ').length > MAX_BLOCKED_LIST) return setFull(true);
    setFull(false);
    if (fresh.length > 0) commit(next);
    setText('');
  };
  return (
    <div className="field">
      Blocked words
      <span className="hint">A comment containing one is not read. Single words match whole words; phrases match anywhere.</span>
      {words.length > 0 && (
        <ul className="unlock-gifts blocked-words">
          {words.map((w) => (
            <li key={w}>
              {w}
              <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Unblock ${w}`} onClick={() => (setFull(false), commit(words.filter((x) => x !== w)))}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {full && (
        <span className="field-problem" role="alert">
          The list is full. Remove some words to add more.
        </span>
      )}
      {adding ? (
        <div className="row blocked-words-add">
          <input
            className="input"
            autoFocus
            value={text}
            placeholder="A word or phrase, then Enter. Commas add several."
            aria-label="Word or phrase to block"
            maxLength={200}
            onChange={(e) => (setText(cleanTyped(e.target.value)), setFull(false))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.preventDefault(), add());
              if (e.key === 'Escape') (setText(''), setAdding(false));
            }}
          />
          <button type="button" className="btn" onClick={() => (add(), setAdding(false))}>
            Done
          </button>
        </div>
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            {words.length > 0 ? 'Add more' : 'Add blocked words'}
          </button>
        </div>
      )}
    </div>
  );
}
const MAX_BLOCKED_WORD = 50; // characters in one word or phrase
const MAX_BLOCKED_LIST = 5000; // the server's limit on the whole list
const parseWords = (list: string) =>
  list
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

// Who gets read: anyone, or only viewers who sent one of these gifts, for a while or for the rest of the stream.
function GiftUnlock({ host, save }: { host: Host; save: (patch: SettingsPatch) => void | Promise<unknown> }) {
  const gifts = useGifts();
  const [picked, setPicked] = useState(host.ttsUnlockGifts); // kept here so quick clicks build on each other
  const [choosing, setChoosing] = useState(false);
  const toggle = (name: string) => {
    const has = picked.some((p) => p.toLowerCase() === name.toLowerCase());
    const next = has ? picked.filter((p) => p.toLowerCase() !== name.toLowerCase()) : [...picked, name];
    setPicked(next);
    save({ ttsUnlockGifts: next });
  };
  return (
    <Card
      badge="gift"
      hue="pink"
      title="Unlock with gifts"
      icon={<HueIcon name="gift" hue="amber" />}
      description={host.ttsMode === 'off' ? 'Turn on reading chat above to use this.' : `Only read viewers who send a gift you choose, with ${host.ttsPrefix} or in all chat.`}
      actions={<span className={`tag ${picked.length > 0 ? 'amber' : ''}`}>{picked.length > 0 ? 'Gifters only' : 'Anyone can be read'}</span>}
    >
      <fieldset className="stack" disabled={host.ttsMode === 'off'}>
        {picked.length > 0 && (
          <ul className="unlock-gifts">
            {picked.map((name) => {
              const gift = findGift(gifts, name);
              return (
                <li key={name}>
                  {gift?.image && <img src={gift.image} alt="" referrerPolicy="no-referrer" />}
                  {gift?.name ?? name}
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remove ${name}`} onClick={() => toggle(name)}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div>
          <button type="button" className={`btn ${choosing ? '' : 'btn-primary'}`} aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
            {!choosing && <Icon name="gift" />}
            {choosing ? 'Done' : picked.length > 0 ? 'Change gifts' : 'Choose gifts'}
          </button>
        </div>
        {choosing && <GiftPicker gifts={gifts} picked={picked} onPick={toggle} />}
        {picked.length > 0 && (
          <label className="field">
            Minutes each gift unlocks
            <span className="hint">0 for the rest of the stream. More gifts add more time.</span>
            <NumberCell value={host.ttsUnlockMinutes} min={0} max={1440} onSave={(ttsUnlockMinutes) => save({ ttsUnlockMinutes })} />
          </label>
        )}
      </fieldset>
    </Card>
  );
}
