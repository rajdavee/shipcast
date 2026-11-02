#!/usr/bin/env node
// What people are paying attention to right now, from sources that are free and allowed to use.
//
//   node trends.mjs hn "<query>" [--days 30]        Hacker News stories (Algolia API, no key)
//   node trends.mjs youtube "<query>" [--days 30]   Most-viewed recent YouTube videos (needs a YouTube Data API key in Setup)
//   node trends.mjs status
//
// Prints JSON. Reddit's public API is closing and Google Trends has no public API, so neither is used.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = process.env.SHIPCAST_HOME || join(homedir(), '.shipcast');
const secrets = (() => { try { return JSON.parse(readFileSync(join(home, 'secrets.json'), 'utf8')); } catch { return {}; } })();
const key = (n) => process.env[`SHIPCAST_${n.toUpperCase()}_KEY`] || secrets[n] || '';
const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) argv[i].startsWith('--') ? (flags[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
const [cmd, ...rest] = pos;
const q = rest.join(' ').trim();
const days = Math.max(1, Math.min(365, Number(flags.days) || 30));
const since = Math.floor(Date.now() / 1000) - days * 86400;
const out = (o) => console.log(JSON.stringify(o, null, 2));
const die = (m, code = 1) => { console.error(JSON.stringify({ error: m })); process.exit(code); };

async function hn() {
  if (!q) die('usage: trends.mjs hn "<query>"', 64);
  const u = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since},points>20&hitsPerPage=20`;
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) die(`Hacker News search failed (${r.status})`);
  const hits = (await r.json()).hits ?? [];
  out({ source: 'hackernews', query: q, days, stories: hits.sort((a, b) => b.points - a.points).slice(0, 15).map((h) => ({ title: h.title, points: h.points, comments: h.num_comments, url: h.url, discussion: `https://news.ycombinator.com/item?id=${h.objectID}`, date: h.created_at?.slice(0, 10) })) });
}

async function youtube() {
  const k = key('youtube');
  if (!k) die('No YouTube Data API key — add one in Shipcast Setup → Media engines (free, 10k units/day), or skip YouTube.', 2);
  if (!q) die('usage: trends.mjs youtube "<query>"', 64);
  const after = new Date(since * 1000).toISOString();
  const s = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount&maxResults=15&publishedAfter=${after}&q=${encodeURIComponent(q)}&key=${k}`, { signal: AbortSignal.timeout(20_000) });
  if (!s.ok) die(`YouTube search failed (${s.status})`);
  const items = (await s.json()).items ?? [];
  const ids = items.map((i) => i.id.videoId).join(',');
  const v = ids ? await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${ids}&key=${k}`).then((r) => r.json()) : { items: [] };
  const stats = Object.fromEntries((v.items ?? []).map((x) => [x.id, x]));
  out({ source: 'youtube', query: q, days, videos: items.map((i) => ({ title: i.snippet.title, channel: i.snippet.channelTitle, date: i.snippet.publishedAt.slice(0, 10), views: Number(stats[i.id.videoId]?.statistics?.viewCount ?? 0), duration: stats[i.id.videoId]?.contentDetails?.duration, url: `https://www.youtube.com/watch?v=${i.id.videoId}` })) });
}

try {
  if (cmd === 'hn') await hn();
  else if (cmd === 'youtube') await youtube();
  else if (cmd === 'status') out({ hackernews: true, youtube: !!key('youtube'), webSearch: 'use your WebSearch tool for everything else' });
  else die('usage: trends.mjs hn|youtube "<query>" [--days 30] | status', 64);
} catch (e) {
  die(e.message);
}
