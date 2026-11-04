import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'deliver-'));
process.env.SHIPCAST_NOTIFY = 'off';
const { buildMessage, sendMail, saveSmtp, publicSmtp, saveSchedule, readSchedule, publicSchedule, cleanWebhook, webhookPayload, sendReport, setDeliverFetch, createReport, reportTick, lastSlot, isPrivateAddress, savePost, getReport } = await import('@shipcast/engine');

/** A tiny SMTP server that records what it receives (plain, like a local relay). */
function fakeSmtp(opts: { auth?: boolean; reject?: string } = {}) {
  const got: { from?: string; to: string[]; data: string; auth?: string }[] = [];
  const server = createServer((sock: Socket) => {
    const cur = { to: [] as string[], data: '', from: undefined as string | undefined, auth: undefined as string | undefined };
    let inData = false;
    let buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            got.push({ ...cur });
            sock.write('250 queued\r\n');
          } else cur.data += line + '\n';
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write(`250-fake\r\n${opts.auth ? '250-AUTH PLAIN LOGIN\r\n' : ''}250 8BITMIME\r\n`);
        else if (cmd === 'AUTH') (cur.auth = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString()), sock.write('235 ok\r\n');
        else if (cmd === 'MAIL') (cur.from = line), sock.write('250 ok\r\n');
        else if (cmd === 'RCPT') opts.reject && line.includes(opts.reject) ? sock.write('550 no such user\r\n') : (cur.to.push(line), sock.write('250 ok\r\n'));
        else if (cmd === 'DATA') (inData = true), sock.write('354 go\r\n');
        else if (cmd === 'QUIT') sock.end('221 bye\r\n');
        else sock.write('500 what\r\n');
      }
    });
  });
  return new Promise<{ port: number; got: typeof got; close: () => void }>((r) => server.listen(0, '127.0.0.1', () => r({ port: (server.address() as any).port, got, close: () => server.close() })));
}

