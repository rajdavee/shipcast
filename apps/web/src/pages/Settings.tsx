import { useEffect, useState } from 'react';
import { api, type Settings } from '../api.ts';
import { toast } from '../hooks.ts';

const MODELS = [
  ['', 'Claude Code default'],
  ['opus', 'Opus — best quality'],
  ['sonnet', 'Sonnet — faster, lighter on usage'],
  ['haiku', 'Haiku — copy and quick drafts'],
];

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => void api.settings().then(setS), []);
  if (!s) return null;
  const save = async (patch: Partial<Settings>) => {
    setS(await api.saveSettings(patch));
    toast('Settings saved');
  };
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="lede">Stored in ~/.shipcast/settings.json. Each deliverable is one Claude Code session; campaigns run one step at a time.</p>
        </div>
      </div>
      <div className="inspect-card" style={{ display: 'grid', gap: 20 }}>
        <div className="field" role="group" aria-label="Model">
          <span>Model</span>
          <div className="seg">
            {MODELS.map(([v, label]) => (
              <button key={v} aria-pressed={s.model === v} onClick={() => save({ model: v })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="field" role="group" aria-label="Sub-agents">
          <span>Parallel frame workers</span>
          <div className="seg">
            <button aria-pressed={s.subagents === 'pack'} onClick={() => save({ subagents: 'pack' })}>When the format needs them</button>
            <button aria-pressed={s.subagents === 'never'} onClick={() => save({ subagents: 'never' })}>Never</button>
          </div>
          <p className="hint">The HyperFrames video formats build frames with helper agents. "Never" saves usage but makes long videos slower.</p>
        </div>
        <label className="field">
          <span>Time limit per deliverable (minutes)</span>
          <input className="input" type="number" min={5} max={240} value={s.stepTimeoutMinutes} onChange={(e) => setS({ ...s, stepTimeoutMinutes: Number(e.target.value) })} onBlur={() => save({ stepTimeoutMinutes: s.stepTimeoutMinutes })} style={{ maxWidth: 140 }} />
        </label>
        <label className="field">
          <span>Tools Claude may use without asking</span>
          <input className="input" value={s.allowedTools.join(', ')} onChange={(e) => setS({ ...s, allowedTools: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} onBlur={() => save({ allowedTools: s.allowedTools })} />
          <p className="hint">Rendering needs Bash, Write and Read. Remove WebFetch/WebSearch to keep runs offline (website sources will stop working).</p>
        </label>
      </div>
    </div>
  );
}
