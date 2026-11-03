import { fileUrl, type Campaign } from '../api.ts';
import { relTime } from '../formats.ts';

const IMG = /\.(png|jpe?g|webp)$/i;

/** Best still a campaign has made so far, as a path relative to the campaign folder. */
export function coverOf(c: Campaign): string | null {
  // Prefer stills designed to be covers, then landscape video posters, then slides.
  const landscape = (s: { pack?: string; options: Record<string, string> }) => ['launch-film', 'explainer-video'].includes(s.pack ?? '') && !['vertical', 'linkedin-video', 'square-video'].includes(s.options.preset);
  const order: [RegExp, (s: any) => boolean][] = [
    [/youtube-[a-z]\.(jpg|png)$|youtube-thumb\.(jpg|png)$/i, () => true],
    [/og-card\.png$|github-banner\.png$/, () => true],
    [/\/video\.jpg$|^video\.jpg$/, landscape],
    [/slide-01\.png$/, () => true],
    [/(video|captioned)\.jpg$/, () => true],
  ];
  for (const [re, ok] of order)
    for (const s of c.steps)
      if (s.kind === 'pack' && s.status === 'done' && ok(s)) {
        const hit = s.outputs.find((o) => re.test(o));
        if (hit) return `deliverables/${s.id}/${hit}`;
      }
  for (const s of c.steps)
    if (s.kind === 'pack' && s.status === 'done') {
      const hit = s.outputs.find((o) => IMG.test(o) && !o.includes('sheet'));
      if (hit) return `deliverables/${s.id}/${hit}`;
    }
  const brief = c.steps.find((s) => s.kind === 'brief');
  const shot = brief?.outputs.find((o) => /assets\/.*(desktop|hero|home).*\.(png|jpe?g)$/i.test(o)) ?? brief?.outputs.find((o) => /^assets\/.*\.(png|jpe?g)$/i.test(o) && !/favicon|icon|logo/i.test(o));
  return shot ? `brief/${shot}` : null;
}

export function campaignState(c: Campaign): { label: string; live: boolean } {
  const packs = c.steps.filter((s) => s.kind === 'pack');
  const done = packs.filter((s) => s.status === 'done').length;
  const live = c.steps.some((s) => s.status === 'running' || s.status === 'queued');
  const failed = c.steps.filter((s) => s.status === 'failed').length;
  if (live) return { label: `Making · ${done}/${packs.length}`, live };
  if (failed) return { label: `${done} ready · ${failed} failed`, live };
  return { label: `${done} ready`, live };
}

export function CampaignCover({ campaign: c }: { campaign: Campaign }) {
  const cover = coverOf(c);
  const st = campaignState(c);
  return (
    <a className="cover" href={`#/c/${c.id}`}>
      <div className="cover-art">
        {cover ? (
          <img src={fileUrl(c.id, cover)} alt="" loading="lazy" />
        ) : (
          <div className="swatches" aria-hidden="true">
            <i style={{ background: 'var(--surface)' }} />
            <i style={{ background: 'var(--surface-2)' }} />
          </div>
        )}
        <span className="badge">
          {st.live && <i className="dot live" />}
          {st.label}
        </span>
      </div>
      <div>
        <h3>{c.name}</h3>
        <p>{c.source.type === 'text' ? 'From a description' : c.source.value.replace(/^https?:\/\//, '')} · {relTime(c.createdAt)}</p>
      </div>
    </a>
  );
}
