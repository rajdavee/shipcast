import { api } from './api.ts';
import { useLoad, useRoute, useToast } from './hooks.ts';
import { Mark } from './components/icons.tsx';
import { Home } from './pages/Home.tsx';
import { Campaign } from './pages/Campaign.tsx';
import { Library } from './pages/Library.tsx';
import { Setup } from './pages/Setup.tsx';

export function App() {
  const route = useRoute();
  const status = useLoad(() => api.status(), [], 10000);
  const services = useLoad(() => api.services(), [], 10000);
  const campaigns = useLoad(() => api.campaigns(), [route.join('/')], 6000);
  const toastMsg = useToast();
  const live = campaigns.data?.some((c) => c.steps.some((s) => s.status === 'running' || s.status === 'queued'));
  const ready = !!status.data?.claude.loggedIn && !!services.data?.every((s) => s.ok);
  const page = route[0] === 'c' ? 'library' : route[0];

  return (
    <>
      <header className="top">
        <a className="logo" href="#/new" aria-label="Shipcast home">
          <Mark className="" />
          <span className="wordmark-text">Shipcast</span>
        </a>
        <nav className="tabs-top" aria-label="Main">
          <a href="#/new" aria-current={page === 'new' ? 'page' : undefined}>Create</a>
          <a href="#/library" aria-current={page === 'library' ? 'page' : undefined}>Library</a>
          <a href="#/setup" aria-current={page === 'setup' ? 'page' : undefined}>Setup</a>
        </nav>
        <div className="top-right">
          {live && (
            <a className="pill-status" href="#/library">
              <i className="dot live" />
              <span className="lbl">Working</span>
            </a>
          )}
          <a className="pill-status" href="#/setup" title={ready ? 'Everything is connected' : 'Finish setup'}>
            <i className={`dot ${status.data && services.data ? (ready ? 'ok' : 'bad') : ''}`} />
            <span className="lbl">{!status.data || !services.data ? 'Checking…' : ready ? 'Ready' : 'Finish setup'}</span>
          </a>
        </div>
      </header>
      {route[0] === 'c' && route[1] ? (
        <Campaign id={route[1]} />
      ) : route[0] === 'library' ? (
        <Library campaigns={campaigns.data} />
      ) : route[0] === 'setup' ? (
        <Setup status={status.data} onChange={status.reload} />
      ) : (
        <Home status={status.data} services={services.data} campaigns={campaigns.data} />
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </>
  );
}
