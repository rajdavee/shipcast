import { useEffect, useState } from 'react';
import { api, type BoardBeat, type BrainDirection, type BrainQuestion, type BrainTurn, type Source } from '../api.ts';
import { Board } from './Board.tsx';
import { FORMATS } from '../formats.ts';

type Stage = { kind: 'thinking'; label: string } | { kind: 'questions'; turn: BrainTurn } | { kind: 'directions'; turn: BrainTurn } | { kind: 'board'; direction?: BrainDirection; beats: BoardBeat[] } | { kind: 'error'; message: string };

/** The approved beat sheet, in the words every step will follow. */
function boardNotes(beats: BoardBeat[]): string {
  return `Storyboard the founder approved on the drawing board (follow this order and these beats; refine wording, keep the intent):\n${beats.map((b, k) => `${k + 1}. [${b.scene}] ${b.title} — "${b.line}"${b.note ? ` (${b.note})` : ''}`).join('\n')}`;
}

/** Notes every step reads: the chosen direction, then the answers. */
function notesFrom(asked: BrainQuestion[], answers: Record<string, string>, d: BrainDirection | undefined, extra: string): string {
  const lines: string[] = [];
  if (d) lines.push(`Creative direction — ${d.title}: ${d.angle} Hook: "${d.hook}". Tone: ${d.tone}.`);
  for (const q of asked) if (answers[q.id]?.trim()) lines.push(`${q.question} ${answers[q.id].trim()}`);
  if (extra.trim()) lines.push(extra.trim());
  return lines.join('\n');
}

/**
 * The short conversation before a campaign. Asks only what changes the work,
 * offers a few directions, and is skippable at every step.
 */
