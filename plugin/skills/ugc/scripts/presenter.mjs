#!/usr/bin/env node
// Synthetic presenters for UGC-style ads, through Shipcast's gen and media services.
//
//   node presenter.mjs portrait --who "<a fictional person>" --where "<setting>" --name maya [--aspect 9:16] [--tier standard] [--placeholder]
//   node presenter.mjs say --name maya --line "<what they say>" --id hook [--tier standard] [--placeholder]
//   node presenter.mjs status
//
// Portraits live in work/cast/<name>.png (+ .json with the description, reused for every line so
// the same person appears throughout). Talking clips land in work/clips/<id>.mp4 with their voice.
// Every presenter is synthetic and labelled "AI-generated · synthetic person"; real people are refused.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) argv[i].startsWith('--') ? (flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true) : pos.push(argv[i]);
const GEN = process.env.SHIPCAST_GEN_URL || 'http://127.0.0.1:4324';
const MEDIA = process.env.SHIPCAST_MEDIA_URL || 'http://127.0.0.1:4322';
const API = process.env.SHIPCAST_API_URL || `http://127.0.0.1:${process.env.PORT || 4317}`;
const die = (m, c = 1) => { console.error(JSON.stringify({ error: m })); process.exit(c); };
const campaign = resolve('.').match(/campaigns\/([^/]+)/)?.[1] ?? 'adhoc';
const cast = resolve('work/cast');
const clips = resolve('work/clips');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'presenter';

async function job(base, kind, input) {
  const r = await fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, input }) }).catch(() => null);
  if (!r) die(`The ${base.includes('4324') ? 'gen' : 'media'} service isn't running (shipcast start).`);
  const j = await r.json();
  if (j.status !== 'done') die(j.error || `${kind} failed`, /cap/i.test(j.error || '') ? 5 : 1);
  return j.output;
}

async function portrait() {
  const name = slug(flags.name || 'presenter');
  if (!flags.who) die('--who "<a fictional person: age range, look, clothing, vibe>" is required', 64);
  await mkdir(cast, { recursive: true });
  const aspect = String(flags.aspect || '9:16');
  const shot = {
    subject: `${flags.who}, looking straight into the camera, mouth gently closed, relaxed natural expression, head and shoulders visible`,
    scene: String(flags.where || 'a bright, tidy home office with a plant and a window'),
    framing: aspect === '9:16' ? 'vertical selfie framing, face in the upper third, eyes at one-third height' : 'medium close-up, face centred',
    camera: { lens: 'phone', angle: 'eye' },
    light: 'window',
    look: 'ugc',
    avoid: ['text', 'logos', 'microphone', 'hands covering face', 'sunglasses'],
  };
  const o = await job(GEN, 'generate', { capability: 't2i', shot, aspect, tier: flags.tier || 'standard', ...(flags.placeholder ? { provider: 'fake' } : {}), budgetKey: campaign, out: join(cast, name) });
  await writeFile(join(cast, `${name}.cast.json`), JSON.stringify({ name, who: flags.who, where: flags.where ?? null, aspect, portrait: o.file, synthetic: true, createdAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ name, portrait: o.file, model: o.model, usd: o.usd, disclosure: o.disclosure }));
}

async function voiceId() {
  // Same voice as the rest of the video: the one chosen in Setup → Voiceover.
  const v = await fetch(`${API}/api/voice`).then((r) => r.json()).catch(() => null);
  if (v?.provider === 'elevenlabs' && v.connected && v.voice) return `eleven:${v.voice}:${v.model || 'eleven_multilingual_v2'}`;
  return String(flags.voice || 'af_heart');
}

async function say() {
  const name = slug(flags.name || 'presenter');
  const meta = join(cast, `${name}.cast.json`);
  if (!existsSync(meta)) die(`No presenter "${name}" yet — run: presenter.mjs portrait --name ${name} --who "…"`, 2);
  const c = JSON.parse(readFileSync(meta, 'utf8'));
  if (!flags.line) die('--line "<what they say>" is required', 64);
  const id = slug(flags.id || `line-${Date.now().toString(36)}`);
  await mkdir(clips, { recursive: true });
  const voice = await job(MEDIA, 'voice', { text: String(flags.line), voice: await voiceId(), out: join(clips, `${id}.wav`) });
  const o = await job(GEN, 'generate', {
    capability: 's2v',
    prompt: `${c.who} talking naturally and warmly to the camera like a real customer recording a phone video, small natural head movements, blinking, ${c.where ?? 'at home'}`,
    image: c.portrait,
    audio: voice.file,
    seconds: Math.ceil(voice.duration),
    aspect: c.aspect ?? '9:16',
    tier: flags.tier || 'standard',
    ...(flags.placeholder ? { provider: 'fake' } : {}),
    budgetKey: campaign,
    out: join(clips, id),
  });
  console.log(JSON.stringify({ id, clip: o.file, seconds: +voice.duration.toFixed(2), voiceFile: voice.file, model: o.model, usd: o.usd, disclosure: o.disclosure }));
}

if (pos[0] === 'portrait') await portrait();
else if (pos[0] === 'say') await say();
else if (pos[0] === 'status') console.log(JSON.stringify(await fetch(`${GEN}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'spend', input: { key: campaign } }) }).then((r) => r.json()).then((j) => j.output).catch(() => ({ error: 'gen service not running' }))));
else die('usage: presenter.mjs portrait|say|status …', 64);
