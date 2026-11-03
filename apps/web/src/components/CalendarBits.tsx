import { fileUrl } from '../api.ts';
import { projectFile, STATUS_LABEL, type ChannelId, type ChannelInfo, type PostStatus } from '../calendar-model.ts';
import { ChannelGlyph } from './icons.tsx';

export const channelName = (channels: ChannelInfo[], id: string) => channels.find((c) => c.id === id)?.name ?? id;

export function ChannelIcon({ id, label }: { id: ChannelId | string; label?: string }) {
  const G = ChannelGlyph[id] ?? ChannelGlyph.blog;
  return (
    <span className="ch-icon" title={label} aria-label={label} role={label ? 'img' : undefined} aria-hidden={label ? undefined : true}>
      <G />
    </span>
  );
}

export function StatusPill({ status, small }: { status: PostStatus; small?: boolean }) {
  return <span className={`st-pill st-${status}${small ? ' sm' : ''}`}>{STATUS_LABEL[status]}</span>;
}

/** A media path under the Shipcast home as a URL the app can show (project files only). */
export function mediaUrl(path: string): string | null {
  const f = projectFile(path);
  return f ? fileUrl(f.campaign, f.rest) : null;
}
export const isVideo = (f: string) => /\.(mp4|mov|webm)$/i.test(f);
export const isImage = (f: string) => /\.(png|jpe?g|gif|webp)$/i.test(f);
export const isPdf = (f: string) => /\.pdf$/i.test(f);
export const baseName = (f: string) => f.split('/').pop() ?? f;

export function Thumb({ path, className }: { path: string; className?: string }) {
  const url = mediaUrl(path);
  if (url && isImage(path)) return <img className={className} src={url} alt="" loading="lazy" />;
  if (url && isVideo(path)) return <video className={className} src={`${url}#t=0.5`} muted preload="metadata" playsInline />;
  return <span className={`${className ?? ''} thumb-file`}>{isPdf(path) ? 'PDF' : baseName(path).split('.').pop()?.toUpperCase()}</span>;
}
