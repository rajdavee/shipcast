import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'site-'));
const { tagLinks, tagChannel, hostOfSite, mapGa4, mapSearch, mergeDays, saveSiteSettings, readSiteSettings, syncSite, syncSiteIfDue, siteStatus, setSecret, setPublishFetch, savePost, runPublisher, connections } = await import('@shipcast/engine');

test('links to your own site get UTM tags; other links and already-tagged ones are left alone', () => {
  const o = { post: 'p1', channel: 'linkedin' as const, domains: ['acme.com'] };
  assert.equal(tagLinks('Read it: https://acme.com/blog/launch.', o), 'Read it: https://acme.com/blog/launch?utm_source=linkedin&utm_medium=social&utm_campaign=sc-p1.');
  assert.equal(tagLinks('https://www.acme.com/?ref=x', o), 'https://www.acme.com/?ref=x&utm_source=linkedin&utm_medium=social&utm_campaign=sc-p1');
  assert.equal(tagLinks('docs at https://docs.acme.com/a', o), 'docs at https://docs.acme.com/a?utm_source=linkedin&utm_medium=social&utm_campaign=sc-p1');
  assert.equal(tagLinks('https://notacme.com/x and https://github.com/acme', o), 'https://notacme.com/x and https://github.com/acme');
  assert.equal(tagLinks('https://acme.com/?utm_source=newsletter', o), 'https://acme.com/?utm_source=newsletter');
  assert.equal(tagLinks('no links here', o), 'no links here');
  assert.equal(hostOfSite('sc-domain:Acme.com'), 'acme.com');
  assert.equal(hostOfSite('https://www.acme.com/'), 'acme.com');
});

test('Analytics and Search Console replies map into days; a resync replaces only its dates', () => {
  const totals = { rows: [{ dimensionValues: [{ value: '20261102' }], metricValues: [{ value: '150' }, { value: '120' }, { value: '4' }] }] };
  const bySource = { rows: [{ dimensionValues: [{ value: '20261102' }, { value: 'LinkedIn.com' }], metricValues: [{ value: '40' }, { value: '2' }] }] };
  const byCampaign = { rows: [
    { dimensionValues: [{ value: '20261102' }, { value: 'sc-pabc' }, { value: 'linkedin' }], metricValues: [{ value: '30' }, { value: '2' }] },
    { dimensionValues: [{ value: '20261102' }, { value: 'spring-sale' }, { value: 'google' }], metricValues: [{ value: '99' }, { value: '9' }] },
  ] };
  const days = mapGa4(totals, bySource, byCampaign);
  const d = days.get('2026-11-02')!;
  assert.equal(d.sessions, 150);
  assert.equal(d.users, 120);
  assert.equal(d.keyEvents, 4);
  assert.deepEqual(d.bySource, { 'linkedin.com': { sessions: 40, keyEvents: 2 } });
  assert.deepEqual(d.byCampaign, { pabc: { sessions: 30, keyEvents: 2, source: 'linkedin' } }, 'only Shipcast campaigns');
  mapSearch(days, { rows: [{ keys: ['2026-11-02'], clicks: 50, impressions: 1000, position: 8.26 }] }, { rows: [{ keys: ['2026-11-02', 'acme pricing'], clicks: 3, impressions: 40 }, { keys: ['2026-11-02', 'acme'], clicks: 20, impressions: 100 }] });
  assert.deepEqual(d.search, { clicks: 50, impressions: 1000, position: 8.3 });
  assert.deepEqual(d.topQueries!.map((q) => q.query), ['acme', 'acme pricing']);
  const merged = mergeDays([{ date: '2026-10-01', sessions: 9 }, { date: '2026-11-02', sessions: 1, users: 1 }], days);
  assert.deepEqual(merged.map((x) => [x.date, x.sessions]), [['2026-10-01', 9], ['2026-11-02', 150]]);
});

