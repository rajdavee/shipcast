import { useEffect, useState } from 'react';
import { api, type BrainDirection, type BrainQuestion, type BrainTurn, type Source } from '../api.ts';

type Stage = { kind: 'thinking'; label: string } | { kind: 'questions'; turn: BrainTurn } | { kind: 'directions'; turn: BrainTurn } | { kind: 'error'; message: string };

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
export function Brainstorm({ source, formats, notes, onDone, onCancel }: { source: Source; formats: string[]; notes: string; onDone: (notes: string) => void; onCancel: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: 'thinking', label: 'Reading what you gave me…' });
  const [asked, setAsked] = useState<BrainQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let on = true;
    api
      .brainstorm({ source, formats, notes })
      .then((t) => {
        if (!on) return;
        setAsked(t.questions);
        setStage(t.questions.length ? { kind: 'questions', turn: t } : { kind: 'directions', turn: t });
      })
      .catch((e) => on && setStage({ kind: 'error', message: String((e as Error).message) }));
    return () => {
      on = false;
    };
  }, []);

  const next = async () => {
    setStage({ kind: 'thinking', label: 'Shaping three directions…' });
    try {
      const t = await api.brainstorm({ source, formats, notes, asked, answers });
      setStage({ kind: 'directions', turn: t });
    } catch (e) {
      setStage({ kind: 'error', message: String((e as Error).message) });
    }
  };

  const finish = (d?: BrainDirection) => onDone(notesFrom(asked, answers, d, notes));
  const answered = asked.filter((q) => answers[q.id]?.trim()).length;

  return (
    <section className="brain" aria-live="polite">
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
            <button className="btn primary" onClick={next} disabled={!answered}>Show me directions</button>
          </div>
        </>
      )}

      {stage.kind === 'directions' && (
        <>
          <div className="brain-msg">{stage.turn.directions.length ? 'Here are three ways to tell it. Pick one — every piece will follow it.' : stage.turn.understood || 'Ready.'}</div>
          <div className="brain-dirs">
            {stage.turn.directions.map((d) => (
              <button key={d.id} className="brain-dir" onClick={() => finish(d)}>
                <span className="tone">{d.tone}</span>
                <b>{d.title}</b>
                <q>{d.hook}</q>
                <small>{d.angle}</small>
                <span className="use">Use this direction</span>
              </button>
            ))}
          </div>
          <div className="brain-foot">
            <button className="linkish" onClick={() => finish()}>None of these — make it from my answers</button>
          </div>
        </>
      )}
    </section>
  );
}
