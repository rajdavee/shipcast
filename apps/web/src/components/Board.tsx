import { useEffect, useRef, useState } from 'react';
import rough from 'roughjs';
import type { BoardBeat } from '../api.ts';

/** Scene types the board can sketch (same names as the video engine's scenes). */
export const BOARD_SCENES: [string, string][] = [
  ['kinetic', 'Kinetic type'],
  ['title', 'Title'],
  ['statement', 'Statement'],
  ['product', 'Product shot'],
  ['stat', 'Big number'],
  ['chart', 'Chart'],
  ['logos', 'Logo storm'],
  ['compare', 'Before / after'],
  ['features', 'Feature list'],
  ['stack3d', '3D cards'],
  ['terminal', 'Terminal'],
  ['quote', 'Quote'],
  ['character', 'Presenter'],
  ['cinema', 'Cinematic shot'],
  ['broll', 'Stock footage'],
  ['outro', 'Call to action'],
];

type RC = ReturnType<typeof rough.svg>;
const INK = '#23252b';
const MARK = '#ffd84d';
const ACC = '#5b6cff';

/** One doodle per scene type, drawn inside a w×h frame. */
function doodle(rc: RC, svg: SVGSVGElement, scene: string, w: number, h: number, seed: number) {
  const o = (x: Partial<Parameters<RC['line']>[4]> = {}) => ({ seed, roughness: 1.4, stroke: INK, strokeWidth: 1.6, ...x });
  const add = (n: SVGGElement) => svg.appendChild(n);
  const text = (t: string, x: number, y: number, size: number, fill = INK) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.setAttribute('x', String(x));
    el.setAttribute('y', String(y));
    el.setAttribute('font-family', 'Kalam, cursive');
    el.setAttribute('font-weight', '700');
    el.setAttribute('font-size', String(size));
    el.setAttribute('fill', fill);
    el.setAttribute('text-anchor', 'middle');
    el.textContent = t;
    svg.appendChild(el);
  };
  const lines = (x: number, y: number, widths: number[], gap: number, sw = 5) => widths.forEach((lw, k) => add(rc.line(x, y + k * gap, x + lw, y + k * gap, o({ strokeWidth: sw }))));
  const cx = w / 2;
  const cy = h / 2;
  switch (scene) {
    case 'kinetic':
      lines(w * 0.12, h * 0.3, [w * 0.6, w * 0.45], h * 0.17, 9);
      add(rc.rectangle(w * 0.1, h * 0.58, w * 0.62, h * 0.18, o({ fill: MARK, fillStyle: 'solid', stroke: 'none' })));
      add(rc.line(w * 0.12, h * 0.67, w * 0.68, h * 0.67, o({ strokeWidth: 9 })));
      break;
    case 'title':
      lines(w * 0.18, h * 0.42, [w * 0.64], 0, 9);
      lines(w * 0.3, h * 0.6, [w * 0.4], 0, 4);
      break;
    case 'statement':
      lines(w * 0.12, h * 0.3, [w * 0.7, w * 0.55], h * 0.15, 6);
      add(rc.rectangle(w * 0.1, h * 0.55, w * 0.5, h * 0.14, o({ fill: MARK, fillStyle: 'solid', stroke: 'none' })));
      add(rc.line(w * 0.12, h * 0.62, w * 0.56, h * 0.62, o({ strokeWidth: 6 })));
      break;
    case 'product':
      add(rc.rectangle(w * 0.12, h * 0.16, w * 0.76, h * 0.68, o()));
      add(rc.line(w * 0.12, h * 0.28, w * 0.88, h * 0.28, o()));
      [0.17, 0.21, 0.25].forEach((x) => add(rc.circle(w * x, h * 0.22, 6, o({ strokeWidth: 1 }))));
      lines(w * 0.2, h * 0.42, [w * 0.35, w * 0.5, w * 0.28], h * 0.12, 3);
      add(rc.polygon([[w * 0.66, h * 0.5], [w * 0.66, h * 0.72], [w * 0.71, h * 0.66], [w * 0.76, h * 0.74], [w * 0.78, h * 0.72], [w * 0.73, h * 0.64], [w * 0.79, h * 0.62]], o({ fill: ACC, fillStyle: 'solid' })));
      break;
    case 'stat':
      text('42%', cx, cy + h * 0.06, h * 0.36, ACC);
      lines(w * 0.32, h * 0.76, [w * 0.36], 0, 4);
      break;
    case 'chart':
      [0.55, 0.3, 0.75, 0.45].forEach((v, k) => add(rc.rectangle(w * 0.16, h * (0.2 + k * 0.16), w * 0.68 * v, h * 0.1, o({ fill: k === 2 ? ACC : '#b8bcc8', fillStyle: 'hachure', hachureGap: 4 }))));
      break;
    case 'logos': {
      add(rc.rectangle(cx - h * 0.12, cy - h * 0.12, h * 0.24, h * 0.24, o({ fill: ACC, fillStyle: 'solid' })));
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        add(rc.circle(cx + Math.cos(a) * w * 0.3, cy + Math.sin(a) * h * 0.32, h * 0.13, o({ strokeWidth: 1.3 })));
      }
      break;
    }
    case 'compare':
      add(rc.line(cx, h * 0.15, cx, h * 0.85, o()));
      [0, 1, 2].forEach((k) => {
        add(rc.line(w * 0.12, h * (0.3 + k * 0.18), w * 0.17, h * (0.36 + k * 0.18), o({ stroke: '#d24' })));
        add(rc.line(w * 0.17, h * (0.3 + k * 0.18), w * 0.12, h * (0.36 + k * 0.18), o({ stroke: '#d24' })));
        add(rc.linearPath([[w * 0.58, h * (0.33 + k * 0.18)], [w * 0.61, h * (0.37 + k * 0.18)], [w * 0.66, h * (0.29 + k * 0.18)]], o({ stroke: '#1a9a5c', strokeWidth: 2.2 })));
        lines(w * 0.21, h * (0.33 + k * 0.18), [w * 0.22], 0, 3);
        lines(w * 0.7, h * (0.33 + k * 0.18), [w * 0.2], 0, 3);
      });
      break;
    case 'features':
      [0, 1, 2].forEach((k) => {
        add(rc.rectangle(w * 0.16, h * (0.24 + k * 0.2), h * 0.11, h * 0.11, o({ fill: ACC, fillStyle: 'solid' })));
        lines(w * 0.16 + h * 0.18, h * (0.3 + k * 0.2), [w * (0.4 + (k % 2) * 0.12)], 0, 4);
      });
      break;
    case 'stack3d':
      [2, 1, 0].forEach((k) => add(rc.rectangle(w * 0.22 + k * 10, h * 0.24 - k * 10, w * 0.5, h * 0.5, o({ fill: k ? '#e9eaee' : '#fff', fillStyle: 'solid' }))));
      lines(w * 0.28, h * 0.44, [w * 0.3, w * 0.22], h * 0.12, 4);
      break;
    case 'terminal':
      add(rc.rectangle(w * 0.1, h * 0.16, w * 0.8, h * 0.68, o({ fill: '#1b1d23', fillStyle: 'solid' })));
      text('$ _', w * 0.22, h * 0.42, h * 0.16, '#9fe870');
      break;
    case 'quote':
      text('“', w * 0.2, h * 0.5, h * 0.5, ACC);
      lines(w * 0.3, h * 0.38, [w * 0.5, w * 0.42], h * 0.15, 5);
      lines(w * 0.3, h * 0.72, [w * 0.2], 0, 2);
      break;
    case 'character':
      add(rc.rectangle(w * 0.12, h * 0.34, w * 0.2, h * 0.56, o({ fill: ACC, fillStyle: 'solid' })));
      add(rc.circle(w * 0.18, h * 0.5, 7, o({ fill: '#fff', fillStyle: 'solid' })));
      add(rc.circle(w * 0.26, h * 0.5, 7, o({ fill: '#fff', fillStyle: 'solid' })));
      add(rc.rectangle(w * 0.4, h * 0.16, w * 0.5, h * 0.34, o({ fill: '#fff', fillStyle: 'solid' })));
      add(rc.linearPath([[w * 0.42, h * 0.44], [w * 0.34, h * 0.5], [w * 0.44, h * 0.4]], o()));
      lines(w * 0.45, h * 0.28, [w * 0.36, w * 0.26], h * 0.1, 3);
      break;
    case 'cinema':
    case 'broll':
      add(rc.rectangle(0, 0, w, h * 0.13, o({ fill: INK, fillStyle: 'solid', stroke: 'none' })));
      add(rc.rectangle(0, h * 0.87, w, h * 0.13, o({ fill: INK, fillStyle: 'solid', stroke: 'none' })));
      add(rc.circle(w * 0.7, h * 0.4, h * 0.2, o({ fill: MARK, fillStyle: 'hachure' })));
      add(rc.linearPath([[0, h * 0.7], [w * 0.3, h * 0.52], [w * 0.5, h * 0.64], [w * 0.75, h * 0.5], [w, h * 0.66]], o()));
      if (scene === 'broll') add(rc.polygon([[cx - 12, cy - 14], [cx - 12, cy + 14], [cx + 14, cy]], o({ fill: '#fff', fillStyle: 'solid' })));
      break;
    case 'chapter':
      text('01', w * 0.3, h * 0.62, h * 0.42, ACC);
      lines(w * 0.48, h * 0.5, [w * 0.36], 0, 6);
      break;
    case 'outro':
      add(rc.circle(cx, h * 0.34, h * 0.24, o({ fill: ACC, fillStyle: 'solid' })));
      lines(w * 0.3, h * 0.6, [w * 0.4], 0, 6);
      add(rc.rectangle(cx - w * 0.14, h * 0.7, w * 0.28, h * 0.13, o({ fill: MARK, fillStyle: 'solid' })));
      break;
    default:
      lines(w * 0.15, h * 0.4, [w * 0.6, w * 0.4], h * 0.16, 5);
  }
}