test('the message: alternatives, attachment, encoded subject, dot-stuffing safe', () => {
  const m = buildMessage('Acme Reports <reports@acme.com>', { to: ['a@b.co'], subject: 'Report · October', text: 'Hi\n.hidden', html: '<p>Hi</p>', attachments: [{ name: 'r.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }] });
  assert.match(m, /^From: Acme Reports <reports@acme.com>/);
  assert.match(m, /Subject: =\?UTF-8\?B\?/);
  assert.match(m, /multipart\/mixed/);
  assert.match(m, /multipart\/alternative/);
  assert.match(m, /filename="r.pdf"/);
});

test('settings: mail server, recipients and webhooks are checked; webhook addresses never come back', async () => {
  await assert.rejects(saveSmtp({ host: 'smtp.acme.com', port: 8080, from: 'r@acme.com' }), /port 587/);
  await assert.rejects(saveSmtp({ host: 'smtp.acme.com', port: 587, from: 'not an address' }), /From/);
  await saveSmtp({ host: 'smtp.acme.com', port: 587, from: 'r@acme.com', user: 'r', pass: 'hunter22' });
  assert.deepEqual(await publicSmtp(), { configured: true, host: 'smtp.acme.com', port: 587, secure: false, user: 'r', from: 'r@acme.com', hasPassword: true });
  await saveSmtp({ host: 'smtp.acme.com', port: 465, from: 'r@acme.com', user: 'r' });
  assert.equal((await publicSmtp() as any).hasPassword, true, 'an empty password keeps the saved one');
  assert.equal((await publicSmtp() as any).secure, true, '465 is TLS');

  assert.throws(() => cleanWebhook({ kind: 'slack', url: 'https://evil.com/hook' }), /hooks.slack.com/);
  assert.throws(() => cleanWebhook({ kind: 'generic', url: 'http://example.com' }), /https/);
  assert.equal(cleanWebhook({ kind: 'discord', url: 'https://discord.com/api/webhooks/1/abc' }).kind, 'discord');
  await assert.rejects(saveSchedule({ emails: ['ok@acme.com', 'nope'] }), /not an email/);
  await assert.rejects(saveSchedule({ time: '25:00' }), /HH:MM/);
  const s = await saveSchedule({ enabled: true, emails: ['Boss@Acme.com'], webhooks: [{ kind: 'slack', url: 'https://hooks.slack.com/services/T/B/secret' }], weekday: 5, time: '16:00' });
  assert.deepEqual(s.emails, ['boss@acme.com']);
  assert.ok(!JSON.stringify(publicSchedule(s)).includes('secret'));
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('192.168.0.9'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('the schedule: weekly slots, first-weekday monthly slots, in the plan zone', () => {
  const fri = lastSlot({ kind: 'last7', weekday: 5, time: '16:00' }, new Date('2026-11-06T17:00:00Z'), 'UTC');
  assert.equal(fri.toISOString(), '2026-11-06T16:00:00.000Z');
  const before = lastSlot({ kind: 'last7', weekday: 5, time: '16:00' }, new Date('2026-11-06T15:00:00Z'), 'UTC');
  assert.equal(before.toISOString(), '2026-10-30T16:00:00.000Z');
  const monthly = lastSlot({ kind: 'lastMonth', weekday: 1, time: '09:00' }, new Date('2026-11-20T10:00:00Z'), 'Europe/London');
  assert.equal(monthly.toISOString(), '2026-11-02T09:00:00.000Z', 'first Monday of November');
});

test('sending: one email to everyone with the PDF attached, chat webhooks in their own shape, logged and capped', async () => {
  const smtp = await fakeSmtp({ auth: true, reject: 'ghost@' });
  process.env.SHIPCAST_ALLOW_PRIVATE_WEBHOOKS = '1';
  try {
    await saveSmtp({ host: '127.0.0.1', port: smtp.port, secure: false, from: 'Acme <r@acme.com>', user: 'r', pass: 'pw' });
    await savePost({ title: 'Launch', status: 'published', at: new Date(Date.now() - 86_400_000).toISOString(), channels: [{ channel: 'linkedin', caption: 'x', hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: new Date(Date.now() - 86_400_000).toISOString() }] });
    const r = await createReport({ kind: 'last7', ask: null });
    const posted: { url: string; body: any }[] = [];
    setDeliverFetch((async (url: string, init: RequestInit) => (posted.push({ url, body: JSON.parse(String(init.body)) }), new Response('ok'))) as typeof fetch);
    await saveSchedule({ emails: ['boss@acme.com', 'team@acme.com'], webhooks: [{ kind: 'slack', url: 'https://hooks.slack.com/services/T/B/x' }, { kind: 'generic', url: 'http://127.0.0.1:9/hook' }] });
    const out = await sendReport(r.id, { pdf: async () => Buffer.from('%PDF-1.4 fake') });
    assert.deepEqual(out.failed, []);
    assert.deepEqual(out.sent, ['boss@acme.com', 'team@acme.com', 'slack (hooks.slack.com)', 'generic (127.0.0.1)']);
    assert.equal(smtp.got.length, 1, 'one message');
    assert.equal(smtp.got[0].to.length, 2);
    assert.equal(smtp.got[0].auth, '\0r\0pw');
    assert.match(smtp.got[0].data, /application\/pdf/);
    assert.equal(posted[0].body.blocks[0].type, 'header');
    assert.equal(posted[1].body.headline, r.headline);
    assert.equal((await getReport(r.id))!.status, 'sent');
    assert.ok((await getReport(r.id))!.sentAt);

    // A refused recipient fails the email (and says why); webhooks still go.
    await saveSchedule({ emails: ['ghost@acme.com'], webhooks: [] });
    const bad = await sendReport(r.id, { pdf: async () => Buffer.from('x') });
    assert.match(bad.failed[0].error, /refused the recipient ghost@acme.com \(550\)/);
    assert.equal((webhookPayload('discord', r) as any).embeds[0].title, r.title);
    assert.equal((webhookPayload('teams', r) as any).attachments[0].content.type, 'AdaptiveCard');
  } finally {
    smtp.close();
    setDeliverFetch(null);
    delete process.env.SHIPCAST_ALLOW_PRIVATE_WEBHOOKS;
  }
});

test('the scheduled tick: review first by default, auto-send when asked, once per slot', async () => {
  const sends: string[] = [];
  const notes: string[] = [];
  await saveSchedule({ enabled: true, kind: 'last7', weekday: 5, time: '16:00', mode: 'review', emails: ['boss@acme.com'], webhooks: [] });
  const fri = new Date('2026-11-06T16:30:00Z');
  const deps = { now: fri, ask: null, notify: async (t: string) => void notes.push(t), send: (async (id: string) => (sends.push(id), { sent: ['x'], failed: [] })) as any };
  const first = await reportTick(deps);
  assert.ok(first?.made);
  assert.deepEqual(sends, [], 'review first: nothing sent');
  assert.deepEqual(notes, ['Your report is ready']);
  assert.equal(await reportTick(deps), undefined, 'not twice for one slot');
  await saveSchedule({ mode: 'auto' });
  const next = await reportTick({ ...deps, now: new Date('2026-11-13T16:05:00Z') });
  assert.deepEqual(sends, [next!.made]);
  assert.ok((await readSchedule()).lastRun);
  await saveSchedule({ enabled: false });
  assert.equal(await reportTick({ ...deps, now: new Date('2026-11-20T16:05:00Z') }), undefined);
});

test('chat messages carry no live mentions or links from post titles', async () => {
  const r = await createReport({ kind: 'last7', ask: null });
  const evil = { ...r, headline: 'Launch <!channel> <https://evil.com|click> @everyone' };
  const slack = JSON.stringify(webhookPayload('slack', evil));
  assert.ok(!slack.includes('<!channel>') && slack.includes('&lt;!channel&gt;'));
  const discord = webhookPayload('discord', evil) as any;
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  assert.ok(!discord.content.includes('@everyone'));
});
