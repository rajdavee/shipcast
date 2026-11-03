import { useEffect, useState } from 'react';
import { foldCaption, type ChannelInfo, type Post, type PostChannel } from '../calendar-model.ts';
import { Cal } from './icons.tsx';
import { isImage, isPdf, isVideo, mediaUrl } from './CalendarBits.tsx';

/**
 * Generic mock-ups of how a post will look in each kind of feed — the layout
 * and the fold, not any platform's branding.
 */
export function PostPreview({ post, ch, info, account }: { post: Post; ch: PostChannel; info?: ChannelInfo; account: string }) {
  const kind = ch.channel === 'linkedin' || ch.channel === 'facebook' || ch.channel === 'x' || ch.channel === 'threads' ? 'feed' : ch.channel === 'instagram' ? 'square' : ch.channel === 'youtube' ? 'video' : ch.channel === 'tiktok' ? 'vertical' : ch.channel === 'pinterest' ? 'pin' : 'doc';
  return (
    <figure className={`pv pv-${kind}`} aria-label={`${info?.name ?? ch.channel} preview`}>
      {kind === 'feed' ? <Feed post={post} ch={ch} info={info} account={account} /> : kind === 'square' ? <Square ch={ch} info={info} account={account} /> : kind === 'video' ? <Video post={post} ch={ch} account={account} /> : kind === 'vertical' ? <Vertical ch={ch} account={account} /> : kind === 'pin' ? <Pin post={post} ch={ch} /> : <Doc post={post} ch={ch} />}
      <figcaption className="pv-note">Preview — approximate; each app crops and wraps a little differently.</figcaption>
    </figure>
  );
}

const handle = (account: string) => account.toLowerCase().replace(/[^a-z0-9_.]+/g, '').slice(0, 24) || 'yourbrand';
const Avatar = ({ name, ring }: { name: string; ring?: boolean }) => <span className={`pv-avatar${ring ? ' ring' : ''}`} aria-hidden="true">{(name.trim()[0] ?? 'Y').toUpperCase()}</span>;

