import { CAPTION_RULES } from '@shipcast/engine';

export interface Word {
  text: string;
  start: number;
  end: number;
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/**
 * We always know the script we synthesized, so instead of trusting ASR text
 * we align ASR timings onto the script's own words: spelling, casing and
 * punctuation come from the script (brand names stay right), timings from
 * the recognizer. Unmatched script words are interpolated between neighbours.
 */
export function alignScript(script: string, asr: Word[]): Word[] {
  const words = script.split(/\s+/).filter(Boolean);
  const a = words.map(norm);
  const b = asr.map((w) => norm(w.text));
  // LCS table over normalized tokens.
  const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: (Word | null)[] = words.map(() => null);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] && a[i] === b[j]) {
      out[i] = { text: words[i], start: asr[j].start, end: asr[j].end };
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  // Fill gaps by spreading them across the time between known neighbours.
  const total = asr.length ? asr[asr.length - 1].end : words.length * 0.35;
  for (let i = 0; i < out.length; ) {
    if (out[i]) {
      i++;
      continue;
    }
    let k = i;
    while (k < out.length && !out[k]) k++;
    const t0 = i > 0 ? out[i - 1]!.end : 0;
    const t1 = k < out.length ? out[k]!.start : total;
    const step = Math.max((t1 - t0) / (k - i), 0.05);
    for (let x = i; x < k; x++) out[x] = { text: words[x], start: t0 + step * (x - i), end: t0 + step * (x - i + 1) };
    i = k;
  }
  return out as Word[];
}

/**
 * Group words into caption cues: break on sentence punctuation, keep chunks
 * to ≤ maxWords and ≤ maxChars, and never let a cue flash shorter than the
 * readable minimum.
 */
export function buildCues(words: Word[], { maxWords = 3, maxChars = 28 } = {}): Word[] {
  const cues: Word[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ text: cur.map((w) => w.text).join(' '), start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (const w of words) {
    const len = cur.map((x) => x.text).join(' ').length + w.text.length + 1;
    if (cur.length >= Math.min(maxWords, CAPTION_RULES.maxWordsPerChunk) || len > maxChars) flush();
    cur.push(w);
    if (/[.!?…]["')\]]?$/.test(w.text) || (/[,;:—]$/.test(w.text) && cur.length >= 2)) flush();
  }
  flush();
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const minEnd = cues[i].start + CAPTION_RULES.minSeconds;
    if (cues[i].end < minEnd) cues[i].end = next ? Math.min(minEnd, next.start) : minEnd;
  }
  return cues;
}

const ts = (s: number, sep: ',' | '.') => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};

export const toSrt = (cues: Word[]) => cues.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${c.text}\n`).join('\n');
export const toVtt = (cues: Word[]) => 'WEBVTT\n\n' + cues.map((c) => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${c.text}\n`).join('\n');
