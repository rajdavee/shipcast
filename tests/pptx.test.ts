import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 as zlibCrc32, deflateSync, inflateRawSync } from 'node:zlib';
import { writePptx, type PptxDeck } from '../services/engine/src/pptx.ts';

// Tiny valid PNG (1x1 RGB) built by hand so the test has no fixture files.
function makePng(r: number, g: number, b: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlibCrc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, r, g, b]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface Entry { name: string; data: Buffer; crc: number }

// Independent reader: walks the central directory rather than trusting local headers.
function unzip(buf: Buffer): Entry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central directory signature');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    assert.equal(buf.readUInt32LE(off), 0x04034b50, `local header for ${name}`);
    const lstart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(lstart, lstart + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, usize, `size of ${name}`);
    out.push({ name, data, crc });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

let dir = '';
let outFile = '';
let entries: Entry[] = [];
const get = (name: string) => entries.find((e) => e.name === name);
const text = (name: string) => {
  const e = get(name);
  assert.ok(e, `missing ${name}`);
  return e.data.toString('utf8');
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'shipcast-pptx-'));
  const red = join(dir, 'red.png');
  const redCopy = join(dir, 'red-copy.png'); // same bytes, different path → must still dedupe
  const blue = join(dir, 'blue.png');
  writeFileSync(red, makePng(255, 0, 0));
  writeFileSync(redCopy, makePng(255, 0, 0));
  writeFileSync(blue, makePng(0, 0, 255));

  const deck: PptxDeck = {
    title: 'R&D <2026>',
    author: 'Test',
    fonts: { heading: 'Inter', body: 'Inter' },
    slides: [
      {
        background: '#0F172A',
        items: [
          { type: 'text', text: 'R&D <2026>', x: 0.5, y: 0.5, w: 12, h: 1.5, size: 44, bold: true, color: 'fff', align: 'center', valign: 'middle' },
          { type: 'text', text: 'Bad\u0001chars "quoted" & \'single\'', x: 0.5, y: 2.5, w: 12, h: 1 },
        ],
      },
      {
        items: [
          { type: 'text', text: 'First point\nSecond point\nThird point', x: 1, y: 1, w: 8, h: 4, bullets: true, lineSpacing: 1.2 },
          { type: 'image', path: red, x: 9, y: 1, w: 3, h: 3 },
          { type: 'shape', kind: 'roundRect', x: 1, y: 5.5, w: 4, h: 1, fill: '4F46E5', line: '#000000' },
        ],
        notes: 'Speaker notes\nwith two lines & an ampersand',
      },
      {
        background: { image: blue },
        items: [
          { type: 'image', path: redCopy, x: 1, y: 1, w: 2, h: 2 },
          { type: 'shape', kind: 'ellipse', x: 4, y: 1, w: 2, h: 2, fill: 'F59E0B' },
        ],
      },
    ],
  };
  outFile = join(dir, 'deck.pptx');
  await writePptx(deck, outFile);
  entries = unzip(readFileSync(outFile));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('file is a zip with [Content_Types].xml first', () => {
  const buf = readFileSync(outFile);
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');
  assert.equal(entries[0]!.name, '[Content_Types].xml');
});

test('all required parts are present', () => {
  const names = new Set(entries.map((e) => e.name));
  for (const n of [
    '_rels/.rels',
    'docProps/app.xml',
    'docProps/core.xml',
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
    'ppt/slideMasters/slideMaster1.xml',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    'ppt/slideLayouts/slideLayout1.xml',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    'ppt/theme/theme1.xml',
    'ppt/slides/slide1.xml',
    'ppt/slides/slide2.xml',
    'ppt/slides/slide3.xml',
    'ppt/slides/_rels/slide1.xml.rels',
    'ppt/notesMasters/notesMaster1.xml',
  ]) assert.ok(names.has(n), `missing ${n}`);
  assert.equal(new Set(entries.map((e) => e.name)).size, entries.length, 'duplicate entry names');
});

test('CRCs match the decompressed contents', () => {
  for (const e of entries) assert.equal(zlibCrc32(e.data), e.crc, `crc of ${e.name}`);
});

