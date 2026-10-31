/**
 * Procedural music beds and sound effects. Deterministic (seeded), license
 * free, no downloads. Not a replacement for a composer — a tasteful,
 * mix-ready bed that sits under a voiceover and gives cuts a beat to land on.
 *
 * Signal chain per bed: chord pads (detuned saws → lowpass, slow attack),
 * sub bass (root, sidechained), drums (kick / clap / hats), optional arp,
 * then a Schroeder reverb on pads+arp, soft-clip, normalize.
 */

export const SR = 44100;

export type Mood = 'uplifting' | 'tech' | 'chill' | 'energetic' | 'cinematic' | 'playful';

interface MoodDef {
  bpm: number;
  /** Semitone offset of the key from A (A minor / C major family). */
  key: number;
  /** Chords as scale degrees in a natural-minor/major frame: [root semitones from key, quality]. */
  progression: [number, 'maj' | 'min'][];
  drums: 'four' | 'half' | 'none' | 'break';
  arp: boolean;
  bright: number;
}

export const MOODS: Record<Mood, MoodDef> = {
  uplifting: { bpm: 112, key: 3, progression: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']], drums: 'four', arp: true, bright: 0.75 },
  tech: { bpm: 120, key: 0, progression: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']], drums: 'four', arp: true, bright: 0.6 },
  chill: { bpm: 88, key: 5, progression: [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']], drums: 'half', arp: false, bright: 0.45 },
  energetic: { bpm: 128, key: 2, progression: [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, 'maj']], drums: 'four', arp: true, bright: 0.85 },
  cinematic: { bpm: 90, key: 0, progression: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']], drums: 'none', arp: false, bright: 0.4 },
  playful: { bpm: 104, key: 7, progression: [[0, 'maj'], [5, 'maj'], [9, 'min'], [7, 'maj']], drums: 'break', arp: true, bright: 0.8 },
};

/** Small seeded PRNG (mulberry32) — same seed, same track. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function chordNotes(root: number, q: 'maj' | 'min'): number[] {
  return [root, root + (q === 'maj' ? 4 : 3), root + 7, root + 12];
}

/** One-pole lowpass, in place. */
function lowpass(buf: Float32Array, cutoff: number) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i] - y);
    buf[i] = y;
  }
}

/** Schroeder reverb (4 combs + 2 allpasses). */
function reverb(input: Float32Array, mix = 0.25, size = 1): Float32Array {
  const out = new Float32Array(input.length);
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round(d * size));
  for (const d of combs) {
    const buf = new Float32Array(d);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < input.length; i++) {
      const y = buf[idx];
      lp = y * 0.8 + lp * 0.2;
      buf[idx] = input[i] + lp * 0.82;
      out[i] += y * 0.25;
      idx = (idx + 1) % d;
    }
  }
  for (const d of [225, 556]) {
    const buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const b = buf[idx];
      const x = out[i];
      const y = -x + b;
      buf[idx] = x + b * 0.5;
      out[i] = y;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < input.length; i++) out[i] = input[i] * (1 - mix) + out[i] * mix;
  return out;
}

export interface MusicOptions {
  mood: Mood;
  seconds: number;
  bpm?: number;
  seed?: number;
  /** Seconds at which to place a short build-and-hit (scene cuts). */
  accents?: number[];
}

export interface Track {
  left: Float32Array;
  right: Float32Array;
  bpm: number;
  beat: number;
}

