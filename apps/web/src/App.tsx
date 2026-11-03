import { useEffect } from 'react';
import { api } from './api.ts';
import { resolveRoute, useLoad, useRoute, useToast, type SettingsTab } from './hooks.ts';
import { Shell } from './components/Shell.tsx';
import { Home } from './pages/Home.tsx';
import { Campaign } from './pages/Campaign.tsx';
import { Library } from './pages/Library.tsx';
import { Settings } from './pages/Settings.tsx';
import { Voice } from './pages/Voice.tsx';
import { Learning } from './pages/Learning.tsx';
import { Trending } from './pages/Trending.tsx';
import { Calendar } from './pages/Calendar.tsx';

export function App() {
  const raw = useRoute();
  const route = resolveRoute(raw);
  const status = useLoad(() => api.status(), [], 10000);
  const services = useLoad(() => api.services(), [], 10000);
  const campaigns = useLoad(() => api.campaigns(), [route.join('/')], 6000);
  const toastMsg = useToast();
  const live = !!campaigns.data?.some((c) => c.steps.some((s) => s.status === 'running' || s.status === 'queued'));
  const ready = !!status.data?.claude.loggedIn && !!services.data?.every((s) => s.ok);
  const place = route[0] === 'c' ? 'library' : route[0];

  // Old links (#/setup, #/trending…) land on the canonical address so the sidebar and back button agree.
  useEffect(() => {
    if (raw.join('/') !== route.join('/')) location.replace(`#/${route.join('/')}`);
  }, [raw.join('/')]);
  useEffect(() => {
    document.title = route[0] === 'c' ? 'Shipcast' : `${{ new: 'Create', calendar: 'Calendar', library: 'Library', ideas: 'Ideas', brand: 'Brand', insights: 'Insights', settings: 'Settings' }[place] ?? 'Shipcast'} · Shipcast`;
  }, [place]);

  return (
    <Shell place={place} status={{ checked: !!status.data && !!services.data, ready, working: live }} onSearch={() => {}}>
      {route[0] === 'c' && route[1] ? (
        <Campaign id={route[1]} />
      ) : route[0] === 'library' ? (
        <Library campaigns={campaigns.data} />
      ) : route[0] === 'calendar' ? (
        <Calendar />
      ) : route[0] === 'brand' ? (
        <Voice />
      ) : route[0] === 'ideas' ? (
        <Trending />
      ) : route[0] === 'insights' ? (
        <Learning />
      ) : route[0] === 'settings' ? (
        <Settings tab={route[1] as SettingsTab} status={status.data} onChange={status.reload} />
      ) : (
        <Home status={status.data} services={services.data} campaigns={campaigns.data} />
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Shell>
  );
}
