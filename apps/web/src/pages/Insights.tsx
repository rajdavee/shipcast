import { PageHeader } from '../components/ui.tsx';
import { Learning } from './Learning.tsx';
import { PerformanceInsights } from './PerformanceInsights.tsx';

const TABS = [
  { id: 'performance', label: 'Performance' },
  { id: 'quality', label: 'Quality & learning' },
] as const;

/** Insights: how posts did and what works for this brand (Performance), and Shipcast's own quality loop. */
export function Insights({ tab }: { tab?: string }) {
  const t = tab === 'quality' ? 'quality' : 'performance';
  return (
    <main className="page insights">
      <PageHeader title="Insights" description="How your posts did against your usual, what works for you and why — and what Shipcast learned from its own runs." />
      <nav className="tabs" aria-label="Insights sections">
        {TABS.map((x) => <a key={x.id} href={`#/insights/${x.id}`} aria-current={t === x.id ? 'page' : undefined}>{x.label}</a>)}
      </nav>
      {t === 'performance' ? <PerformanceInsights /> : <Learning />}
    </main>
  );
}
