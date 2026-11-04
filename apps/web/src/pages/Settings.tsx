import { useEffect, useState } from 'react';
import { api, type AgentsState, type LoginState, type Settings, type Status, type StockProvider } from '../api.ts';
import { toast, useLoad, type SettingsTab } from '../hooks.ts';
import { AskAdmin, PageHeader } from '../components/ui.tsx';
import { askFor } from '../auth-model.ts';
import { useAccess } from '../session.ts';
import { Members } from './Members.tsx';
import { Skills } from './Skills.tsx';

const NAMES: Record<string, string> = { render: 'Video renderer', stills: 'Image & PDF renderer', media: 'Voice, captions & music', qa: 'Quality checks' };

const TABS: [SettingsTab, string][] = [
  ['connections', 'Connections'],
  ['generation', 'Generation'],
  ['agents', 'Agents'],
  ['members', 'Members'],
  ['skills', 'Skills'],
];

/** Everything that used to be Setup and Skills, one tab per concern; the tab lives in the hash (#/settings/agents). */
export function Settings({ tab, status, onChange }: { tab: SettingsTab; status: Status | null; onChange: () => void }) {
  const a = useAccess();
  // Skills are installed for the whole machine, so only the person who set Shipcast up sees them.
  const tabs = TABS.filter(([id]) => id !== 'skills' || a.install);
  return (
    <main className="page settings-page">
      <PageHeader title="Settings" description={<>For <b>{a.workspace?.name ?? 'this workspace'}</b>. Connections, keys and preferences belong to this workspace and stay on this computer.</>} />
      <nav className="tabs" aria-label="Settings sections">
        {tabs.map(([id, label]) => (
          <a key={id} href={`#/settings/${id}`} aria-current={tab === id ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <div className="tab-panel">
        {tab === 'generation' ? <Generation /> : tab === 'agents' ? <AgentsSection /> : tab === 'members' ? <Members /> : tab === 'skills' ? (a.install ? <Skills /> : <MachineNote />) : <Connections status={status} onChange={onChange} />}
      </div>
    </main>
  );
}

/** Why machine-wide settings are missing for everyone but the install owner. */
function MachineNote() {
  return <p className="role-note">Skills, installs and this computer's own Claude and GitHub sign-in are shared by everyone on this Shipcast, so only the person who set it up changes them.</p>;
}

/** Above a section the role can see but not change. */
function RoleNote({ need }: { need: 'write' | 'manage' }) {
  const a = useAccess();
  if (need === 'manage' ? a.manage : a.write) return null;
  return <p className="role-note">{askFor(a, need)} You can see these settings but not change them.</p>;
}

function Connections({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const checks = useLoad(() => api.doctor());
  const services = useLoad(() => api.services(), [], 5000);
  const [claudeLogin, setClaudeLogin] = useState<LoginState | null>(null);
  const [ghLogin, setGhLogin] = useState<LoginState | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixLog, setFixLog] = useState<string | null>(null);

  useEffect(() => {
    if (!claudeLogin?.running && !ghLogin?.running) return;
    const t = setInterval(async () => {
      const s = await api.status();
      setClaudeLogin(s.logins.claude);
      setGhLogin(s.logins.github);
      onChange();
      if (!s.logins.claude?.running && !s.logins.github?.running) checks.reload();
    }, 2000);
    return () => clearInterval(t);
  }, [claudeLogin?.running, ghLogin?.running]);

  async function fix(id: string, label: string) {
    setFixing(id);
    setFixLog(null);
    try {
      const r = await api.setup(id);
      toast(r.ok ? `${label} is ready` : `${label} setup failed`);
      if (!r.ok) setFixLog(r.log);
      checks.reload();
      services.reload();
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setFixing(null);
    }
  }

  const a = useAccess();
  const c = status?.claude;
  const g = status?.github;
  const tools = (checks.data ?? []).filter((k) => !['claude', 'gh', 'node'].includes(k.id));

  return (
    <>
      {!a.install ? (
        <section className="setup-section">
          <h2>Your Claude</h2>
          <p>What you make runs on your own Claude account, connected on your Account page.</p>
          <div className="rows">
            <div className="srow">
              <i className={`dot ${c?.loggedIn ? 'ok' : 'bad'}`} />
              <div>
                <h3>Claude</h3>
                <p>{!c ? 'Checking…' : c.loggedIn ? `Connected with your ${c.method === 'Anthropic API key' ? 'API key' : 'Claude token'}.` : 'Not connected yet.'}</p>
              </div>
              <a className={`btn${c?.loggedIn ? '' : ' primary'}`} href="#/account/claude">{c?.loggedIn ? 'Manage' : 'Connect'}</a>
            </div>
          </div>
          <MachineNote />
        </section>
      ) : (
      <section className="setup-section">
        <h2>Accounts</h2>
        <p>Claude does the thinking. GitHub is only needed for private repos and pull-request videos.</p>
        <div className="rows">
          <div className="srow">
            <i className={`dot ${c?.loggedIn ? 'ok' : 'bad'}`} />
            <div>
              <h3>Claude</h3>
              <p>{!c ? 'Checking…' : !c.installed ? 'Claude Code is not installed on this computer.' : c.loggedIn ? `Connected${c.account ? ` as ${c.account}` : ''}. Runs use your Claude plan.` : 'Installed, but not signed in.'}</p>
            </div>
            {c && !c.installed ? (
              <a className="btn" href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noreferrer">Install</a>
            ) : c && !c.loggedIn ? (
              <button className="btn primary" disabled={claudeLogin?.running} onClick={async () => setClaudeLogin(await api.connectClaude())}>{claudeLogin?.running ? 'Waiting for browser…' : 'Sign in'}</button>
            ) : (
              <span className="hint">Connected</span>
            )}
            {claudeLogin?.running && claudeLogin.url && (
              <div className="device-code">Your browser should open. If not, <a href={claudeLogin.url} target="_blank" rel="noreferrer">open the sign-in page</a>.</div>
            )}
          </div>
          <div className="srow">
            <i className={`dot ${g?.loggedIn ? 'ok' : ''}`} />
            <div>
              <h3>GitHub <span className="muted" style={{ fontWeight: 500 }}>· optional</span></h3>
              <p>{!g ? 'Checking…' : !g.installed ? 'Public repos work without it. Install the GitHub app for private repos.' : g.loggedIn ? `Connected as @${g.login}.` : 'Sign in to use private repos.'}</p>
            </div>
            {g && !g.installed ? (
              <a className="btn" href="https://cli.github.com" target="_blank" rel="noreferrer">Install</a>
            ) : g && !g.loggedIn ? (
              <button className="btn" disabled={ghLogin?.running} onClick={async () => setGhLogin(await api.connectGithub())}>{ghLogin?.running ? 'Waiting…' : 'Connect'}</button>
            ) : (
              <span className="hint">{g ? 'Connected' : ''}</span>
            )}
            {ghLogin?.running && ghLogin.code && (
              <div className="device-code">
                <code>{ghLogin.code}</code>
                <span>Enter this code at <a href={ghLogin.url} target="_blank" rel="noreferrer">github.com/login/device</a></span>
                <button className="btn sm" onClick={() => navigator.clipboard.writeText(ghLogin.code!)}>Copy</button>
              </div>
            )}
          </div>
        </div>
      </section>
      )}

      <PublishingSection />

      <VoiceSection />

      <BrollSection />
      <EnginesSection />

      <section className="setup-section">
        <h2>On this computer</h2>
        <p>Everything renders locally — nothing is uploaded anywhere.</p>
        <div className="rows">
          {(services.data ?? []).map((s) => (
            <div key={s.name} className="srow">
              <i className={`dot ${s.ok ? 'ok' : 'bad'}`} />
              <div>
                <h3>{NAMES[s.name] ?? s.name}</h3>
                <p>{s.ok ? (s.running ? 'Working right now' : 'Running') : 'Not running — start Shipcast with npm start'}{s.voice ? ` · voice: ${s.voice === 'kokoro' ? 'natural (Kokoro)' : 'system fallback'}` : ''}</p>
              </div>
              <span />
            </div>
          ))}
          {tools.map((k) => (
            <div key={k.id} className="srow">
              <i className={`dot ${k.ok ? 'ok' : k.required ? 'bad' : ''}`} />
              <div>
                <h3>{k.label.replace(' (voiceover)', '').replace(' (captions)', '')}{!k.required && <span className="muted" style={{ fontWeight: 500 }}> · optional</span>}</h3>
                <p>{k.ok ? k.detail : k.fix ? k.hint : <>Install with <code>{k.hint}</code></>}</p>
              </div>
              {!k.ok && k.fix && a.install ? (
                <button className="btn sm" disabled={!!fixing} onClick={() => fix(k.fix!, k.label)}>{fixing === k.fix ? 'Setting up…' : 'Set up'}</button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        {fixLog && <div className="doc" style={{ marginTop: 12 }}><pre>{fixLog}</pre></div>}
      </section>
    </>
  );
}

const OAUTH_APPS = [
  { id: 'linkedin' as const, title: 'LinkedIn — your profile', what: 'Posts text, images and PDF carousels to your own profile with your own LinkedIn app (Share on LinkedIn product, no review needed).', where: 'linkedin.com/developers → Create app → Products: Share on LinkedIn, Sign In with OpenID Connect' },
  { id: 'youtube' as const, title: 'YouTube — your channel', what: 'Uploads videos and Shorts with your own Google Cloud project (YouTube Data API v3, OAuth client of type Web).', where: 'console.cloud.google.com → APIs & Services → Credentials' },
];

/** Publishing accounts: direct LinkedIn and YouTube with the user's own app keys, a Postiz instance for the rest, and one switch to pause it all. */
function PublishingSection() {
  const c = useLoad(() => api.publish.connections());
  const s = useLoad(() => api.settings());
  const pz = useLoad(() => (c.data?.postiz.configured ? api.publish.postizIntegrations() : Promise.resolve([])), [c.data?.postiz.configured]);
  const [form, setForm] = useState<Record<string, { a: string; b: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const redirect = (id: string) => `${location.origin}/oauth/${id}/callback`;
  // After Connect opens the sign-in tab, check back until the connection shows up.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => c.reload(), 3000);
    const stop = setTimeout(() => setWaiting(null), 5 * 60_000);
    return () => (clearInterval(t), clearTimeout(stop));
  }, [waiting]);
  useEffect(() => {
    if (waiting && c.data?.[waiting as 'linkedin' | 'youtube']?.connected) {
      toast(`${waiting === 'linkedin' ? 'LinkedIn' : 'YouTube'} connected`);
      setWaiting(null);
    }
  }, [c.data, waiting]);
  const act = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await fn();
      await c.reload();
      if (done) toast(done);
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };
  const field = (id: string) => form[id] ?? { a: '', b: '' };
  const setField = (id: string, k: 'a' | 'b', v: string) => setForm((f) => ({ ...f, [id]: { ...field(id), [k]: v } }));
  const paused = !!s.data?.publishingPaused;
  const metricsPaused = !!s.data?.metricsPaused;
  const ytReconnect = !!c.data?.youtube.stats?.needsReconnect;
  const a = useAccess();

  return (
    <section className="setup-section">
      <h2>Publishing</h2>
      <p>How calendar posts go out. Without a connection every channel still works as a ready-to-post kit with a reminder. Keys and tokens stay on this computer and are never shown again.</p>
      <RoleNote need="manage" />
      <div className="rows">
        <div className="srow">
          <i className={`dot ${paused ? 'bad' : 'ok'}`} />
          <div>
            <h3>Pause all publishing</h3>
            <p>{paused ? 'Paused — nothing is sent, even scheduled posts. Reminders for manual posts still show.' : 'Scheduled posts go out at their time.'}</p>
          </div>
          <label className="switch"><input type="checkbox" checked={paused} disabled={!s.data || !a.manage} onChange={async (e) => { s.setData(await api.saveSettings({ publishingPaused: e.target.checked })); toast(e.target.checked ? 'Publishing paused' : 'Publishing resumed'); }} /> Pause</label>
        </div>
        <div className="srow">
          <i className={`dot ${metricsPaused ? 'bad' : 'ok'}`} />
          <div>
            <h3>Pause collecting numbers</h3>
            <p>{metricsPaused ? 'Paused — no stats are read from YouTube or Postiz, and no reminders ask for numbers. Numbers you add yourself still count.' : 'After a post goes out, its numbers are read at 1, 3, 7 and 30 days where a connection can, and you get a reminder where none can.'}</p>
          </div>
          <label className="switch"><input type="checkbox" checked={metricsPaused} disabled={!s.data || !a.manage} onChange={async (e) => { s.setData(await api.saveSettings({ metricsPaused: e.target.checked })); toast(e.target.checked ? 'Collecting numbers paused' : 'Collecting numbers resumed'); }} /> Pause</label>
        </div>
        {OAUTH_APPS.map((app) => {
          const st = c.data?.[app.id];
          const li = app.id === 'linkedin' ? c.data?.linkedin : null;
          const f = field(app.id);
          return (
            <div className="srow" key={app.id}>
              <i className={`dot ${st?.connected ? 'ok' : li?.expired ? 'bad' : ''}`} />
              <div>
                <h3>{app.title}</h3>
                <p>
                  {!st ? 'Checking…' : st.connected ? <>Connected{li?.account ? ` as ${li.account}` : ''}{li?.expiresAt ? ` · until ${new Date(li.expiresAt).toLocaleDateString()}` : ''}.</> : li?.expired ? 'The sign-in expired — connect again.' : st.configured ? 'App keys saved. Connect to sign in.' : <>{app.what} Keys: {app.where}. Redirect URL: <code>{redirect(app.id)}</code></>}
                  {app.id === 'youtube' && c.data && <><br />{c.data.youtube.note}</>}
                </p>
                {app.id === 'youtube' && ytReconnect && st?.connected && (
                  <p className="notice" role="status"><b>Reconnect YouTube to read stats.</b> This sign-in was made before Shipcast could read views and likes back — connect again and allow the new read-only access.</p>
                )}
              </div>
              {!a.manage ? (
                <AskAdmin />
              ) : st?.connected ? (
                <div className="row-actions">
                  {app.id === 'youtube' && ytReconnect && <button className="btn primary" disabled={busy === app.id} onClick={() => act(app.id, async () => { const r = await api.publish.connect(app.id); window.open(r.url, '_blank', 'noopener'); addEventListener('focus', () => c.reload(), { once: true }); }, 'Finish signing in in the new tab')}>Reconnect</button>}
                  <button className="btn ghost" disabled={busy === app.id} onClick={() => act(app.id, () => api.publish.disconnect(app.id), 'Disconnected')}>Disconnect</button>
                </div>
              ) : st?.configured ? (
                <div className="row-actions">
                  <button className="btn primary" disabled={busy === app.id} onClick={() => act(app.id, async () => { const r = await api.publish.connect(app.id); window.open(r.url, '_blank', 'noopener'); setWaiting(app.id); })}>{waiting === app.id ? 'Waiting for sign-in…' : 'Connect'}</button>
                  <button className="btn ghost" disabled={busy === app.id} onClick={() => act(app.id, () => api.publish.disconnect(app.id, true), 'App keys removed')}>Remove keys</button>
                </div>
              ) : (
                <form className="row-actions" onSubmit={(e) => { e.preventDefault(); act(app.id, async () => { await api.publish.saveKeys(app.id, f.a.trim(), f.b.trim()); setForm((x) => ({ ...x, [app.id]: { a: '', b: '' } })); }, 'Keys saved — now Connect'); }}>
                  <input className="input" autoComplete="off" placeholder="Client ID" value={f.a} onChange={(e) => setField(app.id, 'a', e.target.value)} style={{ width: 170 }} aria-label={`${app.title} client ID`} />
                  <input className="input" type="password" autoComplete="off" placeholder="Client secret" value={f.b} onChange={(e) => setField(app.id, 'b', e.target.value)} style={{ width: 170 }} aria-label={`${app.title} client secret`} />
                  <button className="btn primary" disabled={busy === app.id || !f.a.trim() || !f.b.trim()}>Save</button>
                </form>
              )}
            </div>
          );
        })}
        <div className="srow">
          <i className={`dot ${c.data?.postiz.configured ? (pz.error ? 'bad' : 'ok') : ''}`} />
          <div>
            <h3>Postiz — Instagram, TikTok, X and more</h3>
            <p>
              {c.data?.postiz.configured ? (
                <>Connected to <code>{c.data.postiz.url}</code>. {pz.error ? `Can't reach it: ${pz.error}` : pz.data ? (pz.data.length ? `Channels: ${pz.data.filter((i) => !i.disabled).map((i) => `${i.name} (${i.identifier})`).join(', ')}.` : 'No channels added in Postiz yet.') : 'Checking channels…'}</>
              ) : (
                <>Your own Postiz instance posts to 30+ platforms. Address like http://localhost:4007; API key from Postiz → Settings → Public API.</>
              )}
              {c.data && <><br />{c.data.postiz.note}</>}
            </p>
          </div>
          {!a.manage ? (
            <AskAdmin />
          ) : c.data?.postiz.configured ? (
            <button className="btn ghost" disabled={busy === 'postiz'} onClick={() => act('postiz', () => api.publish.disconnect('postiz'), 'Postiz disconnected')}>Disconnect</button>
          ) : (
            <form className="row-actions" onSubmit={(e) => { e.preventDefault(); const f = field('postiz'); act('postiz', async () => { const r = await api.publish.savePostiz(f.a.trim(), f.b.trim()); setForm((x) => ({ ...x, postiz: { a: '', b: '' } })); toast(`Postiz connected — ${r.integrations.length} channel${r.integrations.length === 1 ? '' : 's'}`); }); }}>
              <input className="input" autoComplete="off" placeholder="https://postiz.example.com" value={field('postiz').a} onChange={(e) => setField('postiz', 'a', e.target.value)} style={{ width: 200 }} aria-label="Postiz address" />
              <input className="input" type="password" autoComplete="off" placeholder="API key" value={field('postiz').b} onChange={(e) => setField('postiz', 'b', e.target.value)} style={{ width: 150 }} aria-label="Postiz API key" />
              <button className="btn primary" disabled={busy === 'postiz' || !field('postiz').a.trim() || !field('postiz').b.trim()}>{busy === 'postiz' ? 'Checking…' : 'Connect'}</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/** Model, reviews, time limits and spending caps: how each piece gets made. */
function Generation() {
  const a = useAccess();
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => void api.settings().then(setSettings), []);
  const save = async (patch: Partial<Settings>) => {
    setSettings(await api.saveSettings(patch));
    toast('Saved');
  };
  return (
    <fieldset className="plain-set" disabled={!a.manage}>
      <RoleNote need="manage" />
      {settings && (
        <section className="setup-section">
          <h2>Preferences</h2>
          <p>How Claude directs this workspace's content.</p>
          <div className="rows">
            <div className="srow">
              <span />
              <div>
                <h3>Quality vs. speed</h3>
                <p>Which Claude model directs your content.</p>
              </div>
              <select className="select" style={{ width: 230 }} value={settings.model} onChange={(e) => save({ model: e.target.value })}>
                <option value="">Your Claude Code default</option>
                <option value="opus">Best quality (Opus)</option>
                <option value="sonnet">Faster, lighter (Sonnet)</option>
              </select>
            </div>
            <div className="srow">
              <span />
              <div>
                <h3>Final review for videos</h3>
                <p>Claude watches the finished video once and fixes what an editor would. One short extra step.</p>
              </div>
              <div className="seg">
                <button aria-pressed={settings.directorReview} onClick={() => save({ directorReview: true })}>On</button>
                <button aria-pressed={!settings.directorReview} onClick={() => save({ directorReview: false })}>Off</button>
              </div>
            </div>
            <div className="srow">
              <span />
              <div>
                <h3>Final review for everything else</h3>
                <p>A critic scores each carousel, deck, document, ad, email and page at full size, and the weakest thing gets fixed before you see it.</p>
              </div>
              <div className="seg">
                <button aria-pressed={settings.criticReview !== false} onClick={() => save({ criticReview: true })}>On</button>
                <button aria-pressed={settings.criticReview === false} onClick={() => save({ criticReview: false })}>Off</button>
              </div>
            </div>
            <div className="srow">
              <span />
              <div>
                <h3>Helper agents for experimental formats</h3>
                <p>Some experimental formats build frames in parallel. Off saves usage.</p>
              </div>
              <div className="seg">
                <button aria-pressed={settings.subagents === 'pack'} onClick={() => save({ subagents: 'pack' })}>Allow</button>
                <button aria-pressed={settings.subagents === 'never'} onClick={() => save({ subagents: 'never' })}>Off</button>
              </div>
            </div>
            <div className="srow">
              <span />
              <div>
                <h3>Time limit per item</h3>
                <p>Anything taking longer is stopped.</p>
              </div>
              <select className="select" style={{ width: 160 }} value={settings.stepTimeoutMinutes} onChange={(e) => save({ stepTimeoutMinutes: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
          </div>
        </section>
      )}
      <section className="setup-section">
        <h2>Spending caps</h2>
        <p>Only used when a media engine is connected in Connections.</p>
        <GenBudget />
      </section>
    </fieldset>
  );
}

const MODELS: [string, string][] = [
  ['eleven_multilingual_v2', 'Multilingual v2 — best quality'],
  ['eleven_turbo_v2_5', 'Turbo v2.5 — faster, cheaper'],
  ['eleven_flash_v2_5', 'Flash v2.5 — fastest, cheapest'],
];

/** Voiceover engine: free local Kokoro, or the user's own ElevenLabs account. */
function VoiceSection() {
  const v = useLoad(() => api.voice());
  const [installing, setInstalling] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const d = v.data;
  const save = async (b: Parameters<typeof api.saveVoice>[0], msg: string) => {
    setBusy(true);
    try {
      await api.saveVoice(b);
      await v.reload();
      toast(msg);
      setKey('');
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const current = d?.voices?.find((x) => x.id === d.voice);
  const a = useAccess();
  return (
    <section className="setup-section">
      <h2>Voiceover</h2>
      <p>Kokoro runs on this computer for free. Connect your own ElevenLabs account for more natural voices — your key stays on this computer.</p>
      <RoleNote need="manage" />
      <div className="rows">
        <div className="srow">
          <i className={`dot ${d?.provider === 'kokoro' ? 'ok' : ''}`} />
          <div>
            <h3>Kokoro (free, local)</h3>
            <p>{d?.provider === 'kokoro' ? 'In use for every voiceover.' : 'Always available as the fallback.'}</p>
          </div>
          {d && d.provider !== 'kokoro' && a.manage && <button className="btn" disabled={busy} onClick={() => save({ provider: 'kokoro' }, 'Using Kokoro')}>Use Kokoro</button>}
        </div>
        <div className="srow">
          <i className={`dot ${d?.provider === 'chatterbox' ? 'ok' : ''}`} />
          <div>
            <h3>Chatterbox (free, local, more natural)</h3>
            <p>{d?.chatterbox ? (d.provider === 'chatterbox' ? 'In use for every voiceover.' : 'Installed, not in use.') : 'Open-source (MIT) voice that runs on this computer. Installs PyTorch (~2 GB); the first voiceover also downloads the voice model (~1 GB).'}</p>
          </div>
          {!a.manage ? (
            <span />
          ) : d?.chatterbox ? (
            d.provider !== 'chatterbox' && <button className="btn primary" disabled={busy} onClick={() => save({ provider: 'chatterbox' }, 'Using Chatterbox')}>Use it</button>
          ) : !a.install ? (
            <AskAdmin>Installed by whoever set up Shipcast</AskAdmin>
          ) : (
            <button className="btn" disabled={installing} onClick={async () => { setInstalling(true); try { const r = await api.setup('chatterbox'); toast(r.ok ? 'Chatterbox installed' : 'Install failed — see the log in Activity'); if (r.ok) await save({ provider: 'chatterbox' }, 'Using Chatterbox'); } catch (e) { toast(String((e as Error).message)); } finally { setInstalling(false); } }}>{installing ? 'Installing…' : 'Install'}</button>
          )}
        </div>
        <div className="srow">
          <i className={`dot ${d?.connected && d.provider === 'elevenlabs' ? 'ok' : ''}`} />
          <div>
            <h3>ElevenLabs (your account)</h3>
            <p>{d?.connected ? (d.error ? d.error : d.provider === 'elevenlabs' ? `In use · ${current?.name ?? 'pick a voice'}` : 'Connected, not in use') : 'Paste an API key from elevenlabs.io → Profile → API keys.'}</p>
          </div>
          {!a.manage ? (
            <AskAdmin />
          ) : d?.connected ? (
            <div className="row-actions">
              {d.provider !== 'elevenlabs' && <button className="btn primary" disabled={busy} onClick={() => save({ provider: 'elevenlabs' }, 'Using ElevenLabs')}>Use it</button>}
              <button className="btn ghost" disabled={busy} onClick={async () => { await api.disconnectVoice(); await v.reload(); toast('ElevenLabs disconnected'); }}>Disconnect</button>
            </div>
          ) : (
            <form className="row-actions" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save({ apiKey: key.trim() }, 'ElevenLabs connected'); }}>
              <input className="input" type="password" autoComplete="off" placeholder="sk_…" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 220 }} aria-label="ElevenLabs API key" />
              <button className="btn primary" disabled={busy || !key.trim()}>{busy ? 'Checking…' : 'Connect'}</button>
            </form>
          )}
          {a.manage && d?.connected && (d.voices?.length ?? 0) > 0 && (
            <div className="device-code" style={{ background: 'var(--surface-2)' }}>
              <label className="field" style={{ minWidth: 240 }}>
                <span>Voice</span>
                <select className="select" value={d.voice ?? ''} onChange={(e) => save({ voice: e.target.value }, 'Voice saved')}>
                  {d.voices!.map((x) => <option key={x.id} value={x.id}>{x.name}{x.labels?.accent ? ` · ${x.labels.accent}` : ''}{x.labels?.gender ? ` · ${x.labels.gender}` : ''}</option>)}
                </select>
              </label>
              <label className="field" style={{ minWidth: 240 }}>
                <span>Model</span>
                <select className="select" value={d.model ?? MODELS[0][0]} onChange={(e) => save({ model: e.target.value }, 'Model saved')}>
                  {MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              {current?.preview && <audio controls src={current.preview} style={{ height: 36 }} />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const STOCK: { id: StockProvider; title: string; what: string; where: string }[] = [
  { id: 'pixabay', title: 'Pixabay — footage and photos', what: 'Recommended. Free for commercial use, no attribution needed. Used first for B-roll footage.', where: 'pixabay.com/api/docs (log in, the key is on that page)' },
  { id: 'unsplash', title: 'Unsplash — photos', what: 'High-end photography, used first for photos (Pixabay fills in when Unsplash hits its hourly limit). Credits are written next to each video.', where: 'unsplash.com/oauth/applications → Access Key' },
  { id: 'pexels', title: 'Pexels — footage and photos', what: 'Used when Pixabay has nothing for a shot.', where: 'pexels.com/api' },
];

/** Optional stock footage and photos for B-roll scenes, with the user's own free keys. */
function BrollSection() {
  const b = useLoad(() => api.broll());
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const a = useAccess();
  return (
    <section className="setup-section">
      <h2>Stock footage</h2>
      <p>Long videos and stories can use real B-roll and photos. Add a free key — clips download to this computer, and credits are written next to each video. Without one, B-roll scenes become cinematic shots instead.</p>
      <div className="rows">
        {STOCK.map((s) => {
          const on = !!b.data?.providers?.[s.id];
          const key = keys[s.id] ?? '';
          return (
            <div className="srow" key={s.id}>
              <i className={`dot ${on ? 'ok' : ''}`} />
              <div>
                <h3>{s.title}</h3>
                <p>{on ? `Connected — ${s.what}` : `${s.what} Key: ${s.where}`}</p>
              </div>
              {!a.manage ? (
                <AskAdmin />
              ) : on ? (
                <button className="btn ghost" onClick={async () => { await api.disconnectBroll(s.id); await b.reload(); toast(`${s.title.split(' —')[0]} disconnected`); }}>Disconnect</button>
              ) : (
                <form className="row-actions" onSubmit={async (e) => { e.preventDefault(); if (!key.trim()) return; setBusy(s.id); try { await api.saveBroll(s.id, key.trim()); await b.reload(); setKeys((k) => ({ ...k, [s.id]: '' })); toast(`${s.title.split(' —')[0]} connected`); } catch (err) { toast(String((err as Error).message)); } finally { setBusy(null); } }}>
                  <input className="input" type="password" autoComplete="off" placeholder="API key" value={key} onChange={(e) => setKeys((k) => ({ ...k, [s.id]: e.target.value }))} style={{ width: 220 }} aria-label={`${s.title} API key`} />
                  <button className="btn primary" disabled={busy === s.id || !key.trim()}>{busy === s.id ? 'Checking…' : 'Connect'}</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const ENGINES: { id: string; title: string; what: string; where: string }[] = [
  { id: 'fal', title: 'fal.ai — generative video & images', what: 'Any shot no other engine can make: cinematic, painted or anime-style scenes (Wan, Kling, Veo, FLUX). You pay fal per clip.', where: 'fal.ai/dashboard/keys' },
  { id: 'replicate', title: 'Replicate — generative images (and video by model)', what: 'A second catalogue of open models, used when fal isn’t connected.', where: 'replicate.com/account/api-tokens' },
  { id: 'youtube', title: 'YouTube Data API — trend research', what: 'Lets the Trend brief see which recent videos in your niche get views (free, 10,000 units a day).', where: 'console.cloud.google.com → APIs → YouTube Data API v3 → Credentials' },
  { id: 'freesound', title: 'Freesound — sound effects (CC0 only)', what: 'Whooshes, footsteps, magic, crowds — only public-domain sounds are used.', where: 'freesound.org/apiv2/apply' },
];

/** Optional engines for "Anything": generative media and sound effects, with the user's own keys. */
function EnginesSection() {
  const p = useLoad(() => api.providers());
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const a = useAccess();
  return (
    <section className="setup-section">
      <h2>Media engines for “Anything”</h2>
      <p>Optional. With these, Shipcast can make any kind of video — real footage (stock above), generated shots and sound effects. Keys stay on this computer; nothing is generated without one.</p>
      <div className="rows">
        {ENGINES.map((e) => {
          const on = !!p.data?.[e.id]?.connected;
          return (
            <div className="srow" key={e.id}>
              <i className={`dot ${on ? 'ok' : ''}`} />
              <div>
                <h3>{e.title}</h3>
                <p>{on ? 'Connected.' : `${e.what} Key: ${e.where}`}</p>
              </div>
              {!a.manage ? (
                <AskAdmin />
              ) : on ? (
                <button className="btn ghost" onClick={async () => { await api.removeProvider(e.id); await p.reload(); toast(`${e.title.split(' —')[0]} disconnected`); }}>Disconnect</button>
              ) : (
                <form className="row-actions" onSubmit={async (ev) => { ev.preventDefault(); const k = (keys[e.id] ?? '').trim(); if (!k) return; setBusy(e.id); try { await api.saveProvider(e.id, k); await p.reload(); setKeys({ ...keys, [e.id]: '' }); toast('Connected'); } catch (err) { toast(String((err as Error).message)); } finally { setBusy(null); } }}>
                  <input className="input" type="password" autoComplete="off" placeholder="API key" value={keys[e.id] ?? ''} onChange={(ev) => setKeys({ ...keys, [e.id]: ev.target.value })} style={{ width: 220 }} aria-label={`${e.title} key`} />
                  <button className="btn primary" disabled={busy === e.id || !(keys[e.id] ?? '').trim()}>{busy === e.id ? 'Checking…' : 'Connect'}</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Spending caps for generated images and video (the gen service refuses anything over them). */
function GenBudget() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => void api.settings().then(setS), []);
  if (!s) return null;
  const save = async (patch: Partial<Settings>) => {
    setS(await api.saveSettings(patch));
    toast('Saved');
  };
  return (
    <div className="rows">
      <div className="srow">
        <i className="dot ok" />
        <div>
          <h3>Generation budget</h3>
          <p>Generated images and video are paid per use on your own fal.ai or Replicate account. Shipcast plans the cost first and won't go over these caps.</p>
        </div>
        <div className="row-actions">
          <label className="field" style={{ width: 120 }}><span>Per project ($)</span><input className="input" type="number" min={0} step={1} defaultValue={s.genCapPerProject ?? 5} onBlur={(e) => save({ genCapPerProject: Number(e.target.value) })} /></label>
          <label className="field" style={{ width: 120 }}><span>Per month ($)</span><input className="input" type="number" min={0} step={5} defaultValue={s.genCapPerMonth ?? 25} onBlur={(e) => save({ genCapPerMonth: Number(e.target.value) })} /></label>
        </div>
      </div>
    </div>
  );
}

const when = (iso?: string) => {
  if (!iso) return 'never';
  const d = (Date.parse(iso) - Date.now()) / 60_000;
  const a = Math.abs(d);
  const t = a < 1 ? 'now' : a < 60 ? `${Math.round(a)} min` : a < 48 * 60 ? `${Math.round(a / 60)} h` : `${Math.round(a / 1440)} days`;
  return t === 'now' ? 'now' : d > 0 ? `in ${t}` : `${t} ago`;
};
const EVERY = [
  [360, 'every 6 hours'],
  [720, 'every 12 hours'],
  [1440, 'daily'],
  [10080, 'weekly'],
] as const;

function AgentsSection() {
  const [s, setS] = useState<AgentsState | null>(null);
  const load = () => api.agents().then(setS).catch(() => {});
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  const a = useAccess();
  if (!s) return null;
  const save = async (patch: Partial<Settings>) => {
    await api.saveSettings(patch);
    await load();
    toast('Saved');
  };
  return (
    <section className="setup-section">
      <RoleNote need="manage" />
      <h2>Background agents</h2>
      <p>While you're not using Shipcast, these learn from past runs and watch what's working in marketing. They wait until your own campaigns finish, stay out of quiet hours and use at most {s.cap} Claude runs a day ({s.usedToday} used today).</p>
      <div className="rows">
        {s.jobs.map((j) => (
          <div className="srow" key={j.id}>
            <i className={`dot ${j.running ? 'live' : j.enabled ? (j.lastResult && !j.lastResult.ok ? 'bad' : 'ok') : ''}`} />
            <div>
              <h3>{j.title}</h3>
              <p>{j.about}</p>
              <p className="muted" style={{ fontSize: 13 }}>
                {j.running ? 'Running now…' : j.enabled ? `Next ${when(j.nextRun)}${j.waiting ? ` · ${j.waiting}` : ''}` : 'Off'}
                {j.lastRun ? ` · last ${when(j.lastRun)}: ${j.lastResult?.summary ?? ''}` : ''}
              </p>
            </div>
            <div className="row-actions">
              <select className="input" disabled={!a.manage} value={j.every} onChange={async (e) => { await api.setAgent(j.id, { every: Number(e.target.value) }); await load(); }} aria-label={`${j.title} schedule`}>
                {EVERY.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                {!EVERY.some(([m]) => m === j.every) && <option value={j.every}>every {j.every} min</option>}
              </select>
              <button className="btn ghost" disabled={j.running || j.runNow || !a.write} onClick={async () => { await api.runAgent(j.id); await load(); toast('Queued — it starts when nothing else is running'); }}>{j.runNow ? 'Queued' : 'Run now'}</button>
              <label className="switch"><input type="checkbox" checked={j.enabled} disabled={!a.manage} onChange={async (e) => { await api.setAgent(j.id, { enabled: e.target.checked }); await load(); }} /> On</label>
            </div>
          </div>
        ))}
        <div className="srow">
          <i className={`dot ${s.paused ? 'bad' : 'ok'}`} />
          <div>
            <h3>{s.paused ? 'Paused' : 'Schedule'}</h3>
            <p>Quiet hours keep them off while you sleep or present. "Run now" ignores quiet hours.</p>
          </div>
          <fieldset className="plain-set row-actions" disabled={!a.manage}>
            <label className="field" style={{ width: 96 }}><span>Quiet from</span><input className="input" type="time" defaultValue={s.quiet.start} onBlur={(e) => save({ agentsQuietStart: e.target.value })} /></label>
            <label className="field" style={{ width: 96 }}><span>until</span><input className="input" type="time" defaultValue={s.quiet.end} onBlur={(e) => save({ agentsQuietEnd: e.target.value })} /></label>
            <label className="field" style={{ width: 96 }}><span>Runs / day</span><input className="input" type="number" min={0} max={50} defaultValue={s.cap} onBlur={(e) => save({ agentsMaxClaudeRunsPerDay: Number(e.target.value) })} /></label>
            <button className="btn ghost" onClick={() => save({ agentsPaused: !s.paused })}>{s.paused ? 'Resume' : 'Pause all'}</button>
          </fieldset>
        </div>
      </div>
    </section>
  );
}