function Caption({ ch, info, lead }: { ch: PostChannel; info?: ChannelInfo; lead?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [ch.caption]);
  const text = [ch.caption.trim(), ch.hashtags.join(' ')].filter(Boolean).join('\n\n');
  const { shown, rest } = foldCaption(text, info?.foldAt);
  const tag = (s: string) => s.split(/(#[\w-]+)/g).map((part, i) => (part.startsWith('#') ? <span key={i} className="pv-tag">{part}</span> : part));
  if (!text) return <p className="pv-caption pv-empty">{lead && <b>{lead} </b>}Your caption shows here.</p>;
  return (
    <p className="pv-caption">
      {lead && <b>{lead} </b>}
      {tag(open ? text : shown)}
      {rest && !open && (
        <>
          {'… '}
          <button type="button" className="pv-more" onClick={() => setOpen(true)}>{ch.channel === 'instagram' ? 'more' : 'see more'}</button>
        </>
      )}
    </p>
  );
}

function Carousel({ files, ratio, empty }: { files: string[]; ratio: string; empty: string }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [files.join()]);
  const f = files[Math.min(i, files.length - 1)];
  const url = f ? mediaUrl(f) : null;
  return (
    <div className="pv-media" style={{ aspectRatio: ratio }}>
      {!f ? (
        <span className="pv-media-empty">{empty}</span>
      ) : url && isImage(f) ? (
        <img src={url} alt="" />
      ) : url && isVideo(f) ? (
        <video src={url} muted playsInline controls preload="metadata" />
      ) : (
        <span className="pv-media-empty">{f.split('/').pop()}</span>
      )}
      {files.length > 1 && (
        <>
          <span className="pv-count">{i + 1}/{files.length}</span>
          <button type="button" className="pv-arrow l" aria-label="Previous slide" disabled={i === 0} onClick={() => setI(i - 1)}><Cal.prev /></button>
          <button type="button" className="pv-arrow r" aria-label="Next slide" disabled={i >= files.length - 1} onClick={() => setI(i + 1)}><Cal.next /></button>
          <span className="pv-dots" aria-hidden="true">{files.slice(0, 10).map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>
        </>
      )}
    </div>
  );
}

function Feed({ post, ch, info, account }: { post: Post; ch: PostChannel; info?: ChannelInfo; account: string }) {
  const pdf = ch.media.find(isPdf);
  const visual = ch.media.filter((f) => isImage(f) || isVideo(f));
  return (
    <div className="pv-card">
      <header className="pv-head">
        <Avatar name={account} />
        <div>
          <b>{account}</b>
          <small>{ch.channel === 'x' || ch.channel === 'threads' ? `@${handle(account)}` : 'Your headline'} · now</small>
        </div>
      </header>
      <Caption ch={ch} info={info} />
      {pdf ? (
        <div className="pv-doc-post">
          <div className="pv-doc-page"><b>{post.title}</b><span>Swipe →</span></div>
          <small>Document · {post.title}</small>
        </div>
      ) : visual.length ? (
        <Carousel files={visual} ratio={visual.length > 1 ? '1 / 1' : '1.91 / 1'} empty="" />
      ) : null}
      <footer className="pv-actions">
        <span><Cal.thumb />Like</span>
        <span><Cal.bubble />Comment</span>
        <span><Cal.repost />Share</span>
        <span><Cal.send />Send</span>
      </footer>
      {ch.firstComment?.trim() && (
        <div className="pv-comment">
          <Avatar name={account} />
          <p><b>{account}</b> {ch.firstComment}</p>
        </div>
      )}
    </div>
  );
}

function Square({ ch, info, account }: { ch: PostChannel; info?: ChannelInfo; account: string }) {
  const h = handle(account);
  return (
    <div className="pv-card pv-square-card">
      <header className="pv-head">
        <Avatar name={account} ring />
        <div><b>{h}</b></div>
      </header>
      <Carousel files={ch.media.filter((f) => isImage(f) || isVideo(f))} ratio="4 / 5" empty="Add an image, carousel or reel" />
      <footer className="pv-actions icons">
        <Cal.heart />
        <Cal.bubble />
        <Cal.send />
        <span className="pv-spacer" />
        <Cal.bookmark />
      </footer>
      <Caption ch={ch} info={info} lead={h} />
      {ch.firstComment?.trim() && <p className="pv-sub">View 1 comment</p>}
    </div>
  );
}

function Video({ post, ch, account }: { post: Post; ch: PostChannel; account: string }) {
  const v = ch.media.find(isVideo);
  const url = v ? mediaUrl(v) : null;
  const short = !!v && /vertical|short|9x16|reel|tiktok/i.test(v);
  return (
    <div className="pv-video-card">
      <div className={`pv-player${short ? ' short' : ''}`}>
        {url ? <video src={url} muted playsInline controls preload="metadata" /> : <span className="pv-media-empty">Attach the video</span>}
        {short && <span className="pv-count">Short</span>}
      </div>
      <div className="pv-video-meta">
        <Avatar name={account} />
        <div>
          <b className="pv-video-title">{ch.title?.trim() || post.title || 'Video title'}</b>
          <small>{account} · {post.at ? 'Scheduled' : 'Not scheduled'}</small>
          {ch.caption.trim() && <p className="pv-desc">{ch.caption.trim().slice(0, 160)}{ch.caption.length > 160 ? '…' : ''}</p>}
        </div>
      </div>
    </div>
  );
}

function Vertical({ ch, account }: { ch: PostChannel; account: string }) {
  const f = ch.media.find((x) => isVideo(x) || isImage(x));
  const url = f ? mediaUrl(f) : null;
  return (
    <div className="pv-vertical">
      {url ? isVideo(f!) ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt="" /> : <span className="pv-media-empty">Attach a vertical video</span>}
      <div className="pv-overlay">
        <b>@{handle(account)}</b>
        <p>{[ch.caption.trim(), ch.hashtags.join(' ')].filter(Boolean).join(' ').slice(0, 140) || 'Your caption shows here.'}</p>
      </div>
    </div>
  );
}

function Pin({ post, ch }: { post: Post; ch: PostChannel }) {
  const f = ch.media.find(isImage);
  const url = f ? mediaUrl(f) : null;
  return (
    <div className="pv-pin">
      <div className="pv-media" style={{ aspectRatio: '2 / 3' }}>{url ? <img src={url} alt="" /> : <span className="pv-media-empty">Add a 2:3 image</span>}</div>
      <b>{ch.title?.trim() || post.title}</b>
      <p>{ch.caption.trim().slice(0, 120)}</p>
    </div>
  );
}

function Doc({ post, ch }: { post: Post; ch: PostChannel }) {
  return (
    <div className="pv-card pv-docview">
      <small className="pv-sub">{ch.channel === 'newsletter' ? 'Subject' : 'Article'}</small>
      <h3>{ch.title?.trim() || post.title}</h3>
      <p className="pv-caption">{ch.caption.trim().slice(0, 600) || 'Your text shows here.'}{ch.caption.length > 600 ? '…' : ''}</p>
    </div>
  );
}
