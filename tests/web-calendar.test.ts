import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../apps/web/src/calendar-model.ts';
import { CALENDAR_CHANNELS, channelProblems as engineProblems, DEFAULT_PLAN, type PostChannel as EngineChannel } from '../services/engine/src/calendar.ts';
import { planSlots } from '../services/engine/src/planner.ts';

const channels = CALENDAR_CHANNELS as m.ChannelInfo[];
const post = (over: Partial<m.Post> = {}): m.Post => ({ id: 'p1', title: 'T', status: 'draft', tz: 'UTC', channels: [], notes: '', createdAt: '', updatedAt: '', ...over });
const ch = (over: Partial<m.PostChannel> = {}): m.PostChannel => ({ channel: 'linkedin', caption: 'Hello', hashtags: [], media: [], via: 'manual', ...over });

test('month grid: Monday-first weeks that cover the whole month', () => {
  const g = m.monthGrid('2026-11-17');
  assert.equal(g[0][0], '2026-10-26'); // Nov 1 2026 is a Sunday
  assert.equal(g[0][6], '2026-11-01');
  assert.equal(g.at(-1)![6], '2026-12-06');
  assert.equal(g.length, 6);
  assert.ok(g.every((w) => w.length === 7 && m.weekday(w[0]) === 0));
  // February 2027 starts on a Monday and fits in four rows.
  assert.equal(m.monthGrid('2027-02-10').length, 4);
  assert.equal(m.monthGrid('2027-02-10')[0][0], '2027-02-01');
});

