import type { OptionField } from '../api.ts';

const pretty = (s: string) => s.replace(/^(\d+)x(\d+)$/, '$1×$2').replace(/-/g, ' ');

export interface Suggestion {
  value: string;
  label: string;
}

export function OptionInput({ field, value, onChange, suggestions }: { field: OptionField; value: string; onChange: (v: string) => void; suggestions?: Suggestion[] }) {
  const listId = suggestions?.length ? `opt-${field.key}-list` : undefined;
  if (field.type === 'select') {
    return (
      <div className="field" role="group" aria-label={field.label}>
        <span>{field.label}</span>
        <div className="seg">
          {field.choices.map((c) => (
            <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)}>
              {pretty(c)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <label className="field">
      <span>{field.label}</span>
      <input
        className="input"
        type={field.type === 'number' ? 'number' : 'text'}
        min={field.type === 'number' ? field.min : undefined}
        max={field.type === 'number' ? field.max : undefined}
        placeholder={field.type === 'text' ? field.placeholder : undefined}
        value={value}
        list={listId}
        onChange={(e) => onChange(e.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </datalist>
      )}
    </label>
  );
}
