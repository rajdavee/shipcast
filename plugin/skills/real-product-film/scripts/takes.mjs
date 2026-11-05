#!/usr/bin/env node
// Record real product takes from a plan, at normal speed, with tap and mark logs.
//
//   node takes.mjs plan.json            record every take in the plan
//   node takes.mjs signin <url>         open a visible window for the user to sign in once
//   node takes.mjs sessions             list saved sign-ins (hosts only)
//   node takes.mjs forget <host>        delete a saved sign-in
//
// plan.json:
// {
//   "url": "https://app.example.com",          // base for relative gotos
//   "signedIn": true,                          // reuse the sign-in saved with `signin`
//   "takes": [
//     { "name": "coach-nominate", "viewport": "phone", "steps": [
//         { "goto": "/coach" }, { "mark": "open" },
//         { "tap": { "role": "button", "name": "Nominate" } }, { "mark": "pick" },
//         { "select": { "label": "Player" }, "value": "Sam Lee" },
//         { "scrollTo": { "text": "Confirm" } }, { "wait": 800 } ] },
//     { "name": "ops-queue", "viewport": "desktop", "steps": [ { "goto": "/ops" }, { "wait": 1500 } ] }
//   ],
//   "out": "out/takes"
// }
// Targets: { role, name } | { text } | { label } | { css }, plus "nth". A name like "/^save/i" is a pattern.
// Also: { "upload": { "label": "Data file" }, "files": ["work/stats.csv"] } attaches a file (hidden inputs too),
// and { "redact": ["jane@real-domain.com", "Real Person"] } blurs that text for the rest of the take: put it first
// whenever a screen lists real people's names or emails.
// Writes <name>.mp4 and <name>.json ({ marks, taps }) per take; prints one JSON line each.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sessions, takes } from './_engine.mjs';

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'signin') {
  if (!arg) throw new Error('usage: takes.mjs signin <url>');
  console.log('A Chrome window is open. Sign in, then close the window.');
  const r = await sessions.openSignInWindow(arg);
  console.log(JSON.stringify({ signedIn: r.host, closed: r.closed }));
} else if (cmd === 'sessions') {
  console.log(JSON.stringify((await sessions.listSessions()).map(({ host, updatedAt }) => ({ host, updatedAt }))));
} else if (cmd === 'forget') {
  console.log(JSON.stringify({ forgot: await sessions.forgetSession(arg) }));
} else {
  if (!cmd) throw new Error('usage: takes.mjs plan.json | signin <url> | sessions | forget <host>');
  const plan = JSON.parse(readFileSync(cmd, 'utf8'));
  const out = resolve(plan.out ?? 'out/takes');
  mkdirSync(out, { recursive: true });
  const profileDir = plan.signedIn ? await sessions.sessionProfileDir(plan.url) : undefined;
  const abs = (u) => new URL(u, plan.url).href;
  for (const t of plan.takes ?? []) {
    if (!/^[\w-]{1,60}$/.test(t.name ?? '')) throw new Error(`take names are letters, digits and dashes: ${t.name}`);
    const steps = t.steps.map((s) => (s.goto ? { ...s, goto: abs(s.goto) } : s));
    const first = steps.find((s) => s.goto)?.goto ?? plan.url;
    const log = await takes.recordTake({ url: first, viewport: t.viewport ?? 'phone', steps, out: join(out, `${t.name}.mp4`), profileDir });
    console.log(JSON.stringify({ take: t.name, file: join(out, `${t.name}.mp4`), seconds: log.seconds, marks: log.marks.map((m) => m.label), taps: log.taps.length }));
  }
}
