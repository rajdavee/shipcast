import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertInHome, contactSheet, createService, SERVICE_PORTS } from '@shipcast/engine';
import { checkCaptions, checkComposition, checkImage, checkVideo } from './checks.ts';

export * from './checks.ts';

/**
 * qa — deterministic quality gates. No model calls: every rule is measured,
 * so a report means the same thing on every machine. Reports carry a `fix`
 * line per issue so the director can hand them straight back to Claude.
 */
export function createQaService() {
  return createService({
    name: 'qa',
    port: SERVICE_PORTS.qa,
    version: '0.2.0',
    concurrency: 2,
    handlers: {
      video: async ({ file, preset, sheet }) => {
        const r = await checkVideo(assertInHome(file, 'file'), preset);
        if (sheet) r.facts.contactSheet = await contactSheet(file, assertInHome(sheet, 'sheet'));
        return r;
      },
      image: ({ file, preset }) => checkImage(assertInHome(file, 'file'), preset),
      captions: async ({ file, text }) => checkCaptions(text ?? (await readFile(assertInHome(file, 'file'), 'utf8'))),
      composition: ({ dir }) => checkComposition(assertInHome(dir, 'dir')),
      sheet: async ({ file, out }, ctx) => ({ file: await contactSheet(assertInHome(file, 'file'), out ? assertInHome(out, 'out') : join(ctx.dir, 'contact.jpg')) }),
    },
  });
}
