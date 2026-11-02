/**
 * Does a typed description ask for content (a film, a story, a travel piece)
 * rather than marketing for a product? Then the "Anything" format fits best.
 * The brief step makes the final call; this only picks a sensible default.
 */
const CONTENT = /\b(scenes?|shots?|anime|cartoon|animation|animated|characters?|episode|story|storyline|trailer|music video|lyric|documentary|cinematic|film|narrat\w*|voice ?over|voice acting|sound design|aspect ratio|16:9|9:16|recipe|tutorial|montage|vlog|plot|footage|b-?roll|travel|motivational|inspirational|kinetic type|timelapse|time-lapse|sunrise|sunset|dawn|nature|wildlife|city|streets?|aerial|drone)\b/gi;
const PRODUCT = /\b(our (app|product|platform|tool|saas|startup|company)|my (app|product|platform|saas|startup)|sign ?up|pricing|customers|users can|startup|api|dashboard|feature list|launching|integrations?|free trial|onboarding)\b/gi;

export function looksLikeContent(t: string): boolean {
  if (t.trim().length < 60) return false;
  const cues = new Set((t.match(CONTENT) || []).map((m) => m.toLowerCase())).size;
  const product = (t.match(PRODUCT) || []).length;
  return cues >= 3 && cues > product * 2;
}
