import { useEffect, useState } from 'react';
import { formatTimestamp, parseTimestamp } from '../../../shared/time';

const HINT = 'Enter a time inside the video, e.g. 00:12:34';

interface RowProps {
  value: number;
  duration: number;
  onCommit: (t: number) => void;
  onRemove: () => void;
}

function SplitRow({ value, duration, onCommit, onRemove }: RowProps) {
  const [text, setText] = useState(formatTimestamp(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatTimestamp(value));
    setInvalid(false);
  }, [value]);

  function commit() {
    const t = parseTimestamp(text);
    if (t === null || t <= 0 || t >= duration) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (t !== value) onCommit(t);
  }

  return (
    <li>
      <input
        value={text}
        className={invalid ? 'invalid' : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <button onClick={onRemove} title="Delete this split">
        ✕
      </button>
      {invalid && <span className="error">{HINT}</span>}
    </li>
  );
}

interface SplitEditorProps {
  splits: number[];
  duration: number;
  onChange: (next: number[]) => void;
}

export function SplitEditor({ splits, duration, onChange }: SplitEditorProps) {
  const [newText, setNewText] = useState('');
  const [invalid, setInvalid] = useState(false);

  function add() {
    if (newText.trim() === '') return;
    const t = parseTimestamp(newText);
    if (t === null || t <= 0 || t >= duration) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setNewText('');
    onChange([...splits, t]);
  }

  return (
    <section>
      <h2>Split points</h2>
      {splits.length === 0 && <p>No splits yet — press “Split here” (or S) while playing, or type a timestamp.</p>}
      <ul className="split-list">
        {splits.map((t) => (
          <SplitRow
            key={t}
            value={t}
            duration={duration}
            onCommit={(next) => onChange([...splits.filter((x) => x !== t), next])}
            onRemove={() => onChange(splits.filter((x) => x !== t))}
          />
        ))}
      </ul>
      <div className="split-add">
        <input
          placeholder="hh:mm:ss"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button onClick={add}>Add split</button>
        {invalid && <span className="error">{HINT}</span>}
      </div>
    </section>
  );
}