export function makeMusic(o: MusicOptions): Track {
  const m = MOODS[o.mood] ?? MOODS.uplifting;
  const bpm = o.bpm ?? m.bpm;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const n = Math.ceil((o.seconds + 2) * SR);
  const rand = rng(o.seed ?? 7);
  const pads = new Float32Array(n);
  const bass = new Float32Array(n);
  const drums = new Float32Array(n);
  const arp = new Float32Array(n);
  const base = 45 + m.key; // A2 + key

  // Pads: two bars per chord, detuned saws with slow attack/release.
  const chordLen = bar * 2;
  for (let c = 0; c * chordLen < o.seconds + 2; c++) {
    const [deg, q] = m.progression[c % m.progression.length];
    const notes = chordNotes(base + 12 + deg, q);
    const s0 = Math.floor(c * chordLen * SR);
    const len = Math.floor(chordLen * SR);
    for (const note of notes) {
      for (const det of [-0.07, 0.07]) {
        const f = hz(note + det);
        let ph = rand();
        for (let i = 0; i < len && s0 + i < n; i++) {
          const t = i / SR;
          const env = Math.min(1, t / 0.6) * Math.min(1, (chordLen - t) / 0.4);
          ph += f / SR;
          pads[s0 + i] += ((ph % 1) * 2 - 1) * env * 0.035;
        }
      }
    }
    // Sub bass on the root, eighth-note pulse.
    const bf = hz(base + deg);
    for (let k = 0; k < 16; k++) {
      const st = s0 + Math.floor(k * (beat / 2) * SR);
      const len2 = Math.floor(beat * 0.45 * SR);
      let ph = 0;
      for (let i = 0; i < len2 && st + i < n; i++) {
        ph += bf / SR;
        const env = Math.exp((-i / SR) * 6);
        bass[st + i] += Math.sin(2 * Math.PI * ph) * env * 0.32 + Math.sin(4 * Math.PI * ph) * env * 0.06;
      }
    }
    // Arp: 16ths over the chord tones, up two octaves.
    if (m.arp) {
      for (let k = 0; k < 32; k++) {
        const note = notes[[0, 1, 2, 3, 2, 1][k % 6]] + 12;
        const st = s0 + Math.floor(k * (beat / 4) * SR);
        const len2 = Math.floor(beat * 0.22 * SR);
        let ph = 0;
        const f = hz(note);
        for (let i = 0; i < len2 && st + i < n; i++) {
          ph += f / SR;
          const env = Math.exp((-i / SR) * 18);
          arp[st + i] += (Math.abs(((ph % 1) * 4) - 2) - 1) * env * 0.05;
        }
      }
    }
  }
  // Two passes = 12 dB/oct: warm pads, no fizz.
  lowpass(pads, 900 + 2600 * m.bright);
  lowpass(pads, 1200 + 3000 * m.bright);
  lowpass(arp, 3500 + 3000 * m.bright);
  lowpass(bass, 380);
  lowpass(bass, 420);

  // Drums.
  const kickAt: number[] = [];
  const total = o.seconds + 2;
  for (let b = 0; b * beat < total; b++) {
    const t = b * beat;
    const inBar = b % 4;
    const kick = m.drums === 'four' || (m.drums === 'half' && inBar % 2 === 0) || (m.drums === 'break' && (inBar === 0 || inBar === 2.5 || inBar === 3));
    if (kick && m.drums !== 'none') {
      kickAt.push(t);
      const st = Math.floor(t * SR);
      for (let i = 0; i < 0.35 * SR && st + i < n; i++) {
        const tt = i / SR;
        const f = 50 + 110 * Math.exp(-tt * 30);
        drums[st + i] += Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 9) * 0.55;
      }
    }
    if (m.drums !== 'none' && (inBar === 1 || inBar === 3)) {
      const st = Math.floor(t * SR);
      for (let i = 0; i < 0.18 * SR && st + i < n; i++) drums[st + i] += (rand() * 2 - 1) * Math.exp((-i / SR) * 22) * (m.drums === 'half' ? 0.1 : 0.16);
    }
    if (m.drums === 'four' || m.drums === 'break') {
      for (const off of [0.5, 0.25, 0.75]) {
        const st = Math.floor((t + off * beat) * SR);
        const amp = off === 0.5 ? 0.06 : 0.025;
        let hp = 0;
        let prev = 0;
        for (let i = 0; i < 0.05 * SR && st + i < n; i++) {
          const x = rand() * 2 - 1;
          hp = 0.9 * (hp + x - prev);
          prev = x;
          drums[st + i] += hp * Math.exp((-i / SR) * 70) * amp;
        }
      }
    }
  }

  // Sidechain: pads/bass/arp duck on every kick (the "pump").
  const duck = new Float32Array(n).fill(1);
  for (const t of kickAt) {
    const st = Math.floor(t * SR);
    for (let i = 0; i < 0.3 * SR && st + i < n; i++) duck[st + i] = Math.min(duck[st + i], 1 - 0.55 * Math.exp((-i / SR) * 9));
  }

  const wetPads = reverb(pads, 0.3, 1);
  const wetArp = reverb(arp, 0.35, 0.8);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = wetPads[i] * duck[i];
    const a = wetArp[i] * duck[i];
    const lfo = Math.sin((2 * Math.PI * i) / (SR * bar * 2));
    const mono = bass[i] * duck[i] + drums[i];
    left[i] = Math.tanh((mono + p * (1 + 0.15 * lfo) + a * 0.8) * 0.9);
    right[i] = Math.tanh((mono + p * (1 - 0.15 * lfo) + a * 1.1) * 0.9);
  }
  // Master air cut (~10 kHz) keeps the bed out of the voice's sibilance range.
  lowpass(left, 10000);
  lowpass(right, 10000);
  // 1.5 s fade in, 2 s fade out.
  const fadeOut = Math.floor((o.seconds - 2) * SR);
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / (1.5 * SR)) * (i > fadeOut ? Math.max(0, 1 - (i - fadeOut) / (2 * SR)) : 1);
    left[i] *= g;
    right[i] *= g;
  }
  return { left: left.subarray(0, Math.ceil(o.seconds * SR)), right: right.subarray(0, Math.ceil(o.seconds * SR)), bpm, beat };
}

