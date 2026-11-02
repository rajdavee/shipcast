// Minimal, dependency-free PowerPoint (.pptx) writer.
//
// Scope is deliberately narrow: absolutely positioned text boxes, pictures and
// a few preset shapes on blank slides, plus speaker notes. That covers what we
// export (carousels, decks built from rendered stills) without dragging in a
// full OOXML library. Everything the three target apps (PowerPoint, Keynote,
// Google Slides) insist on is emitted, even parts that look optional
// (presProps, viewProps, tableStyles, a theme for the notes master) — PowerPoint
// in particular "repairs" files that omit them.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';

export interface PptxText {
  text: string;
  /** Position and size in inches. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Font size in points (default 18). */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  /** Hex colour, with or without a leading '#'. */
  color?: string;
  font?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Render each line as a bulleted paragraph. */
  bullets?: boolean;
  /** Line-height multiplier, e.g. 1.2. */
  lineSpacing?: number;
}

export interface PptxImage {
  /** Local PNG or JPEG file. */
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PptxShape {
  kind: 'rect' | 'roundRect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  line?: string;
}

export type PptxItem = ({ type: 'text' } & PptxText) | ({ type: 'image' } & PptxImage) | ({ type: 'shape' } & PptxShape);

export interface PptxSlide {
  background?: string | { image: string };
  items: PptxItem[];
  notes?: string;
}

export interface PptxDeck {
  title?: string;
  author?: string;
  /** Slide size in inches; defaults to 13.333 x 7.5 (16:9). */
  width?: number;
  height?: number;
  slides: PptxSlide[];
  fonts?: { heading?: string; body?: string };
}

const EMU_PER_INCH = 914400;
const NOTES_W = 6858000; // portrait letter-ish notes page, PowerPoint's default
const NOTES_H = 9144000;

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_PML = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function writePptx(deck: PptxDeck, outFile: string): Promise<void> {
  if (!deck.slides.length) throw new Error('pptx: deck has no slides');
  const width = deck.width ?? 13.333;
  const height = deck.height ?? 7.5;
  const fonts = { heading: deck.fonts?.heading ?? 'Calibri', body: deck.fonts?.body ?? 'Calibri' };

  const media = new MediaStore();
  const parts: ZipEntry[] = [];
  const add = (name: string, xml: string) => parts.push({ name, data: Buffer.from(XML_DECL + xml, 'utf8') });

  const hasNotes = deck.slides.some((s) => (s.notes ?? '').trim() !== '');
  const overrides: [string, string][] = [];

  for (const [i, slide] of deck.slides.entries()) {
    const n = i + 1;
    const rels = new Rels();
    rels.add(`${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml');
    // Images are read and registered before XML generation so rIds are known.
    const xml = await slideXml(slide, rels, media);
    const withNotes = (slide.notes ?? '').trim() !== '';
    if (withNotes) {
      rels.add(`${REL}/notesSlide`, `../notesSlides/notesSlide${n}.xml`);
      add(`ppt/notesSlides/notesSlide${n}.xml`, notesSlideXml(slide.notes!));
      add(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
        new Rels()
          .add(`${REL}/notesMaster`, '../notesMasters/notesMaster1.xml')
          .add(`${REL}/slide`, `../slides/slide${n}.xml`)
          .xml());
      overrides.push([`/ppt/notesSlides/notesSlide${n}.xml`, `${CT}.presentationml.notesSlide+xml`]);
    }
    add(`ppt/slides/slide${n}.xml`, xml);
    add(`ppt/slides/_rels/slide${n}.xml.rels`, rels.xml());
    overrides.push([`/ppt/slides/slide${n}.xml`, `${CT}.presentationml.slide+xml`]);
  }

  // presentation.xml relationships: master first, then slides, then the rest.
  const presRels = new Rels();
  const masterRid = presRels.add(`${REL}/slideMaster`, 'slideMasters/slideMaster1.xml').last;
  const slideRids = deck.slides.map((_, i) => presRels.add(`${REL}/slide`, `slides/slide${i + 1}.xml`).last);
  const notesMasterRid = hasNotes ? presRels.add(`${REL}/notesMaster`, 'notesMasters/notesMaster1.xml').last : null;
  presRels
    .add(`${REL}/presProps`, 'presProps.xml')
    .add(`${REL}/viewProps`, 'viewProps.xml')
    .add(`${REL}/theme`, 'theme/theme1.xml')
    .add(`${REL}/tableStyles`, 'tableStyles.xml');

  add('ppt/presentation.xml', presentationXml(emu(width), emu(height), masterRid, slideRids, notesMasterRid));
  add('ppt/_rels/presentation.xml.rels', presRels.xml());
  add('ppt/presProps.xml', `<p:presentationPr ${NS_PML}/>`);
  add('ppt/viewProps.xml', viewPropsXml());
  add('ppt/tableStyles.xml', `<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  add('ppt/theme/theme1.xml', themeXml(fonts));
  add('ppt/slideMasters/slideMaster1.xml', slideMasterXml());
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels',
    new Rels().add(`${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml').add(`${REL}/theme`, '../theme/theme1.xml').xml());
  add('ppt/slideLayouts/slideLayout1.xml', slideLayoutXml());
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    new Rels().add(`${REL}/slideMaster`, '../slideMasters/slideMaster1.xml').xml());

  if (hasNotes) {
    // A notes master must own a theme of its own; sharing theme1 makes PowerPoint repair the file.
    add('ppt/notesMasters/notesMaster1.xml', notesMasterXml());
    add('ppt/notesMasters/_rels/notesMaster1.xml.rels', new Rels().add(`${REL}/theme`, '../theme/theme2.xml').xml());
    add('ppt/theme/theme2.xml', themeXml(fonts));
    overrides.push(
      ['/ppt/notesMasters/notesMaster1.xml', `${CT}.presentationml.notesMaster+xml`],
      ['/ppt/theme/theme2.xml', `${CT}.theme+xml`],
    );
  }

  for (const m of media.files) parts.push({ name: `ppt/media/${m.name}`, data: m.data, store: true });

  add('docProps/core.xml', corePropsXml(deck));
  add('docProps/app.xml', appPropsXml(deck));
  add('_rels/.rels',
    new Rels()
      .add(`${REL}/officeDocument`, 'ppt/presentation.xml')
      .add('http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml')
      .add(`${REL}/extended-properties`, 'docProps/app.xml')
      .xml());

  overrides.push(
    ['/ppt/presentation.xml', `${CT}.presentationml.presentation.main+xml`],
    ['/ppt/presProps.xml', `${CT}.presentationml.presProps+xml`],
    ['/ppt/viewProps.xml', `${CT}.presentationml.viewProps+xml`],
    ['/ppt/tableStyles.xml', `${CT}.presentationml.tableStyles+xml`],
    ['/ppt/theme/theme1.xml', `${CT}.theme+xml`],
    ['/ppt/slideMasters/slideMaster1.xml', `${CT}.presentationml.slideMaster+xml`],
    ['/ppt/slideLayouts/slideLayout1.xml', `${CT}.presentationml.slideLayout+xml`],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', `${CT}.extended-properties+xml`],
  );

  // Some readers sniff the package by its first entry, so [Content_Types].xml leads.
  const contentTypes: ZipEntry = { name: '[Content_Types].xml', data: Buffer.from(XML_DECL + contentTypesXml(overrides), 'utf8') };
  const zip = buildZip([contentTypes, ...parts]);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, zip);
}

// ---------------------------------------------------------------------------
// Slide content
// ---------------------------------------------------------------------------

async function slideXml(slide: PptxSlide, rels: Rels, media: MediaStore): Promise<string> {
  let bg = '';
  if (typeof slide.background === 'string') {
    bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(slide.background)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
  } else if (slide.background?.image) {
    const rid = rels.target(`${REL}/image`, `../media/${(await media.add(slide.background.image)).name}`);
    bg = `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${rid}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
  }

  // Shape ids must be unique within a slide; 1 is taken by the group root.
  let nextId = 2;
  const body: string[] = [];
  for (const item of slide.items) {
    const id = nextId++;
    if (item.type === 'text') body.push(textBoxXml(item, id));
    else if (item.type === 'shape') body.push(shapeXml(item, id));
    else {
      const m = await media.add(item.path);
      const rid = rels.target(`${REL}/image`, `../media/${m.name}`);
      body.push(pictureXml(item, id, rid));
    }
  }

  return `<p:sld ${NS_PML}><p:cSld>${bg}<p:spTree>${GROUP_ROOT}${body.join('')}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const GROUP_ROOT =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function xfrm(b: { x: number; y: number; w: number; h: number }): string {
  return `<a:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${emu(b.w)}" cy="${emu(b.h)}"/></a:xfrm>`;
}

function textBoxXml(t: PptxText, id: number): string {
  const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[t.valign ?? 'top'];
  const algn = { left: 'l', center: 'ctr', right: 'r' }[t.align ?? 'left'];
  const size = t.size ?? 18;
  // Without an explicit font, bind to theme fonts (+mj/+mn) so a deck-wide
  // font change in PowerPoint still flows through. Large type reads as a heading.
  const face = t.font ? esc(t.font) : size >= 28 ? '+mj-lt' : '+mn-lt';
  const rPr =
    `<a:rPr lang="en-US" sz="${Math.round(size * 100)}"${t.bold ? ' b="1"' : ''}${t.italic ? ' i="1"' : ''} dirty="0">` +
    (t.color ? `<a:solidFill><a:srgbClr val="${hex(t.color)}"/></a:solidFill>` : '') +
    `<a:latin typeface="${face}"/><a:ea typeface="${face}"/><a:cs typeface="${face}"/></a:rPr>`;
  const endRPr = rPr.replace('<a:rPr', '<a:endParaRPr').replace('</a:rPr>', '</a:endParaRPr>');
  const lnSpc = t.lineSpacing ? `<a:lnSpc><a:spcPct val="${Math.round(t.lineSpacing * 100000)}"/></a:lnSpc>` : '';

  const paras = splitLines(t.text).map((line) => {
    if (line === '') return `<a:p><a:pPr algn="${algn}">${lnSpc}<a:buNone/></a:pPr>${endRPr}</a:p>`;
    // Hanging indent so wrapped bullet lines align with the text, not the dot.
    const pPr = t.bullets
      ? `<a:pPr marL="285750" indent="-285750" algn="${algn}">${lnSpc}<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>`
      : `<a:pPr algn="${algn}">${lnSpc}<a:buNone/></a:pPr>`;
    return `<a:p>${pPr}<a:r>${rPr}<a:t>${esc(line)}</a:t></a:r></a:p>`;
  });

  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id - 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(t)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="${anchor}"><a:noAutofit/></a:bodyPr>` +
    `<a:lstStyle/>${paras.join('')}</p:txBody></p:sp>`;
}

function shapeXml(s: PptxShape, id: number): string {
  const fill = s.fill ? `<a:solidFill><a:srgbClr val="${hex(s.fill)}"/></a:solidFill>` : '<a:noFill/>';
  const line = s.line ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${hex(s.line)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id - 1}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(s)}<a:prstGeom prst="${s.kind}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr></p:sp>`;
}

function pictureXml(img: PptxImage, id: number, rid: string): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id - 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(img)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function notesSlideXml(notes: string): string {
  const paras = splitLines(notes)
    .map((l) => (l ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="en-US"/></a:p>'))
    .join('');
  return `<p:notes ${NS_PML}><p:cSld><p:spTree>${GROUP_ROOT}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

// ---------------------------------------------------------------------------
// Package scaffolding (presentation, master, layout, theme, props)
// ---------------------------------------------------------------------------

function presentationXml(cx: number, cy: number, masterRid: string, slideRids: string[], notesMasterRid: string | null): string {
  // Slide ids start at 256 by spec; master/layout ids share a space starting at 2^31.
  const slides = slideRids.map((rid, i) => `<p:sldId id="${256 + i}" r:id="${rid}"/>`).join('');
  const notes = notesMasterRid ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterRid}"/></p:notesMasterIdLst>` : '';
  return `<p:presentation ${NS_PML} saveSubsetFonts="1">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterRid}"/></p:sldMasterIdLst>${notes}` +
    `<p:sldIdLst>${slides}</p:sldIdLst>` +
    `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="${NOTES_W}" cy="${NOTES_H}"/>` +
    `<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>` +
    `<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${defRPr(1800, 'mn')}</a:lvl1pPr>` +
    `</p:defaultTextStyle></p:presentation>`;
}

function defRPr(sz: number, kind: 'mj' | 'mn'): string {
  return `<a:defRPr sz="${sz}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>` +
    `<a:latin typeface="+${kind}-lt"/><a:ea typeface="+${kind}-ea"/><a:cs typeface="+${kind}-cs"/></a:defRPr>`;
}

const CLR_MAP =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
  'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

function slideMasterXml(): string {
  return `<p:sldMaster ${NS_PML}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
    `<p:spTree>${GROUP_ROOT}</p:spTree></p:cSld>${CLR_MAP}` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `<p:txStyles>` +
    `<p:titleStyle><a:lvl1pPr algn="l" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:buNone/>${defRPr(4400, 'mj')}</a:lvl1pPr></p:titleStyle>` +
    `<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600" algn="l" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>${defRPr(2800, 'mn')}</a:lvl1pPr></p:bodyStyle>` +
    `<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${defRPr(1800, 'mn')}</a:lvl1pPr></p:otherStyle>` +
    `</p:txStyles></p:sldMaster>`;
}

function slideLayoutXml(): string {
  return `<p:sldLayout ${NS_PML} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP_ROOT}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function notesMasterXml(): string {
  const ph = (id: number, name: string, type: string, idx: string, x: number, y: number, cx: number, cy: number, extra: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="${type}"${idx}/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${extra}</p:sp>`;
  return `<p:notesMaster ${NS_PML}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_ROOT}` +
    ph(2, 'Slide Image Placeholder 1', 'sldImg', ' idx="2"', 685800, 1143000, 5486400, 3086100, '') +
    ph(3, 'Notes Placeholder 2', 'body', ' sz="quarter" idx="3"', 685800, 4400550, 5486400, 3600450,
      '<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Notes</a:t></a:r></a:p></p:txBody>') +
    `</p:spTree></p:cSld>${CLR_MAP}` +
    `<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${defRPr(1200, 'mn')}</a:lvl1pPr></p:notesStyle>` +
    `</p:notesMaster>`;
}

function themeXml(fonts: { heading: string; body: string }): string {
  const clr = (tag: string, v: string) => `<a:${tag}><a:srgbClr val="${v}"/></a:${tag}>`;
  const fontSet = (tag: string, face: string) =>
    `<a:${tag}><a:latin typeface="${esc(face)}"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;
  const phFill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${phFill}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const effect = '<a:effectStyle><a:effectLst/></a:effectStyle>';
  return `<a:theme xmlns:a="${NS_A}" name="Shipcast"><a:themeElements>` +
    `<a:clrScheme name="Shipcast">` +
    `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
    clr('dk2', '1F2937') + clr('lt2', 'F3F4F6') +
    clr('accent1', '4F46E5') + clr('accent2', '0EA5E9') + clr('accent3', '10B981') +
    clr('accent4', 'F59E0B') + clr('accent5', 'EF4444') + clr('accent6', '8B5CF6') +
    clr('hlink', '2563EB') + clr('folHlink', '7C3AED') +
    `</a:clrScheme>` +
    `<a:fontScheme name="Shipcast">${fontSet('majorFont', fonts.heading)}${fontSet('minorFont', fonts.body)}</a:fontScheme>` +
    `<a:fmtScheme name="Shipcast">` +
    `<a:fillStyleLst>${phFill}${phFill}${phFill}</a:fillStyleLst>` +
    `<a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${phFill}${phFill}${phFill}</a:bgFillStyleLst>` +
    `</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function viewPropsXml(): string {
  return `<p:viewPr ${NS_PML}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>` +
    `<p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
}

function corePropsXml(deck: PptxDeck): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(deck.title ?? 'Presentation')}</dc:title>` +
    `<dc:creator>${esc(deck.author ?? 'Shipcast')}</dc:creator>` +
    `<cp:lastModifiedBy>${esc(deck.author ?? 'Shipcast')}</cp:lastModifiedBy>` +
    `<cp:revision>1</cp:revision>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    `</cp:coreProperties>`;
}

function appPropsXml(deck: PptxDeck): string {
  const notes = deck.slides.filter((s) => (s.notes ?? '').trim() !== '').length;
  return `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>Shipcast</Application><PresentationFormat>Custom</PresentationFormat>` +
    `<Slides>${deck.slides.length}</Slides><Notes>${notes}</Notes><HiddenSlides>0</HiddenSlides>` +
    `<ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>` +
    `<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`;
}

function contentTypesXml(overrides: [string, string][]): string {
  return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
    overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') +
    `</Types>`;
}

// ---------------------------------------------------------------------------
// Helpers: relationships, media, escaping, units
// ---------------------------------------------------------------------------

class Rels {
  private list: { id: string; type: string; target: string }[] = [];
  last = '';

  add(type: string, target: string): this {
    this.last = `rId${this.list.length + 1}`;
    this.list.push({ id: this.last, type, target });
    return this;
  }

  /** Reuse an existing relationship to the same target (same image twice on one slide). */
  target(type: string, target: string): string {
    const hit = this.list.find((r) => r.type === type && r.target === target);
    return hit ? hit.id : this.add(type, target).last;
  }

  xml(): string {
    return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      this.list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"/>`).join('') +
      `</Relationships>`;
  }
}

interface MediaFile { name: string; data: Buffer }

/** Content-addressed so the same picture on many slides is stored once. */
class MediaStore {
  files: MediaFile[] = [];
  private byHash = new Map<string, MediaFile>();
  private byPath = new Map<string, Promise<MediaFile>>();

  add(path: string): Promise<MediaFile> {
    let p = this.byPath.get(path);
    if (!p) {
      p = this.load(path);
      this.byPath.set(path, p);
    }
    return p;
  }

  private async load(path: string): Promise<MediaFile> {
    const data = await readFile(path);
    const hash = createHash('sha256').update(data).digest('hex');
    const hit = this.byHash.get(hash);
    if (hit) return hit;
    // Trust the bytes, not the extension: a .png that is really a JPEG is common with scraped assets.
    const ext = imageExt(data);
    if (!ext) throw new Error(`pptx: unsupported image (expected PNG or JPEG): ${path}`);
    const file = { name: `image${this.files.length + 1}.${ext}`, data };
    this.files.push(file);
    this.byHash.set(hash, file);
    return file;
  }
}

function imageExt(b: Buffer): 'png' | 'jpeg' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}

// XML 1.0 forbids most C0 controls outright (even as entities), and U+FFFE/FFFF; drop them.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function esc(s: string): string {
  return s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function splitLines(s: string): string[] {
  return s.replace(/\r\n?/g, '\n').split('\n');
}

function hex(color: string): string {
  let c = color.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(c)) c = c.replace(/./g, (d) => d + d);
  if (!/^[0-9a-f]{6}$/i.test(c)) throw new Error(`pptx: invalid hex colour "${color}"`);
  return c.toUpperCase();
}

function emu(inches: number): number {
  if (!Number.isFinite(inches)) throw new Error(`pptx: non-finite dimension ${inches}`);
  return Math.round(inches * EMU_PER_INCH);
}

// ---------------------------------------------------------------------------
// ZIP container (PKWARE APPNOTE 6.3, no zip64)
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  data: Buffer;
  /** Store uncompressed; PNG/JPEG are already compressed, deflating them only burns CPU. */
  store?: boolean;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  // DOS dates can't go below 1980; clamp so odd system clocks don't produce garbage.
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function buildZip(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime(new Date());
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const method = e.store ? 0 : 8;
    const body = e.store ? e.data : deflateRawSync(e.data, { level: 9 });
    // Bit 11: names are UTF-8. Sizes/CRC are known up front, so no data descriptor.
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by: MS-DOS / 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra len, comment len, disk start, internal attrs, external attrs: all zero
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
    if (offset >= 0xffffffff) throw new Error('pptx: archive exceeds 4 GB (zip64 not supported)');
  }

  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  if (offset + cdSize >= 0xffffffff) throw new Error('pptx: archive exceeds 4 GB (zip64 not supported)');
  if (entries.length > 0xffff) throw new Error('pptx: too many entries for a non-zip64 archive');

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, eocd]);
}