test('settings are validated; sync reads Google once and caches; the publisher tags links when it sends', async () => {
  await assert.rejects(saveSiteSettings({ ga4Property: 'nope' }), /Pick a Google Analytics property/);
  const s = await saveSiteSettings({ ga4Property: 'properties/123', ga4Name: 'Acme', gscSite: 'sc-domain:acme.com', domains: ['https://www.Shop.acme.io/path', 'not a host'] });
  assert.deepEqual(s.domains, ['shop.acme.io']);
  assert.equal(s.utm, true);
  await assert.rejects(syncSite(), /not connected/);

  await setSecret('publish.youtube.client', JSON.stringify({ id: 'cid', secret: 'csecret' }));
  await setSecret('site.google.token', JSON.stringify({ access: 'ya29.token', refresh: 'r1', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
  assert.equal((await connections()).google.connected, true);
  const calls: string[] = [];
  setPublishFetch((async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer ya29.token');
    const body = JSON.parse(String(init.body ?? '{}'));
    if (url.includes(':runReport')) {
      const dims = body.dimensions.map((x: any) => x.name).join(',');
      const rows = dims === 'date' ? [{ dimensionValues: [{ value: '20261103' }], metricValues: [{ value: '80' }, { value: '70' }, { value: '3' }] }] : dims === 'date,sessionSource' ? [{ dimensionValues: [{ value: '20261103' }, { value: 'lnkd.in' }], metricValues: [{ value: '12' }, { value: '1' }] }] : [{ dimensionValues: [{ value: '20261103' }, { value: 'sc-p9' }, { value: 'linkedin' }], metricValues: [{ value: '7' }, { value: '1' }] }];
      return new Response(JSON.stringify({ rows }));
    }
    if (url.includes('searchAnalytics')) return new Response(JSON.stringify({ rows: body.dimensions.length === 1 ? [{ keys: ['2026-11-03'], clicks: 9, impressions: 300, position: 11 }] : [{ keys: ['2026-11-03', 'acme'], clicks: 9, impressions: 100 }] }));
    return new Response('{}', { status: 404 });
  }) as typeof fetch);
  try {
    const r = await syncSite({ now: new Date('2026-11-05T10:00:00Z') });
    assert.equal(r.days, 1);
    assert.equal(r.from, '2026-07-08', 'the first sync reaches back 120 days');
    assert.equal(calls.length, 5);
    const st = await siteStatus();
    assert.equal(st.days, 1);
    assert.equal(st.lastDay, '2026-11-03');
    assert.equal(st.lastError, undefined);
    assert.equal(await syncSiteIfDue(new Date('2026-11-05T12:00:00Z')), undefined, 'synced two hours ago: not due');
    assert.ok(await syncSiteIfDue(new Date('2026-11-05T17:00:00Z')), 'seven hours later: due');
    assert.match(calls.at(-1)!, /searchAnalytics/);

    // The publisher sends the tagged caption (the Search Console domain counts as yours).
    const sent: string[] = [];
    const at = new Date(Date.now() - 60_000).toISOString();
    const post = await savePost({ title: 'Launch', status: 'scheduled', at, channels: [{ channel: 'linkedin', caption: 'New: https://acme.com/launch', firstComment: 'More at https://shop.acme.io', hashtags: [], media: [], via: 'direct', state: 'pending' }] });
    await runPublisher({ adapter: () => ({ send: async (_p: any, c: any) => (sent.push(c.caption, c.firstComment), { id: 'x' }) }) } as any);
    assert.deepEqual(sent, [`New: https://acme.com/launch?utm_source=linkedin&utm_medium=social&utm_campaign=sc-${post.id}`, `More at https://shop.acme.io/?utm_source=linkedin&utm_medium=social&utm_campaign=sc-${post.id}`]);
    const plain = await tagChannel('p2', { channel: 'x', caption: 'https://acme.com' } as any);
    assert.match(plain.caption, /utm_source=x/);
    await saveSiteSettings({ utm: false });
    assert.equal((await tagChannel('p2', { channel: 'x', caption: 'https://acme.com' } as any)).caption, 'https://acme.com', 'tagging can be turned off');
    assert.equal((await readSiteSettings()).utm, false);
  } finally {
    setPublishFetch(null);
  }
});
