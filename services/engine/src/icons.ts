import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { home } from './paths.ts';

/**
 * Platform logos for infographics and cards, from Iconify's open sets
 * (`logos` — full-colour, CC0; `simple-icons` — monochrome, CC0, tinted with
 * the brand colour). Fetched on first use and cached under ~/.shipcast/icons.
 * Brand marks remain trademarks of their owners; they're used here the way
 * any article names a platform.
 */

/** Common names → Iconify ids (simple-icons entries carry their brand colour). */
const ALIASES: Record<string, string> = {
  google: 'logos:google-icon',
  'google search': 'logos:google-icon',
  'google reviews': 'logos:google-icon',
  youtube: 'logos:youtube-icon',
  'youtube reviews': 'logos:youtube-icon',
  linkedin: 'logos:linkedin-icon',
  'linkedin comments': 'logos:linkedin-icon',
  x: 'logos:x',
  twitter: 'logos:x',
  reddit: 'logos:reddit-icon',
  facebook: 'logos:facebook',
  'facebook groups': 'logos:facebook',
  instagram: 'logos:instagram-icon',
  tiktok: 'logos:tiktok-icon',
  discord: 'logos:discord-icon',
  slack: 'logos:slack-icon',
  github: 'logos:github-icon',
  notion: 'logos:notion-icon',
  figma: 'logos:figma',
  medium: 'logos:medium-icon',
  'dev.to': 'logos:dev-icon',
  devto: 'logos:dev-icon',
  stackblitz: 'logos:stackblitz-icon',
  vercel: 'logos:vercel-icon',
  npm: 'logos:npm-icon',
  'state of js': 'simple-icons:stateofjs#2A2A2A',
  substack: 'simple-icons:substack#FF6719',
  quora: 'logos:quora',
  'product hunt': 'logos:producthunt',
  producthunt: 'logos:producthunt',
  'hacker news': 'simple-icons:ycombinator#FF6600',
  hackernews: 'simple-icons:ycombinator#FF6600',
  'stack overflow': 'logos:stackoverflow-icon',
  chatgpt: 'simple-icons:openai#10A37F',
  openai: 'simple-icons:openai#10A37F',
  claude: 'logos:claude-icon',
  anthropic: 'simple-icons:anthropic#191919',
  perplexity: 'logos:perplexity-icon',
  gemini: 'simple-icons:googlegemini#8E75B2',
  'google gemini': 'simple-icons:googlegemini#8E75B2',
  copilot: 'logos:microsoft-icon',
  trustpilot: 'simple-icons:trustpilot#00B67A',
  g2: 'simple-icons:g2#FF492C',
  capterra: 'simple-icons:capterra#044D80',
  'app store': 'logos:apple-app-store',
  'google play': 'logos:google-play-icon',
  amazon: 'simple-icons:amazon#FF9900',
  whatsapp: 'logos:whatsapp-icon',
  zoom: 'logos:zoom-icon',
  hubspot: 'logos:hubspot',
  gmail: 'logos:google-gmail',
  email: 'mdi:email-outline#5B6170',
  website: 'mdi:web#5B6170',
  'brand website': 'mdi:web#5B6170',
  'vendor websites': 'mdi:web#5B6170',
  blog: 'mdi:post-outline#5B6170',
  'comparison blogs': 'mdi:file-compare#5B6170',
  forums: 'mdi:forum-outline#5B6170',
  'industry forums': 'mdi:forum-outline#5B6170',
  'case studies': 'mdi:file-document-outline#5B6170',
  'customer case studies': 'mdi:file-document-outline#5B6170',
  podcast: 'mdi:podcast#5B6170',
  podcasts: 'mdi:podcast#5B6170',
  newsletter: 'mdi:email-newsletter#5B6170',
  webinar: 'mdi:presentation-play#5B6170',
  events: 'mdi:calendar-star#5B6170',
  'sales demo': 'mdi:video-outline#5B6170',
  demo: 'mdi:video-outline#5B6170',
  'free trial': 'mdi:rocket-launch-outline#5B6170',
  docs: 'mdi:book-open-variant#5B6170',
  documentation: 'mdi:book-open-variant#5B6170',
  'creator content': 'mdi:play-circle-outline#5B6170',
  'ai search': 'mdi:creation-outline#7C5CFF',
  'ai assistants': 'mdi:creation-outline#7C5CFF',
  'review sites': 'mdi:star-outline#F5A524',
  'review platforms': 'mdi:star-outline#F5A524',
  marketplace: 'mdi:storefront-outline#5B6170',
  app: 'mdi:cellphone#5B6170',
  community: 'mdi:account-group-outline#5B6170',
};

const cacheDir = () => join(home(), 'icons');

function candidates(name: string): string[] {
  const n = name.trim().toLowerCase();
  if (/^[a-z0-9-]+:[a-z0-9-]+(#[0-9a-f]{6})?$/i.test(n)) return [n];
  if (ALIASES[n]) return [ALIASES[n]];
  const slug = n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const compact = slug.replace(/-/g, '');
  return [`logos:${slug}-icon`, `logos:${slug}`, `simple-icons:${compact}`];
}

async function fetchIcon(id: string): Promise<string | null> {
  const [ref, color] = id.split('#');
  const [set, icon] = ref.split(':');
  const file = join(cacheDir(), `${createHash('sha1').update(id).digest('hex').slice(0, 16)}.svg`);
  if (existsSync(file)) {
    const s = await readFile(file, 'utf8');
    return s === 'missing' ? null : s;
  }
  await mkdir(cacheDir(), { recursive: true });
  try {
    const r = await fetch(`https://api.iconify.design/${set}/${icon}.svg${color ? `?color=%23${color}` : ''}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      await writeFile(file, 'missing');
      return null;
    }
    const svg = await r.text();
    await writeFile(file, svg);
    return svg;
  } catch {
    return null;
  }
}

/** Resolve a platform/brand name to an inline SVG data URI, or null (callers draw a monogram). */
export async function iconDataUri(name: string): Promise<string | null> {
  for (const id of candidates(name)) {
    const svg = await fetchIcon(id);
    if (svg) return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
  return null;
}

/** Resolve many names at once (deduplicated). */
export async function resolveIcons(names: string[]): Promise<Record<string, string | null>> {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const out: Record<string, string | null> = {};
  await Promise.all(uniq.map(async (n) => (out[n] = await iconDataUri(n))));
  return out;
}

export const KNOWN_ICONS = Object.keys(ALIASES);
