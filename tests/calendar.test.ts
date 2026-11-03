import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'cal-'));
const { savePost, listPosts, getPost, deletePost, updateChannel, channelProblems, scheduleProblems, toIcs, toCsv, importCsv, parseCsv, zonedToUtc, localParts, readPlan, savePlan, channel } = await import('@shipcast/engine');

const li = (over = {}) => ({ channel: 'linkedin' as const, caption: 'One link in, a whole launch out.', hashtags: ['#launch'], media: [], via: 'manual' as const, ...over });

test('a post moves between the backlog and the calendar with its date', async () => {
  const idea = await savePost({ title: 'PDF carousel: 5 launch mistakes', channels: [li()] });
  assert.equal(idea.status, 'idea');
  assert.equal(idea.at, undefined);
  const dated = await savePost({ id: idea.id, at: '2026-11-10T03:30:00.000Z' });
  assert.equal(dated.status, 'draft', 'an idea with a date is a draft');
  const ready = await savePost({ id: idea.id, status: 'ready' });
  assert.equal(ready.status, 'ready');
  const back = await savePost({ id: idea.id, at: undefined as any });
  assert.equal(back.status, 'idea', 'losing its date sends it back to the backlog');
  await assert.rejects(savePost({ id: 'nope', title: 'x' }), /not found/);
  const junk = await savePost({ title: '  ', channels: [{ channel: 'myspace' } as any, li(), li()] });
  assert.equal(junk.title, 'Untitled post');
  assert.equal(junk.channels.length, 1, 'unknown and duplicate channels dropped');
  assert.ok(await deletePost(junk.id));
  assert.equal(await getPost(junk.id), undefined);
});

