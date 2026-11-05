#!/usr/bin/env node
// Walk a product's views and open its safe controls (never submit, confirm, delete,
// send, pay, save, publish, approve, decline or revoke) to learn what it does.
//
//   node explore.mjs <url> [--views /a,/b] [--desktop] [--signed-in] [--out out/explore]
//
// Writes explore.json and a readable explore.md draft for out/product.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { explore, sessions } from './_engine.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:/.test(a));
if (!url) throw new Error('usage: explore.mjs <url> [--views /a,/b] [--desktop] [--signed-in] [--out dir]');
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const views = opt('--views')?.split(',').map((v) => new URL(v, url).href);
const out = resolve(opt('--out') ?? 'out/explore');
mkdirSync(out, { recursive: true });
const profileDir = args.includes('--signed-in') ? await sessions.sessionProfileDir(url) : undefined;
const r = await explore.exploreProduct({ url, views, viewport: args.includes('--desktop') ? 'desktop' : 'phone', profileDir });
writeFileSync(join(out, 'explore.json'), JSON.stringify(r, null, 1));
writeFileSync(join(out, 'explore.md'), explore.productMarkdown(r));
console.log(JSON.stringify({ views: r.views.length, controls: r.views.reduce((a, v) => a + v.controls.length, 0), md: join(out, 'explore.md') }));
