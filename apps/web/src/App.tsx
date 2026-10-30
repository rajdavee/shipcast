import { api } from './api.ts';
import { useLoad, useRoute, useToast } from './hooks.ts';
import { Mark } from './components/icons.tsx';
import { NewCampaign } from './pages/NewCampaign.tsx';
import { Campaigns } from './pages/Campaigns.tsx';
import { CampaignView } from './pages/CampaignView.tsx';
import { Connect } from './pages/Connect.tsx';
import { Packs } from './pages/Packs.tsx';
import { SettingsPage } from './pages/Settings.tsx';

export function App() {
  const route = useRoute();
  const status = useLoad(() => api.status(), [], 8000);
  const campaigns = useLoad(() => api.campaigns(), [route[0]], 5000);
  const toastMsg = useToast();
  const live = campaigns.data?.some((c) => c.steps.some((s) => s.status === 'running'));
  const s = status.data;

  const nav = [
    ['new', 'New campaign', null],
    ['campaigns', 'Campaigns', campaigns.data?.length || null],
    ['packs', 'Formats', null],
    ['connect', 'Connections', null],
    ['settings', 'Settings', null],
  ] as const;
  const current = route[0] === 'c' ? 'campaigns' : route[0];

  let page;
  switch (route[0]) {
    case 'campaigns':
      page = <Campaigns campaigns={campaigns.data} />;
      break;
    case 'c':
      page = <CampaignView id={route[1]} />;
      break;
    case 'connect':
      page = <Connect status={s} onChange={status.reload} />;
      break;
    case 'packs':
      page = <Packs />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    default:
      page = <NewCampaign status={s} />;
  }

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <a className="brand" href="#/new">
          <Mark />
          <span className="brand-word">Shipcast</span>
        </a>
        {nav.map(([key, label, count]) => (
          <a key={key} className="nav-link" href={`#/${key}`} aria-current={current === key ? 'page' : undefined}>
            {label}
            {count ? <span className="nav-count tnum">{count}</span> : null}
          </a>
        ))}
        <div className="rail-foot">
          {live && (
            <a className="signal" href="#/campaigns">
              <i className="lamp live" />
              <span><b>Rendering now</b></span>
            </a>
          )}
          <a className="signal" href="#/connect" title={s?.claude.account ?? ''}>
            <i className={`lamp ${s ? (s.claude.loggedIn ? 'on' : 'off') : ''}`} />
            <span>Claude {s?.claude.loggedIn ? <b>connected</b> : 'not connected'}</span>
          </a>
          <a className="signal" href="#/connect">
            <i className={`lamp ${s ? (s.github.loggedIn ? 'on' : '') : ''}`} />
            <span>GitHub {s?.github.loggedIn ? <b>@{s.github.login}</b> : 'optional'}</span>
          </a>
        </div>
      </nav>
      <main className="main">{page}</main>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
