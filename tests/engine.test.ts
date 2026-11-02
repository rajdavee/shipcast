import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, globToRegExp, loadPacks, parseRepo, parseStreamLine, renderTemplate, summarizeTool, validatePack } from '@shipcast/engine';

test('renderTemplate substitutes, drops empty sections, and includes partials', () => {
  const out = renderTemplate('A {{x}}{{#y}} has {{y}}{{/y}}{{#z}} never{{/z}}.\n{{> p}}', { x: '1', y: '2', z: '' }, { p: 'PARTIAL' });
  assert.equal(out, 'A 1 has 2.\nPARTIAL');
});

test('globToRegExp handles **, * and braces', () => {
  assert.ok(globToRegExp('out/**').test('out/a/b.png'));
  assert.ok(globToRegExp('out/slides/*.png').test('out/slides/s1.png'));
  assert.ok(!globToRegExp('out/slides/*.png').test('out/slides/x/s1.png'));
  assert.ok(globToRegExp('out/**/*.{mp4,jpg}').test('out/poster.jpg'));
  assert.ok(globToRegExp('out/**/*.{mp4,jpg}').test('out/a/v.MP4'));
});

test('parseRepo accepts owner/repo and URLs', () => {
  assert.equal(parseRepo('rajdavee/shipcast'), 'rajdavee/shipcast');
  assert.equal(parseRepo('https://github.com/a/b.git'), 'a/b');
  assert.equal(parseRepo('git@github.com:a/b'), 'a/b');
  assert.equal(parseRepo('not a repo'), null);
});

test('parseStreamLine maps stream-json to events', () => {
  assert.deepEqual(parseStreamLine('{"type":"system","subtype":"init","session_id":"s1","model":"m"}'), [{ kind: 'init', sessionId: 's1', model: 'm' }]);
  const ev = parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: ' hi ' }, { type: 'tool_use', name: 'WebFetch', input: { url: 'https://x.dev' } }] } }));
  assert.deepEqual(ev, [{ kind: 'text', text: 'hi' }, { kind: 'tool', tool: 'WebFetch', summary: 'https://x.dev' }]);
  const r = parseStreamLine('{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0.5,"session_id":"s1"}')[0];
  assert.equal(r.kind, 'result');
  assert.equal(parseStreamLine('not json').length, 0);
});

test('summarizeTool prefers descriptions and file names', () => {
  assert.equal(summarizeTool('Bash', { command: 'ffmpeg -i a b', description: 'Render video' }), 'Render video');
  assert.equal(summarizeTool('Write', { file_path: '/a/b/c/out.md' }), 'c/out.md');
});

test('buildArgs blocks sub-agents unless the pack needs them', () => {
  const base = { prompt: 'p', allowedTools: ['Read', 'Bash'] };
  const a = buildArgs(base);
  assert.equal(a[a.indexOf('--disallowedTools') + 1], 'Task,Agent');
  const b = buildArgs({ ...base, allowSubagents: true, resume: 's1', pluginDir: '/x' });
  assert.ok(!b.includes('--disallowedTools'));
  assert.equal(b[b.indexOf('--allowedTools') + 1], 'Read,Bash,Task,Agent');
  assert.equal(b[b.indexOf('--resume') + 1], 's1');
  assert.equal(b[b.indexOf('--plugin-dir') + 1], '/x');
});