test('text is escaped, editable and well-formed', () => {
  const s1 = text('ppt/slides/slide1.xml');
  assert.ok(s1.includes('<a:t>R&amp;D &lt;2026&gt;</a:t>'));
  assert.ok(!s1.includes('R&D <2026>'));
  assert.ok(s1.includes('Badchars &quot;quoted&quot; &amp; &apos;single&apos;'));
  assert.ok(!/[\u0000-\u0008]/.test(s1), 'control chars stripped');
  assert.ok(s1.includes('<a:srgbClr val="0F172A"/>'), 'solid background');
  assert.ok(s1.includes('<a:srgbClr val="FFFFFF"/>'), '3-digit hex expanded');
  assert.ok(s1.includes('anchor="ctr"') && s1.includes('algn="ctr"'));
  assert.ok(s1.includes('sz="4400"') && s1.includes('b="1"'));
  assert.ok(text('docProps/core.xml').includes('<dc:title>R&amp;D &lt;2026&gt;</dc:title>'));
  assert.ok(text('ppt/theme/theme1.xml').includes('<a:latin typeface="Inter"/>'));
});

test('bullets become separate paragraphs with buChar', () => {
  const s2 = text('ppt/slides/slide2.xml');
  assert.equal((s2.match(/<a:buChar /g) ?? []).length, 3);
  for (const t of ['First point', 'Second point', 'Third point']) assert.ok(s2.includes(`<a:t>${t}</a:t>`));
  assert.ok(s2.includes('<a:spcPct val="120000"/>'));
  assert.ok(s2.includes('prst="roundRect"'));
  assert.ok(s2.includes('<p:pic>'));
});

test('notes slide exists only for slide 2', () => {
  const notes = entries.filter((e) => e.name.startsWith('ppt/notesSlides/') && e.name.endsWith('.xml'));
  assert.deepEqual(notes.map((e) => e.name), ['ppt/notesSlides/notesSlide2.xml']);
  assert.ok(text('ppt/notesSlides/notesSlide2.xml').includes('with two lines &amp; an ampersand'));
  assert.ok(text('ppt/slides/_rels/slide2.xml.rels').includes('notesSlide2.xml'));
  assert.ok(!text('ppt/slides/_rels/slide1.xml.rels').includes('notesSlide'));
  const ct = text('[Content_Types].xml');
  assert.ok(ct.includes('/ppt/notesSlides/notesSlide2.xml'));
  assert.ok(!ct.includes('/ppt/notesSlides/notesSlide1.xml'));
});

test('identical images are stored once', () => {
  const media = entries.filter((e) => e.name.startsWith('ppt/media/')).map((e) => e.name).sort();
  // red (slide 2) + its byte-identical copy (slide 3) collapse; blue background is distinct.
  assert.deepEqual(media, ['ppt/media/image1.png', 'ppt/media/image2.png']);
  assert.ok(text('ppt/slides/_rels/slide2.xml.rels').includes('../media/image1.png'));
  const rels3 = text('ppt/slides/_rels/slide3.xml.rels');
  assert.ok(rels3.includes('../media/image1.png') && rels3.includes('../media/image2.png'));
  assert.ok(text('ppt/slides/slide3.xml').includes('<a:blipFill'), 'image background');
});

test('content types cover every XML part', () => {
  const ct = text('[Content_Types].xml');
  for (const e of entries) {
    if (!e.name.endsWith('.xml') || e.name === '[Content_Types].xml') continue;
    assert.ok(ct.includes(`PartName="/${e.name}"`), `no override for ${e.name}`);
  }
});

test('python-pptx can open it (optional)', (t) => {
  const r = spawnSync('python3', ['-c', 'import pptx, sys; p = pptx.Presentation(sys.argv[1]); print(len(p.slides))', outFile], { encoding: 'utf8' });
  if (r.error || /ModuleNotFoundError|No module named/.test(r.stderr ?? '')) {
    t.skip('python-pptx not available');
    return;
  }
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '3');
});