test('date arithmetic stays on whole days across DST and month ends', () => {
  assert.equal(m.addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(m.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(m.addMonths('2026-01-31', 1), '2026-02-01');
  assert.equal(m.addMonths('2026-01-15', -1), '2025-12-01');
  assert.equal(m.startOfWeek('2026-11-08'), '2026-11-02');
  assert.equal(m.daysBetween('2026-10-30', '2026-11-02'), 3);
  assert.deepEqual(m.weekDates('2026-11-04'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.deepEqual(m.viewRange('list', '2026-11-03'), { from: '2026-11-03', to: '2026-11-30' });
  assert.equal(m.shiftAnchor('month', '2026-11-20', -1), '2026-10-01');
  assert.equal(m.shiftAnchor('week', '2026-11-20', 1), '2026-11-27');
});

test('zone-aware bucketing: a post falls on the day it is in the plan zone', () => {
  // 23:30 UTC on the 3rd is the 4th in Tokyo and still the 3rd in New York.
  const p = post({ at: '2026-11-03T23:30:00.000Z' });
  assert.deepEqual([...m.bucketByDay([p], 'Asia/Tokyo').keys()], ['2026-11-04']);
  assert.deepEqual([...m.bucketByDay([p], 'America/New_York').keys()], ['2026-11-03']);
  const a = post({ id: 'a', at: '2026-11-03T15:00:00.000Z' });
  const b = post({ id: 'b', at: '2026-11-03T09:00:00.000Z' });
  assert.deepEqual(m.bucketByDay([a, b, post({ id: 'idea' })], 'UTC').get('2026-11-03')!.map((x) => x.id), ['b', 'a']);
});

test('zonedToUtc round-trips wall-clock times, including on a DST change day', () => {
  for (const [date, time, tz] of [['2026-03-29', '09:00', 'Europe/London'], ['2026-11-01', '01:30', 'America/New_York'], ['2026-11-03', '18:00', 'Asia/Kolkata']] as const) {
    assert.deepEqual(m.localParts(m.zonedToUtc(date, time, tz), tz), { date, time });
  }
  assert.equal(m.zonedToUtc('2026-07-01', '09:00', 'Europe/London'), '2026-07-01T08:00:00.000Z');
  // Dragging to another day keeps the local time, even across the clocks going back.
  assert.equal(m.moveToDay('2026-10-23T08:00:00.000Z', '2026-10-30', 'Europe/London'), '2026-10-30T09:00:00.000Z');
});

test('slot time for a dropped idea: weekday slot, else first slot, else 09:00', () => {
  const plan = DEFAULT_PLAN as m.ContentPlan;
  assert.equal(m.slotTime(plan, 'linkedin', '2026-11-04'), '12:00'); // Wednesday
  assert.equal(m.slotTime(plan, 'linkedin', '2026-11-07'), '09:00'); // Saturday → first slot (Tue 09:00)
  assert.equal(m.slotTime(plan, 'instagram', '2026-11-07'), '18:00');
  assert.equal(m.slotTime(plan, 'x', '2026-11-07'), '09:00');
  assert.equal(m.slotTime(null, undefined, '2026-11-07'), '09:00');
  assert.equal(m.snapMinutes(9 * 60 + 8), 9 * 60 + 15);
  assert.equal(m.snapMinutes(9 * 60 + 7), 9 * 60);
  assert.equal(m.snapMinutes(5 * 60, 15, 6 * 60, 23 * 60), 6 * 60);
  assert.equal(m.timeOf(m.minutesOf('07:45') + 30), '08:15');
});

test('cadence count matches the planner slots it will fill', () => {
  const plan: m.ContentPlan = { ...(DEFAULT_PLAN as m.ContentPlan), tz: 'UTC', cadence: { linkedin: { perWeek: 3, slots: ['Tue 09:00', 'Wed 12:00', 'Thu 09:00'] }, instagram: { perWeek: 4, slots: ['Mon 18:00'] }, x: { perWeek: 0, slots: [] } } };
  const counts = m.cadenceCount(plan, '2026-11-04', '2026-12-02');
  const slots = planSlots(plan as any, '2026-11-04', '2026-12-02');
  for (const c of counts) assert.equal(c.posts, slots.filter((s) => s.channel === c.channel).length, c.channel);
  assert.deepEqual(counts.map((c) => c.channel), ['linkedin', 'instagram']);
  const taken = [post({ at: '2026-11-04T12:00:00.000Z', channels: [ch()] }), post({ at: '2026-11-10T18:00:00.000Z', channels: [ch({ channel: 'instagram' })] })];
  const left = m.cadenceCount(plan, '2026-11-04', '2026-12-02', taken);
  const slotsLeft = planSlots(plan as any, '2026-11-04', '2026-12-02', taken as any);
  for (const c of left) assert.equal(c.posts, slotsLeft.filter((s) => s.channel === c.channel).length, c.channel);
  assert.equal(left[0].posts, counts[0].posts - 1);
});

test('pillar shares rebalance to 100', () => {
  assert.deepEqual(m.rebalance([40, 30, 20, 10], 0, 60), [60, 20, 13, 7]);
  for (const [s, i, v] of [[[40, 30, 20, 10], 3, 0], [[50, 50], 1, 100], [[100, 0, 0], 0, 10], [[33, 33, 34], 2, 1]] as [number[], number, number][]) {
    const r = m.rebalance(s, i, v);
    assert.equal(r.reduce((a, b) => a + b, 0), 100, JSON.stringify(r));
    assert.equal(r[i], v);
  }
  assert.deepEqual(m.rebalance([70], 0, 20), [100]);
});

test('client channel checks say exactly what the server says', () => {
  const samples: m.PostChannel[] = [
    ch(),
    ch({ caption: '' }),
    ch({ caption: 'x'.repeat(2990), hashtags: ['#a', '#b'] }),
    ch({ hashtags: ['#1', '#2', '#3', '#4', '#5', '#6'] }),
    ch({ channel: 'instagram', media: [] }),
    ch({ channel: 'instagram', media: Array.from({ length: 11 }, (_, i) => `${i}.png`) }),
    ch({ channel: 'youtube', caption: '', media: ['v.mp4'] }),
    ch({ channel: 'youtube', title: 'y'.repeat(120), media: ['v.mp4'] }),
    ch({ channel: 'x', media: ['1.png', '2.png', '3.jpg', '4.webp', '5.gif'] }),
    ch({ channel: 'pinterest', hashtags: ['#a'], media: ['p.png'] }),
    ch({ channel: 'threads', firstComment: 'hi' }),
  ];
  for (const c of samples) assert.deepEqual(m.channelProblems(c, channels.find((x) => x.id === c.channel)), engineProblems(c as EngineChannel), JSON.stringify(c).slice(0, 80));
  const now = new Date('2026-11-03T10:00:00Z');
  assert.deepEqual(m.scheduleProblems(post({ channels: [] }), channels, now), ['Pick a date and time.', 'Choose at least one channel.']);
  assert.deepEqual(m.scheduleProblems(post({ at: '2026-11-02T10:00:00Z', channels: [ch()] }), channels, now), ['That time has passed — pick a future time.']);
});

test('fold, hashtags, filters and project files', () => {
  const text = 'Short hook line that grabs. ' + 'More words follow here. '.repeat(20);
  const f = m.foldCaption(text, 125);
  assert.ok(f.shown.length <= 125 && f.shown.length > 80);
  assert.equal(f.shown + f.rest, text.slice(0, f.shown.length) + text.slice(f.shown.length));
  assert.equal(m.foldCaption('short', 125).rest, '');
  assert.deepEqual(m.parseHashtags('#Launch, dev tools #ai #launch'), ['#Launch', '#devtools', '#ai']);
  const posts = [post({ id: 'a', channels: [ch()] }), post({ id: 'b', status: 'scheduled', channels: [ch({ channel: 'instagram' })] })];
  assert.deepEqual(m.filterPosts(posts, ['instagram'], []).map((p) => p.id), ['b']);
  assert.deepEqual(m.filterPosts(posts, [], ['draft']).map((p) => p.id), ['a']);
  assert.deepEqual(m.projectFile('campaigns/abc/deliverables/s1/out/a.png'), { campaign: 'abc', rest: 'deliverables/s1/out/a.png' });
  assert.equal(m.projectFile('/tmp/a.png'), null);
});

test('next action walks Make it → Schedule → Send now / Mark posted', () => {
  assert.equal(m.nextAction(post({ format: 'carousel', channels: [ch()] }), channels), 'make');
  assert.equal(m.nextAction(post({ channels: [ch()] }), channels), 'schedule');
  assert.equal(m.nextAction(post({ step: 's1', format: 'carousel', channels: [ch({ channel: 'instagram' })] }), channels), 'schedule');
  assert.equal(m.nextAction(post({ status: 'scheduled', channels: [ch({ via: 'direct', state: 'pending' })] }), channels), 'send');
  assert.equal(m.nextAction(post({ status: 'scheduled', channels: [ch({ state: 'due' })] }), channels), 'mark');
  assert.equal(m.nextAction(post({ status: 'failed', channels: [ch()] }), channels), 'retry');
  assert.equal(m.nextAction(post({ status: 'published' }), channels), null);
});

test('edits sent back carry the server copy of publisher fields', () => {
  const server = post({ channels: [ch({ state: 'failed', error: 'boom', attempts: 3 })] });
  const edit = post({ channels: [ch({ caption: 'New', state: 'pending' }), ch({ channel: 'x', state: 'sent' })] });
  const out = m.withServerState(edit, server);
  assert.equal(out.channels[0].caption, 'New');
  assert.equal(out.channels[0].state, 'failed');
  assert.equal(out.channels[0].attempts, 3);
  assert.equal(out.channels[1].state, undefined);
});