test('every bundled pack is valid and renders without leftover tags', async () => {
  const packs = await loadPacks(true);
  assert.ok(packs.length >= 8);
  const ids = new Set();
  for (const p of packs) {
    assert.deepEqual(validatePack(p, p.id), []);
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
    const vars = Object.fromEntries(p.options.map((o) => [o.key, o.default]));
    const out = renderTemplate(p.prompt, { ...vars, source: 'a/b' });
    assert.ok(!/\{\{/.test(out), `${p.id} left a template tag`);
    for (const s of p.skills) assert.match(s.source, /^[\w.-]+\/[\w.-]+$/);
  }
});

test('parseUsageReset reads Claude usage-limit messages and ignores other errors', async () => {
  const { parseUsageReset } = await import('@shipcast/engine');
  const now = new Date('2026-11-01T10:00:00').getTime();
  assert.equal(parseUsageReset('API Error: overloaded', now), null);
  assert.equal(parseUsageReset('Claude AI usage limit reached|1793541600', now), 1793541600 * 1000);
  const pm = new Date(parseUsageReset('5-hour limit reached ∙ resets 3pm', now)!);
  assert.equal(pm.getHours(), 15);
  const am = new Date(parseUsageReset('Your limit will reset at 9:30 AM', now)!);
  assert.ok(am.getTime() > now && am.getHours() === 9 && am.getMinutes() === 30, 'next 9:30, tomorrow');
  assert.equal(parseUsageReset('usage limit reached|1000000000', now), now + 5 * 60_000, 'a past reset still waits a little');
});

test('pickStep: brief first, questions pause, hub last, and only non-Claude steps while limited', async () => {
  const { pickStep } = await import('@shipcast/engine');
  const s = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'pack', pack: id, options: {}, status: 'queued', outputs: [], revisions: [], ...extra }) as any;
  const brief = { id: 'brief', kind: 'brief', options: {}, status: 'done', outputs: [], revisions: [] } as any;
  const c = (steps: any[]) => ({ id: 'c', steps }) as any;
  assert.equal((pickStep(c([brief, s('campaign-hub'), s('reel')])) as any).id, 'reel');
  assert.equal(pickStep(c([brief, s('reel'), s('x', { status: 'needs-input' })])), null);
  assert.equal(pickStep(c([brief, s('reel', { notBefore: new Date(Date.now() + 60_000).toISOString() })])), null);
  assert.equal(pickStep(c([brief, s('reel')]), false), null, 'Claude step waits during a usage pause');
  assert.equal((pickStep(c([brief, s('reel'), s('carousel', { renderOnly: true })]), false) as any).id, 'carousel', 're-renders keep going');
  assert.equal(pickStep(c([{ ...brief, status: 'queued' }]), false), null);
});

test('spawnCollect settles even when a child ignores SIGTERM, and kills its group', async () => {
  const { spawnCollect } = await import('@shipcast/engine');
  const t0 = Date.now();
  const r = await spawnCollect('bash', ['-c', 'trap "" TERM; (trap "" TERM; sleep 60) & sleep 60'], { timeoutMs: 300 });
  assert.notEqual(r.code, 0);
  assert.ok(Date.now() - t0 < 12_000);
  assert.equal((await spawnCollect('echo', ['hi'])).stdout.trim(), 'hi');
});

test('campaign env: .env text parses, writes are private, and scrubSecrets redacts values', async () => {
  const { parseEnvText, scrubSecrets } = await import('@shipcast/engine');
  assert.deepEqual(parseEnvText('# c\nA=1\nexport B="two words"\nC=\'x=y\'\n bad line\n'), { A: '1', B: 'two words', C: 'x=y' });
  const { mkdtempSync, writeFileSync, readFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const d = mkdtempSync(join(tmpdir(), 'scrub-'));
  mkdirSync(join(d, 'out'));
  writeFileSync(join(d, 'out', 'log.md'), 'key sk_test_abcdef1234 and short 123');
  await scrubSecrets(d, { KEY: 'sk_test_abcdef1234', SHORT: '123' });
  const t = readFileSync(join(d, 'out', 'log.md'), 'utf8');
  assert.ok(!t.includes('sk_test_abcdef1234') && t.includes('123'), 'long values redacted, tiny ones left alone');
});

test('media.mjs refuses explicit prompts and explains missing keys', async () => {
  const { spawnCollect } = await import('@shipcast/engine');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'media-'));
  const cli = join(import.meta.dirname, '..', 'plugin', 'skills', 'director', 'scripts', 'media.mjs');
  const env = { ...process.env, SHIPCAST_HOME: home };
  const bad = await spawnCollect('node', [cli, 'gen', 'image', 'a nude portrait'], { env });
  assert.equal(bad.code, 3);
  assert.match(bad.stderr, /sexual or explicit/);
  const nokey = await spawnCollect('node', [cli, 'stock', 'video', 'ocean waves'], { env });
  assert.equal(nokey.code, 2);
  assert.match(nokey.stderr, /Pixabay/);
  const st = JSON.parse((await spawnCollect('node', [cli, 'status'], { env })).stdout);
  assert.equal(st.generative.available, false);
  assert.ok(st.always.length >= 5);
});
