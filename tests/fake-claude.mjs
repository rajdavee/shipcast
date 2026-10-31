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

if (process.env.FAKE_CLAUDE_MODE === 'fail') {
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', session_id: session });
  process.exit(1);
}
if (process.env.FAKE_CLAUDE_MODE === 'hang') {
  setInterval(() => {}, 1000);
} else {
  if (prompt.includes('shipcast:brief')) {
    writeFileSync('brief.md', '# Brief\n');
    writeFileSync('brand.json', '{"name":"Test"}\n');
  } else {
    mkdirSync('out/slides', { recursive: true });
    writeFileSync('out/slides/slide-01.png', 'png');
    writeFileSync('out/carousel.pdf', 'pdf');
    writeFileSync('out/copy.md', '# Copy');
    writeFileSync('out/copy.json', JSON.stringify({ linkedin: [{ label: 'Story', text: 'A short, specific hook.\n\nBody.' }] }));
    writeFileSync('out/NOTES.md', prompt.includes('Revision request') ? 'revised' : 'first');
  }
  emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.01, duration_ms: 5, session_id: session });
}
