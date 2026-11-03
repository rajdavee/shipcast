/**
 * Subsequence match with a bonus for runs and word starts, so "pmm" finds
 * "Plan my month" and "lib" ranks Library above "Publish it". null = no match.
 */
export function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0, ti = 0, run = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    run = at === ti ? run + 1 : 0;
    score += 1 + run * 2 + (at === 0 || /[\s/·-]/.test(t[at - 1]) ? 3 : 0) - Math.min(at - ti, 4) * 0.25;
    ti = at + 1;
  }
  return score - t.length * 0.01;
}