function Sketch({ scene, vertical, seed }: { scene: string; vertical: boolean; seed: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const w = vertical ? 120 : 240;
  const h = vertical ? 213 : 135;
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.innerHTML = '';
    const rc = rough.svg(svg);
    svg.appendChild(rc.rectangle(2, 2, w - 4, h - 4, { seed, roughness: 1.6, stroke: INK, strokeWidth: 2, fill: '#fffdf7', fillStyle: 'solid' }));
    doodle(rc, svg, scene, w, h, seed);
  }, [scene, vertical, seed]);
  return <svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="sk-frame" aria-label={`Sketch of a ${scene} scene`} />;
}

/** Hand-drawn arrow between frames. */
function Arrow({ seed }: { seed: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.innerHTML = '';
    const rc = rough.svg(svg);
    svg.appendChild(rc.curve([[4, 22], [22, 14], [40, 22]], { seed, stroke: INK, strokeWidth: 1.6, roughness: 1.4 }));
    svg.appendChild(rc.linearPath([[32, 14], [41, 22], [31, 28]], { seed, stroke: INK, strokeWidth: 1.6, roughness: 1.2 }));
  }, [seed]);
  return <svg ref={ref} width={46} height={36} className="sk-arrow" aria-hidden="true" />;
}

/**
 * The drawing board: the idea as a hand-sketched storyboard the user can
 * shape before anything renders. Reorder, rewrite, swap a scene, add or drop
 * beats — the board becomes the plan Claude follows.
 */
