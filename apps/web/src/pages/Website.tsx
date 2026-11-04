import { useEffect, useState } from 'react';
import { api, type SiteState } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';
import { askFor } from '../auth-model.ts';
import { ago } from '../reports-model.ts';
import { useAccess } from '../session.ts';
import { AskAdmin, Loading } from '../components/ui.tsx';

/** Settings → Website: a read-only Google connection for visits, signups and search, and link tagging. */
export function Website() {
  const a = useAccess();
  const c = useLoad(() => api.publish.connections());
  const site = useLoad(() => api.site.status());
  const g = c.data?.google;
  const connected = !!g?.connected || !!site.data?.connected;
  const choices = useLoad(() => (connected && a.manage ? api.site.choices() : Promise.resolve(null)), [connected, a.manage]);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const redirect = `${location.origin}/oauth/google/callback`;

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => (c.reload(), site.reload()), 3000);
    const stop = setTimeout(() => setWaiting(false), 5 * 60_000);
    return () => (clearInterval(t), clearTimeout(stop));
  }, [waiting]);
  useEffect(() => {
    if (waiting && connected) {
      setWaiting(false);
      toast('Google connected — pick your property and site');
    }
  }, [connected, waiting]);

  const act = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = (patch: Parameters<typeof api.site.save>[0], done?: string) => act('save', async () => site.setData(await api.site.save(patch)), done);

  if (site.error) return <div className="banner" role="alert">Couldn't load website settings: {site.error}</div>;
  if (!site.data || !c.data) return <Loading />;
  const s: SiteState = { ...site.data, domains: site.data.domains ?? [] };
  const props = choices.data && Array.isArray(choices.data.properties) ? choices.data.properties : null;
  const sites = choices.data && Array.isArray(choices.data.sites) ? choices.data.sites : null;
  const propErr = choices.data && !Array.isArray(choices.data.properties) ? choices.data.properties.error : null;
  const siteErr = choices.data && !Array.isArray(choices.data.sites) ? choices.data.sites.error : null;
  const addDomain = () => {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!d) return;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return toast('Type a domain like example.com');
    setDomain('');
    if (!s.domains.includes(d)) save({ domains: [...s.domains, d] });
  };

  return (
    <>
      <section className="setup-section">
        <h2>Website numbers</h2>
        <p>Reports can show visits, signups and search clicks from your site, and which post brought them. Shipcast only reads (Google Analytics and Search Console); nothing is changed in your Google account.</p>
        {!a.manage && <p className="role-note">{askFor(a, 'manage')} You can see these settings but not change them.</p>}
        <div className="rows">
          <div className="srow">
            <i className={`dot ${connected ? 'ok' : ''}`} />
            <div>
              <h3>Google Analytics and Search Console</h3>
              {!g ? (
                <p>Connections are checking…</p>
              ) : connected ? (
                <p>Connected (read-only). {g.note}</p>
              ) : g.configured ? (
                <p>Uses the same Google app as your YouTube connection. Connect and allow read-only access to Analytics and Search Console.</p>
              ) : (
                <>
                  <p>This uses the same Google app as YouTube. Set up the YouTube app keys first in <a href="#/settings/connections">Settings → Connections → Publishing</a>, then come back here.</p>
                  <p>In that Google Cloud app, add this redirect URL: <code>{redirect}</code>, and enable the <b>Google Analytics Data API</b>, <b>Google Analytics Admin API</b> and <b>Search Console API</b>.</p>
                </>
              )}
              {g?.configured && !connected && <p className="hint">If Google says the redirect doesn't match, add <code>{redirect}</code> to the app's authorised redirect URIs.</p>}
            </div>
            {!a.manage ? (
              <AskAdmin />
            ) : connected ? (
              <button className="btn ghost" disabled={busy === 'disc'} onClick={() => act('disc', async () => { await api.publish.disconnect('google'); await Promise.all([c.reload(), site.reload()]); }, 'Google disconnected')}>Disconnect</button>
            ) : g?.configured ? (
              <button className="btn primary" disabled={busy === 'conn'} onClick={() => act('conn', async () => { const r = await api.publish.connect('google'); window.open(r.url, '_blank', 'noopener'); setWaiting(true); })}>{waiting ? 'Waiting for sign-in…' : 'Connect Google'}</button>
            ) : (
              <a className="btn" href="#/settings/connections">Set up the Google app</a>
            )}
          </div>

          {connected && (
            <>
              <div className="srow">
                <i className={`dot ${s.ga4Property ? 'ok' : ''}`} />
                <div>
                  <h3>Analytics property</h3>
                  <p>{propErr ? `Couldn't list properties: ${propErr}` : s.ga4Property ? `Reading ${s.ga4Name || s.ga4Property}.` : 'Pick the GA4 property for your site.'}</p>
                </div>
                {a.manage ? (
                  <select className="select site-pick" aria-label="Google Analytics property" value={s.ga4Property ?? ''} disabled={!props || busy === 'save'}
                    onChange={(e) => { const p = props?.find((x) => x.id === e.target.value); save({ ga4Property: e.target.value, ga4Name: p?.name ?? '' }, 'Analytics property saved'); }}>
                    <option value="">{props ? (props.length ? 'Choose a property…' : 'No properties found') : choices.error ? 'Couldn’t load' : 'Loading…'}</option>
                    {props?.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.account}</option>)}
                  </select>
                ) : <span className="hint">{s.ga4Name || '—'}</span>}
              </div>
              <div className="srow">
                <i className={`dot ${s.gscSite ? 'ok' : ''}`} />
                <div>
                  <h3>Search Console site</h3>
                  <p>{siteErr ? `Couldn't list sites: ${siteErr}` : s.gscSite ? `Reading ${s.gscSite.replace(/^sc-domain:/, '')}.` : 'Pick the site whose search clicks the report shows.'}</p>
                </div>
                {a.manage ? (
                  <select className="select site-pick" aria-label="Search Console site" value={s.gscSite ?? ''} disabled={!sites || busy === 'save'} onChange={(e) => save({ gscSite: e.target.value }, 'Search Console site saved')}>
                    <option value="">{sites ? (sites.length ? 'Choose a site…' : 'No sites found') : choices.error ? 'Couldn’t load' : 'Loading…'}</option>
                    {sites?.map((x) => <option key={x.id} value={x.id}>{x.id.replace(/^sc-domain:/, 'Domain: ')}</option>)}
                  </select>
                ) : <span className="hint">{s.gscSite ?? '—'}</span>}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="setup-section">
        <h2>Your links</h2>
        <p>So a report can say “Tuesday’s carousel sent 214 visits and 9 signups”.</p>
        <div className="rows">
          <div className="srow">
            <i className={`dot ${s.utm ? 'ok' : ''}`} />
            <div>
              <h3>Tag my links (UTM)</h3>
              <p>Links to your own domains get <code>utm_source</code>, <code>utm_medium</code> and <code>utm_campaign</code> added when a post goes out, so Analytics can credit visits to the post.</p>
            </div>
            <label className="switch"><input type="checkbox" checked={s.utm} disabled={!a.manage || busy === 'save'} onChange={(e) => save({ utm: e.target.checked }, e.target.checked ? 'Links will be tagged' : 'Links won’t be tagged')} /> Tag</label>
          </div>
          <div className="srow site-domains">
            <i className={`dot ${s.domains.length ? 'ok' : ''}`} />
            <div>
              <h3>Your domains</h3>
              <p>Only links to these (and their subdomains) are tagged.</p>
              <div className="tag-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
                {s.domains.map((d) => (
                  <span key={d} className="hashtag">{d}{a.manage && <button aria-label={`Remove ${d}`} onClick={() => save({ domains: s.domains.filter((x) => x !== d) })}>×</button>}</span>
                ))}
                {a.manage && <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={s.domains.length ? 'Add another' : 'example.com'} aria-label="Add a domain" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addDomain(); } else if (e.key === 'Backspace' && !domain && s.domains.length) save({ domains: s.domains.slice(0, -1) }); }} onBlur={addDomain} />}
                {!a.manage && !s.domains.length && <span className="muted">None yet</span>}
              </div>
            </div>
            <span />
          </div>
        </div>
      </section>

      <section className="setup-section">
        <h2>Sync</h2>
        <p>Website numbers are read every six hours and kept on this computer, so reports never wait on Google.</p>
        <div className="rows">
          <div className="srow">
            <i className={`dot ${s.lastError ? 'bad' : s.days ? 'ok' : ''}`} />
            <div>
              <h3>{s.lastSync ? `Last synced ${ago(s.lastSync)}` : 'Not synced yet'}</h3>
              <p>
                {s.days ? `${s.days} days cached${s.firstDay && s.lastDay ? ` (${s.firstDay} to ${s.lastDay})` : ''}.` : 'No days cached yet.'}
                {s.lastError && <><br /><span className="down-text">Last error: {s.lastError}</span></>}
              </p>
            </div>
            {a.manage ? (
              <button className="btn" disabled={!connected || (!s.ga4Property && !s.gscSite) || busy === 'sync'} onClick={() => act('sync', async () => { const r = await api.site.sync(); await site.reload(); toast(`Synced ${r.days} days`); })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            ) : <AskAdmin />}
          </div>
        </div>
      </section>
    </>
  );
}
