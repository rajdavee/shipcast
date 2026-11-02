---
name: cartoon-kit
description: Shipcast's original 2D cartoon kit for HyperFrames — rigged characters (kid, robot, cat, dog, fox, dragon, blob, elder, bird) that emote, talk, walk, run, jump, fly, wave, point and hug; illustrated parallax worlds (bedroom, classroom, kitchen, street, park, city at night, sky, floating islands, forest, mountains, beach, underwater, space, battlefield); and effects (portal door, sparkles, glow aura, energy orb, explosion, speed lines, rain, hearts, confetti, smoke, light rays, magic trail). Use for stories, kids' content, comedy sketches, explainers with characters — any shot where characters act.
---

# Cartoon kit

One script, `kit.js` in this folder: copy it into your HyperFrames project
(`assets/kit.js`) and load it before your composition script. It only adds
GSAP tweens to the timeline you pass in and uses seeded randomness, so every
frame renders identically.

## API

```js
const K = window.CartoonKit;
svg.innerHTML =
  K.world('bedroom', { w: 1920, h: 1080, time: 'evening', id: 'room' }) +       // time: day|evening|dusk|night|dawn
  K.character({ id: 'kid', kind: 'kid', x: 760, y: 900, scale: 1,               // x,y = feet on the ground
                palette: { body: '#f59e0b', accent: '#1d4ed8', hair: '#3f2a1d', skin: '#f3c39b' } }) +
  K.character({ id: 'bot', kind: 'robot', x: 1700, y: 900 }) +
  K.fx('portal-door', { id: 'door', x: 1280, y: 900 });

const tl = gsap.timeline({ paused: true });
K.parallax(tl, '#room', 0, { dur: 8, dx: -40 });           // backgrounds never sit still
K.act(tl, '#kid', 'emote', 0.2, { emotion: 'cry', dur: 2.5 });
K.act(tl, '#bot', 'enter', 1.2, { from: 'right', dur: 1.4 });
K.act(tl, '#bot', 'talk', 2.8, { dur: 1.6 });               // or { words: [{start,end},…] } from the voice line
K.act(tl, '#kid', 'emote', 4.4, { emotion: 'surprised' });
K.play(tl, '#door', 'portal-door', 5.0, { dur: 2 });
K.camera(tl, '#stage', 'push', 5.0, { to: 1.12, dur: 2.5, origin: '67% 70%' });
```

- **Actions**: `idle`, `blink`, `emote` (happy, laugh, sad, cry, surprised,
  angry, worried, excited, neutral), `talk`, `walk`/`run` (`by` px), `jump`
  (`height`), `fly` (`path: [[dx,dy],…]` relative to the start), `wave`,
  `point` (`up`), `hug`, `turn` (`face: left|right`), `look` (`dir`),
  `enter` (`from: left|right|bottom|pop`), `exit` (`to`), `shake`, `bounce`, `float`.
  Layer them: an `idle` under everything, `blink` every 2–4 s, emotions on
  story beats.
- **Worlds**: `K.worlds`. Each has `.ck-far/.ck-mid/.ck-near` layers; use
  `parallax` and push/pan the wrapping element for camera moves. Two worlds
  in one scene = cross-fade between them (e.g. room → floating islands
  through the door).
- **Effects**: `K.effects`, placed with `fx(kind, {id, x, y, scale, color})`,
  animated with `play(tl, '#id', kind, at, {dur})`.
- **Camera**: `camera(tl, '#stage', 'push'|'pan'|'shake'|'tilt', at, opts)`
  on a group that wraps the world and characters.

## Make it look directed

- Establish (wide) → react (closer push-in on the face) → action (pan with
  the character) → payoff (wide again). Cut between scenes with a whip or a
  glow flash.
- Every character always has `idle` running and blinks; nobody is frozen.
- Emotions read from brows + mouth + body: pair `emote` with a gesture
  (`cry` + head down, `excited` + `bounce`, `laugh` + `hug`).
- Recolour characters with `palette` so a cast looks designed together, and
  give each a distinct silhouette (kind + scale).
- Sound: a cartoon score, plus a sound on every action (pop on `enter: pop`,
  whoosh on `fly`, sparkle on effects, thud on `jump` landing).

## Rights

These characters are original. When a brief names a famous cartoon
character, keep the role and spirit (a helpful gadget robot, a shy kid) but
change the design — kind, palette, silhouette, name — so it is clearly not
that character.