export function Brainstorm({ source, formats, notes, length, onDone, onCancel, onFormats }: { source: Source; formats: string[]; notes: string; length?: string; onDone: (notes: string) => void; onCancel: () => void; onFormats?: (ids: string[]) => void }) {
  const [stage, setStage] = useState<Stage>({ kind: 'thinking', label: 'Reading what you gave me…' });
  const [asked, setAsked] = useState<BrainQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, boolean>>({});
  const [reply, setReply] = useState('');
  const [lastDirs, setLastDirs] = useState<BrainTurn | null>(null);

  useEffect(() => {
    let on = true;
    api
      .brainstorm({ source, formats, notes })
      .then((t) => {
        if (!on) return;
        setAsked(t.questions);
        if (!t.questions.length) setLastDirs(t);
        setStage(t.questions.length ? { kind: 'questions', turn: t } : { kind: 'directions', turn: t });
      })
      .catch((e) => on && setStage({ kind: 'error', message: String((e as Error).message) }));
    return () => {
      on = false;
    };
  }, []);

  const next = async (r?: string) => {
    setStage({ kind: 'thinking', label: r ? 'Reworking the directions…' : 'Shaping three directions…' });
    try {
      const t = await api.brainstorm({ source, formats, notes, asked, answers, reply: r });
      setLastDirs(t);
      setReply('');
      setStage({ kind: 'directions', turn: t });
    } catch (e) {
      setStage({ kind: 'error', message: String((e as Error).message) });
    }
  };

  const finish = (d?: BrainDirection) => onDone(notesFrom(asked, answers, d, notes));
  const sketch = async (d?: BrainDirection) => {
    setStage({ kind: 'thinking', label: 'Sketching it on the board…' });
    try {
      const { beats } = await api.board({ source, formats, notes: notesFrom(asked, answers, d, notes), direction: d, length });
      setStage({ kind: 'board', direction: d, beats });
    } catch (e) {
      setStage({ kind: 'error', message: String((e as Error).message) });
    }
  };
  const vertical = formats.length > 0 && formats.every((f) => FORMATS.find((x) => x.id === f)?.ratio !== undefined && (FORMATS.find((x) => x.id === f)!.ratio < 1));
  const answered = asked.filter((q) => answers[q.id]?.trim()).length;

  return (
    <section className={`brain ${stage.kind === 'board' ? 'wide' : ''}`} aria-live="polite">
      <header className="brain-head">
        <span className="brain-avatar" aria-hidden="true">✦</span>
        <div>
          <b>Let's shape this together</b>
          <span>A few quick questions make everything sharper. Skip any time.</span>
        </div>
        <button className="linkish" onClick={() => finish()}>Skip — just make it</button>
      </header>

      {stage.kind === 'thinking' && (
        <div className="brain-msg thinking">
          <i className="dots"><b /><b /><b /></i>
          {stage.label}
        </div>
      )}

      {stage.kind === 'error' && (
        <div className="brain-msg">
          <p>I couldn't brainstorm right now ({stage.message}).</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => finish()}>Make it anyway</button>
            <button className="btn ghost" onClick={onCancel}>Back</button>
          </div>
        </div>
      )}

      {stage.kind === 'questions' && (
        <>
          {stage.turn.understood && <div className="brain-msg">{stage.turn.understood}</div>}
          <div className="brain-qs">
            {stage.turn.questions.map((q) => (
              <fieldset key={q.id} className="brain-q">
                <legend>
                  {q.question}
                  {q.why && <small>{q.why}</small>}
                </legend>
                <div className="chips-row">
                  {q.options.map((o) => (
                    <button key={o} type="button" className="chip-opt" aria-pressed={answers[q.id] === o && !other[q.id]} onClick={() => { setOther((x) => ({ ...x, [q.id]: false })); setAnswers((a) => ({ ...a, [q.id]: o })); }}>
                      {o}
                    </button>
                  ))}
                  <button type="button" className="chip-opt" aria-pressed={!!other[q.id]} onClick={() => { setOther((x) => ({ ...x, [q.id]: true })); setAnswers((a) => ({ ...a, [q.id]: '' })); }}>
                    Something else…
                  </button>
                </div>
                {other[q.id] && <input className="input" autoFocus placeholder="Type your answer" value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />}
              </fieldset>
            ))}
          </div>
          <div className="brain-foot">
            <span className="muted">{answered} of {asked.length} answered</span>
            <button className="btn primary" onClick={() => next()} disabled={!answered}>Show me directions</button>
          </div>
        </>
      )}

      {stage.kind === 'directions' && (
        <>
          <div className="brain-msg">{stage.turn.directions.length ? 'Here are three ways to tell it. Pick one — every piece will follow it.' : stage.turn.understood || 'Ready.'}</div>
          <div className="brain-dirs">
            {stage.turn.directions.map((d) => (
              <button key={d.id} className="brain-dir" onClick={() => sketch(d)}>
                <span className="tone">{d.tone}</span>
                <b>{d.title}</b>
                <q>{d.hook}</q>
                <small>{d.angle}</small>
                <span className="use">Sketch this direction →</span>
              </button>
            ))}
          </div>
          {stage.turn.formats && stage.turn.formats.length > 0 && onFormats && (
            <div className="brain-formats">
              <span>Best formats for this idea:</span>
              {stage.turn.formats.map((f) => <b key={f}>{FORMATS.find((x) => x.id === f)?.title ?? f}</b>)}
              <button className="btn sm" onClick={() => onFormats(stage.turn.formats!)}>Use these</button>
            </div>
          )}
          <form className="brain-reply" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) next(reply.trim()); }}>
            <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Not quite? Say what to change — “mix 1 and 3”, “more playful”, “aim at agencies”" aria-label="Reply to the directions" />
            <button className="btn" disabled={!reply.trim()}>Rework</button>
          </form>
          <div className="brain-foot">
            <button className="linkish" onClick={() => finish()}>Skip the board — make it from my answers</button>
          </div>
        </>
      )}

      {stage.kind === 'board' && (
        <>
          <div className="brain-msg">{stage.direction ? <>Here's <b>{stage.direction.title}</b> sketched out. Rewrite any line, swap a scene, reorder or drop beats — this becomes the plan.</> : "Here's the idea sketched out. Shape it, then make it."}</div>
          <Board beats={stage.beats} vertical={vertical} onChange={(beats) => setStage({ ...stage, beats })} />
          <div className="brain-foot">
            <button className="linkish" onClick={() => (lastDirs ? setStage({ kind: 'directions', turn: lastDirs }) : setStage({ kind: 'error', message: 'no directions' }))}>← Back to directions</button>
            <div className="row-actions">
              <button className="btn" onClick={() => sketch(stage.direction)}>Sketch again</button>
              <button className="btn primary" onClick={() => onDone(`${notesFrom(asked, answers, stage.direction, notes)}\n${boardNotes(stage.beats)}`)}>Make it from this board</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
