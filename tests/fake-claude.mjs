#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: speaks stream-json, writes the
// files a real run would produce, and records its argv for assertions.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'test@example.com' }));
  process.exit(0);
}
const prompt = args[args.indexOf('-p') + 1] ?? '';
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ cwd: process.cwd(), args }) + '\n');
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const session = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'sess-' + Math.random().toString(16).slice(2, 8);

emit({ type: 'system', subtype: 'init', session_id: session, model: 'fake' });
emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it.' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls', description: 'List files' } }] } });
emit({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok', is_error: false }] } });

if (process.env.FAKE_CLAUDE_MODE === 'limit') {
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude AI usage limit reached|' + Math.floor(Date.now() / 1000 + 3600), session_id: session });
  process.exit(1);
}
if (process.env.FAKE_CLAUDE_MODE === 'fail') {
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', session_id: session });
  process.exit(1);
}
if (process.env.FAKE_CLAUDE_MODE === 'hang') {
  setInterval(() => {}, 1000);
} else {
  if (prompt.includes('[shipcast-brainstorm-board]')) {
    const beats = [{ scene: 'kinetic', title: 'Hook', line: 'Your standup could be a voice note.', note: 'open strong', seconds: 3 }, { scene: 'product', title: 'The app', line: 'Record thirty seconds.', note: '', seconds: 4 }, { scene: 'outro', title: 'Try it', line: 'Start free today.', note: '', seconds: 3 }];
    emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(beats), session_id: session });
    process.exit(0);
  }
  if (prompt.includes('[shipcast-brainstorm]')) {
    const answered = prompt.includes('Their answers:');
    const reply = answered
      ? { understood: 'A habit tracker for remote teams.', questions: [], directions: [{ id: 'd1', title: 'The 30-second standup', hook: 'Your standup could be a voice note.', angle: 'Time saved per person per week.', tone: 'warm, direct' }] }
      : { understood: 'A habit tracker for remote teams.', questions: [{ id: 'audience', question: 'Who is it for?', why: 'sets the voice', options: ['Team leads', 'Founders', 'Remote ICs'] }], directions: [] };
    emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(reply), session_id: session });
    process.exit(0);
  }
  const resumed = args.includes('--resume');
  if (prompt.includes('shipcast:app-runner') || (resumed && prompt.includes('The user answered your question'))) {
    mkdirSync('out', { recursive: true });
    if (!resumed && !process.env.TEST_LICENSE_KEY) {
      // Can't start without a key only the user has: ask.
      writeFileSync('out/question.json', JSON.stringify({ text: 'Paste the licence key', why: 'server exits without TEST_LICENSE_KEY', fields: [{ key: 'TEST_LICENSE_KEY', label: 'Licence key', secret: true }] }));
      emit({ type: 'result', subtype: 'success', is_error: false, result: 'NEEDS_INPUT', session_id: session });
      process.exit(0);
    }
    // The key arrived in the environment; a careless log line would leak it — Shipcast must scrub it.
    writeFileSync('out/setup.md', `# Setup\nStarted with key ${process.env.TEST_LICENSE_KEY}\n`);
    writeFileSync('out/app.json', JSON.stringify({ url: 'http://127.0.0.1:9', start: [], stop: [] }));
    emit({ type: 'result', subtype: 'success', is_error: false, result: 'Running.', session_id: session });
    process.exit(0);
  }
  if (prompt.includes('shipcast:campaign-plan')) {
    mkdirSync('out', { recursive: true });
    writeFileSync('out/plan.json', JSON.stringify({ line: 'One line.', assets: [{ pack: 'copy-kit', title: 'Launch copy', brief: 'Short.', options: { voice: 'brand', bogus: 'x' } }, { pack: 'no-such-pack', title: 'Ignored' }], calendar: [] }));
    writeFileSync('out/CAMPAIGN-BRIEF.md', '# Campaign brief\n');
    writeFileSync('out/calendar.md', '# Calendar\n\n| Day | Asset |\n|---|---|\n| 1 | Launch copy |\n');
    emit({ type: 'result', subtype: 'success', is_error: false, result: 'Planned.', session_id: session });
    process.exit(0);
  }
  if (prompt.includes('shipcast:brief')) {
    writeFileSync('brief.md', '# Brief\n');
    writeFileSync('brand.json', '{"name":"Test"}\n');
  } else {
    mkdirSync('out/slides', { recursive: true });
    writeFileSync('out/slides/slide-01.png', 'png');
    writeFileSync('out/carousel.pdf', 'pdf');
    writeFileSync('out/copy.md', '# Copy');
    writeFileSync('out/copy.json', JSON.stringify({ linkedin: [{ label: 'Story', text: 'A short, specific hook that tells you what changes on day one.\n\nBody.' }] }));
    writeFileSync('out/NOTES.md', prompt.includes('Revision request') ? 'revised' : 'first');
  }
  emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.01, duration_ms: 5, session_id: session });
}