test('listing filters by range, channel, status and backlog', async () => {
  await savePost({ title: 'IG reel', at: '2026-11-12T12:30:00.000Z', channels: [{ channel: 'instagram', caption: 'x', hashtags: [], media: ['a.mp4'], via: 'manual' }] });
  await savePost({ title: 'Backlog idea', channels: [li()] });
  const nov = await listPosts({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' });
  assert.ok(nov.every((p) => p.at && p.at.startsWith('2026-11')));
  assert.deepEqual((await listPosts({ channel: 'instagram' })).map((p) => p.title), ['IG reel']);
  assert.ok((await listPosts({ unscheduled: true })).some((p) => p.title === 'Backlog idea'));
  assert.ok((await listPosts({ status: ['idea'] })).every((p) => p.status === 'idea'));
});

test('channel rules: limits, hashtags, required media, carousel size, titles', () => {
  assert.deepEqual(channelProblems(li()), []);
  assert.match(channelProblems(li({ caption: 'x'.repeat(3001) })).join(), /over the 3000 limit/);
  assert.match(channelProblems({ channel: 'instagram', caption: 'hi', hashtags: [], media: [], via: 'manual' }).join(), /attach/);
  assert.match(channelProblems({ channel: 'instagram', caption: 'hi', hashtags: [], media: Array(11).fill('a.png'), via: 'manual' }).join(), /up to 10/);
  assert.match(channelProblems({ channel: 'x', caption: 'hi', hashtags: ['#a', '#b', '#c'], media: [], via: 'manual' }).join(), /3 hashtags/);
  assert.match(channelProblems({ channel: 'youtube', caption: '', hashtags: [], media: ['v.mp4'], via: 'manual' }).join(), /add a title/);
  assert.match(channelProblems({ channel: 'x', caption: 'hi', firstComment: 'link', hashtags: [], media: [], via: 'manual' }).join(), /first comments/);
  assert.equal(channel('linkedin')?.foldAt, 210);
});

test('scheduling needs a future time, a channel and clean channels', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  const base = { id: 'p', title: 't', status: 'draft' as const, tz: 'UTC', notes: '', createdAt: '', updatedAt: '' };
  assert.deepEqual(scheduleProblems({ ...base, at: '2026-11-04T09:00:00Z', channels: [li()] }, now), []);
  assert.match(scheduleProblems({ ...base, channels: [li()] }, now).join(), /Pick a date/);
  assert.match(scheduleProblems({ ...base, at: '2026-11-01T09:00:00Z', channels: [li()] }, now).join(), /passed/);
  assert.match(scheduleProblems({ ...base, at: '2026-11-04T09:00:00Z', channels: [] }, now).join(), /at least one channel/);
});

test('publisher bookkeeping: all channels sent → published; a failure with nothing pending → failed', async () => {
  const p = await savePost({ title: 'two channels', at: '2026-11-20T09:00:00Z', status: 'scheduled', channels: [li({ state: 'pending' }), { channel: 'x', caption: 'hi', hashtags: [], media: [], via: 'manual', state: 'pending' }] });
  let q = await updateChannel(p.id, 'linkedin', { state: 'sent', url: 'https://linkedin.example/1' });
  assert.equal(q.status, 'scheduled');
  q = await updateChannel(p.id, 'x', { state: 'failed', error: 'rate limited' });
  assert.equal(q.status, 'failed');
  q = await updateChannel(p.id, 'x', { state: 'sent' });
  assert.equal(q.status, 'published');
});

test('time zones: a 09:00 slot in Kolkata is 03:30 UTC and reads back as 09:00', () => {
  const utc = zonedToUtc('2026-11-10', '09:00', 'Asia/Kolkata');
  assert.equal(utc, '2026-11-10T03:30:00.000Z');
  assert.deepEqual(localParts(utc, 'Asia/Kolkata'), { date: '2026-11-10', time: '09:00' });
  // Across a DST change (New York falls back on 1 Nov 2026).
  assert.equal(zonedToUtc('2026-11-02', '09:00', 'America/New_York'), '2026-11-02T14:00:00.000Z');
  assert.equal(zonedToUtc('2026-10-30', '09:00', 'America/New_York'), '2026-10-30T13:00:00.000Z');
});

test('ICS: dated posts become events with escaped text', async () => {
  const ics = toIcs(await listPosts(), new Date('2026-11-03T00:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:\[Instagram\] IG reel\r\n/);
  assert.match(ics, /DTSTART:20261112T123000Z/);
  assert.ok(!/Backlog idea/.test(ics), 'ideas without a date are not events');
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
});

test('CSV: quotes and newlines survive a round trip; bad rows are reported', async () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi""\nnext"\n'), [['a', 'b'], ['x, y', 'he said "hi"\nnext']]);
  const csv = toCsv(await listPosts({ channel: 'instagram' }));
  assert.match(csv.split('\n')[0], /^date,time,tz,channels,title/);
  const r = await importCsv('title,date,time,tz,channels,caption,hashtags\n"Week 1, post 1",2026-12-01,10:00,Asia/Kolkata,linkedin instagram,"Line one\nline two",#a #b\n,2026-12-02,,,,,\n');
  assert.equal(r.created.length, 1);
  assert.equal(r.problems.length, 1);
  const p = r.created[0];
  assert.equal(p.title, 'Week 1, post 1');
  assert.equal(p.at, '2026-12-01T04:30:00.000Z');
  assert.deepEqual(p.channels.map((c) => c.channel), ['linkedin', 'instagram']);
  assert.equal(p.channels[0].caption, 'Line one\nline two');
  assert.deepEqual(p.channels[0].hashtags, ['#a', '#b']);
});

test('the plan keeps pillars and cadence sane', async () => {
  assert.ok((await readPlan()).pillars.length >= 3);
  const p = await savePlan({ pillars: [{ name: 'Teach', share: 140 }, { name: '', share: 5 }], cadence: { linkedin: { perWeek: 99, slots: ['Tue 09:00', 'someday'] }, myspace: { perWeek: 1, slots: [] } } as any });
  assert.deepEqual(p.pillars, [{ name: 'Teach', share: 100 }]);
  assert.deepEqual(p.cadence, { linkedin: { perWeek: 21, slots: ['Tue 09:00'] } });
});
