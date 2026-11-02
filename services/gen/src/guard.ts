/**
 * Safety before spend. Providers run their own checkers too (we always turn
 * them on); this catches what we can refuse with a clear reason, before any
 * money moves: sexual content, anything involving minors in a sexual or
 * harmful frame, and real people's likeness without recorded consent.
 */

const SEXUAL = /\b(nude|naked|nsfw|porn\w*|sexual|sex scene|explicit|erotic\w*|hentai|lingerie|topless|bottomless|genitals?|fetish|onlyfans)\b/i;
const MINOR = /\b(child|children|kid|kids|minor|minors|teen|teens|teenager|schoolgirl|schoolboy|underage|toddler|infant|baby|babies)\b/i;
const DEEPFAKE = /\b(deepfake|face ?swap|look(?:s|ing)? exactly like|clone (?:his|her|their) (?:face|voice)|impersonat\w*)\b/i;
const VIOLENT_REAL = /\b(assassinat\w*|behead\w*|massacre|terror attack|mass shooting)\b/i;

/**
 * Public figures we will not depict. Not exhaustive by design — the providers'
 * own filters back this up — but it covers the names marketers most often try.
 */
const PUBLIC_FIGURES = [
  'taylor swift', 'elon musk', 'donald trump', 'joe biden', 'kamala harris', 'barack obama', 'narendra modi', 'rishi sunak', 'keir starmer', 'emmanuel macron', 'vladimir putin', 'xi jinping',
  'jeff bezos', 'mark zuckerberg', 'bill gates', 'tim cook', 'sundar pichai', 'sam altman', 'satya nadella', 'oprah', 'beyonce', 'beyoncé', 'kim kardashian', 'cristiano ronaldo', 'lionel messi',
  'virat kohli', 'shah rukh khan', 'amitabh bachchan', 'pope francis', 'king charles', 'zendaya', 'tom cruise', 'scarlett johansson', 'keanu reeves', 'mrbeast', 'drake', 'rihanna',
];

export interface GuardInput {
  prompt?: string;
  /** Reference images flagged as showing a real person (cast kits record this). */
  realPerson?: boolean;
  /** Consent record id for that person (from a consent.json the user filled in). */
  consent?: string;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
  /** Things to add to the output's disclosure. */
  disclose?: string[];
}

export function guard(i: GuardInput): GuardResult {
  const p = String(i.prompt ?? '');
  if (SEXUAL.test(p)) return { ok: false, reason: 'Sexual or explicit content is not something Shipcast makes.' };
  if (MINOR.test(p) && /\b(sexy|seductive|revealing|bikini|suggestive|romantic|kiss\w*|bed(room)?)\b/i.test(p)) return { ok: false, reason: 'Children cannot appear in suggestive or romantic scenes.' };
  if (DEEPFAKE.test(p)) return { ok: false, reason: 'Shipcast does not imitate real people (no face swaps, voice clones or look-alikes).' };
  if (VIOLENT_REAL.test(p)) return { ok: false, reason: 'Graphic real-world violence is out of scope for marketing material.' };
  const lower = p.toLowerCase();
  const named = PUBLIC_FIGURES.find((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower));
  if (named) return { ok: false, reason: `A real public figure (${named}) can't be depicted or implied to endorse anything. Describe a fictional person instead.` };
  if (i.realPerson && !i.consent) return { ok: false, reason: 'These reference photos show a real person. Add their signed consent in the cast kit (consent.json) before generating with their likeness.' };
  const disclose = ['AI-generated'];
  // Any human in frame is a synthetic person and gets labelled as one.
  if (/\b(person|people|man|men|woman|women|guy|girl|boy|someone|presenter|founder|ceo|customer|client|actor|model|doctor|nurse|teacher|student|chef|officer|manager|engineer|developer|designer|employee|worker|team|colleague|couple|family|face|portrait|selfie)\b|\bin (?:her|his|their) \d0s\b/i.test(p)) disclose.push('synthetic person');
  return { ok: true, disclose };
}
