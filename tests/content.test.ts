import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeContent } from '../apps/web/src/content.ts';

// Typed descriptions: content pieces pick "Anything", product pitches keep the marketing formats.
test('content prompts are recognised, product pitches are not', () => {
  for (const t of [
    'A 30-second cinematic travel film about Kyoto in autumn: misty temples, red maple leaves, quiet streets at dawn, a tea ceremony. Calm music, no voiceover, one line of text per scene.',
    'A 45-second motivational video about early mornings: city waking up, runner at sunrise, coffee steam, hands on a laptop, crowded train. Kinetic type over real footage, narrated.',
    'Make an anime style short: two characters, scene 1 a rooftop at night, scene 2 a final strike, dramatic music and narration.',
  ]) assert.ok(looksLikeContent(t), t.slice(0, 40));
  for (const t of [
    'Our app helps freelancers send invoices in seconds. Users can track payments on a dashboard, connect Stripe integrations and start a free trial today.',
    'We are launching a SaaS for HR teams: onboarding checklists, pricing from $9, an API and a dashboard for managers.',
  ]) assert.ok(!looksLikeContent(t), t.slice(0, 40));
});
