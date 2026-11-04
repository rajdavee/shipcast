import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChannelId, PostChannel } from './calendar.ts';
import { home } from './paths.ts';

/**
 * Links Shipcast publishes to your own site carry UTM tags, so Google
 * Analytics can say which post sent which visits and signups:
 * utm_source=<channel>, utm_medium=social, utm_campaign=sc-<post id>.
 * Only links to the domains you list are touched, and a link that already
 * has a utm_ parameter is left exactly as written.
 */

export const UTM_PREFIX = 'sc-';

export interface SiteSettings {
  /** GA4 property, "properties/123456". */
  ga4Property?: string;
  ga4Name?: string;
  /** Search Console property, "https://example.com/" or "sc-domain:example.com". */
  gscSite?: string;
  /** Tag links to these hosts (and their subdomains). */
  domains: string[];
  utm: boolean;
  lastSync?: string;
  lastAttempt?: string;
  lastError?: string;
}

export const DEFAULT_SITE: SiteSettings = { domains: [], utm: true };
export const siteDir = () => join(home(), 'site');

export async function readSiteSettings(): Promise<SiteSettings> {
  try {
    return { ...DEFAULT_SITE, ...JSON.parse(await readFile(join(siteDir(), 'settings.json'), 'utf8')) };
  } catch {
    return { ...DEFAULT_SITE };
  }
}

/** The host a Search Console property is for ("sc-domain:x.com" or a URL prefix). */
export function hostOfSite(site: string | undefined): string | undefined {
  if (!site) return undefined;
  if (site.startsWith('sc-domain:')) return site.slice('sc-domain:'.length).toLowerCase();
  try {
    return new URL(site).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** The text with links to `domains` tagged for this post and channel. */
export function tagLinks(text: string, o: { post: string; channel: ChannelId; domains: string[] }): string {
  if (!text || !o.domains.length) return text;
  const hosts = o.domains.map((d) => d.toLowerCase().replace(/^www\./, ''));
  return text.replace(URL_RE, (raw) => {
    // Trailing punctuation belongs to the sentence, not the link.
    const tail = /[.,;:!?]+$/.exec(raw)?.[0] ?? '';
    const link = tail ? raw.slice(0, -tail.length) : raw;
    let u: URL;
    try {
      u = new URL(link);
    } catch {
      return raw;
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return raw;
    if ([...u.searchParams.keys()].some((k) => k.toLowerCase().startsWith('utm_'))) return raw;
    u.searchParams.set('utm_source', o.channel);
    u.searchParams.set('utm_medium', 'social');
    u.searchParams.set('utm_campaign', `${UTM_PREFIX}${o.post}`);
    return u.toString() + tail;
  });
}

/** A channel with its caption and first comment tagged, when tagging is on. */
export async function tagChannel<C extends Pick<PostChannel, 'channel' | 'caption' | 'firstComment'>>(post: string, c: C): Promise<C> {
  const s = await readSiteSettings();
  const domains = [...new Set([...s.domains, hostOfSite(s.gscSite)].filter((d): d is string => !!d))];
  if (!s.utm || !domains.length) return c;
  const o = { post, channel: c.channel, domains };
  return { ...c, caption: tagLinks(c.caption, o), ...(c.firstComment ? { firstComment: tagLinks(c.firstComment, o) } : {}) };
}