export function Board({ beats, vertical, onChange }: { beats: BoardBeat[]; vertical: boolean; onChange: (b: BoardBeat[]) => void }) {
  const [edit, setEdit] = useState<number | null>(null);
  const set = (k: number, patch: Partial<BoardBeat>) => onChange(beats.map((b, i) => (i === k ? { ...b, ...patch } : b)));
  const move = (k: number, d: number) => {
    const n = [...beats];
    const [b] = n.splice(k, 1);
    n.splice(Math.max(0, Math.min(n.length, k + d)), 0, b);
    onChange(n);
  };
  const total = Math.round(beats.reduce((s, b) => s + b.seconds, 0));
  return (
    <div className="board">
      <div className="board-meta">
        <span>{beats.length} beats · about {total} s</span>
        <span className="muted">Click a caption to rewrite it · arrows reorder</span>
      </div>
      <div className="board-strip">
        {beats.map((b, k) => (
          <div key={k} className="beat-wrap">
            {k > 0 && <Arrow seed={k * 13} />}
            <div className="beat">
              <div className="beat-top">
                <span className="beat-n">{k + 1}</span>
                <select value={b.scene} onChange={(e) => set(k, { scene: e.target.value })} aria-label="Scene type">
                  {BOARD_SCENES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <Sketch scene={b.scene} vertical={vertical} seed={k * 7 + 3} />
              {edit === k ? (
                <textarea className="beat-edit" autoFocus value={b.line} onChange={(e) => set(k, { line: e.target.value })} onBlur={() => setEdit(null)} rows={3} />
              ) : (
                <button className="beat-line" onClick={() => setEdit(k)} title="Rewrite this line">“{b.line || b.title}”</button>
              )}
              {b.note && <small className="beat-note">{b.note}</small>}
              <div className="beat-tools">
                <button onClick={() => move(k, -1)} disabled={k === 0} aria-label="Move earlier">←</button>
                <button onClick={() => move(k, 1)} disabled={k === beats.length - 1} aria-label="Move later">→</button>
                <button onClick={() => onChange(beats.filter((_, i) => i !== k))} aria-label="Remove beat">✕</button>
              </div>
            </div>
          </div>
        ))}
        <button className="beat-add" onClick={() => onChange([...beats.slice(0, -1), { scene: 'statement', title: 'New beat', line: 'A new idea…', note: '', seconds: 3 }, ...beats.slice(-1)])}>
          + Add a beat
        </button>
      </div>
    </div>
  );
}