export type Sfx = 'whoosh' | 'pop' | 'tick' | 'riser' | 'impact';

/** Short transition sounds, placed so their peak lands on `at`. */
export function addSfx(track: Track, kind: Sfx, at: number, gain = 0.5, seed = 1) {
  const rand = rng(seed);
  const pre = kind === 'whoosh' ? 0.35 : kind === 'riser' ? 1.2 : 0;
  const len = kind === 'whoosh' ? 0.6 : kind === 'riser' ? 1.3 : kind === 'impact' ? 0.9 : 0.12;
  const st = Math.floor((at - pre) * SR);
  let lp = 0;
  for (let i = 0; i < len * SR; i++) {
    const idx = st + i;
    if (idx < 0 || idx >= track.left.length) continue;
    const t = i / SR;
    let v = 0;
    if (kind === 'whoosh' || kind === 'riser') {
      const peak = pre;
      const env = t < peak ? (t / peak) ** 2 : Math.exp(-(t - peak) * 10);
      const cut = 0.02 + 0.3 * (t < peak ? t / peak : 1);
      lp += cut * ((rand() * 2 - 1) - lp);
      v = lp * env * 1.6;
    } else if (kind === 'pop') {
      v = Math.sin(2 * Math.PI * (600 + 900 * Math.exp(-t * 40)) * t) * Math.exp(-t * 35);
    } else if (kind === 'tick') {
      v = (rand() * 2 - 1) * Math.exp(-t * 300) + Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 120) * 0.4;
    } else if (kind === 'impact') {
      v = Math.sin(2 * Math.PI * (45 + 60 * Math.exp(-t * 12)) * t) * Math.exp(-t * 4) + (rand() * 2 - 1) * Math.exp(-t * 25) * 0.3;
    }
    const pan = kind === 'whoosh' ? Math.min(1, t / Math.max(len, 0.01)) : 0.5;
    track.left[idx] += v * gain * (1.2 - pan * 0.4);
    track.right[idx] += v * gain * (0.8 + pan * 0.4);
  }
}

/** 16-bit PCM stereo WAV. */
export function toWav(t: Track): Buffer {
  const n = t.left.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(t.left[i]), Math.abs(t.right[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(t.left[i] * g * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(t.right[i] * g * 32767))), 46 + i * 4);
  }
  return buf;
}
