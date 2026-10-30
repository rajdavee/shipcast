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
