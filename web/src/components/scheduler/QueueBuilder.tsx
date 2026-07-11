import { useRef, useState } from 'react';
import {
  computeScheduleTimes,
  TIKTOK_PRIVACY_LEVELS,
  type TikTokPrivacy,
} from '../../../../shared/scheduler';

export interface QueueItem {
  path: string;
  fileName: string;
  caption: string;
}

export interface ScheduleOptions {
  startAt: number;
  gapMinutes: number;
  privacy: TikTokPrivacy;
}

interface Props {
  queue: QueueItem[];
  onQueueChange: (queue: QueueItem[]) => void;
  onSchedule: (options: ScheduleOptions) => Promise<void>;
  connected: boolean;
}

const PRIVACY_LABELS: Record<TikTokPrivacy, string> = {
  SELF_ONLY: 'Only me',
  PUBLIC_TO_EVERYONE: 'Public',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
};

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInputValue(d);
}

function formatPublishTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function QueueBuilder({ queue, onQueueChange, onSchedule, connected }: Props) {
  const [startAt, setStartAt] = useState(defaultStart);
  const [gapValue, setGapValue] = useState(1);
  const [gapUnit, setGapUnit] = useState<'minutes' | 'hours'>('hours');
  const [privacy, setPrivacy] = useState<TikTokPrivacy>('SELF_ONLY');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  const gapMinutes = gapUnit === 'hours' ? gapValue * 60 : gapValue;
  const startMs = new Date(startAt).getTime();
  const startValid = Number.isFinite(startMs);
  const times = startValid ? computeScheduleTimes(startMs, gapMinutes, queue.length) : [];

  function move(from: number, to: number) {
    if (to < 0 || to >= queue.length || from === to) return;
    const next = [...queue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onQueueChange(next);
  }

  function setCaption(index: number, caption: string) {
    onQueueChange(queue.map((item, i) => (i === index ? { ...item, caption } : item)));
  }

  async function schedule() {
    setBusy(true);
    setError(null);
    try {
      await onSchedule({ startAt: startMs, gapMinutes, privacy });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel sched-card">
      <div className="sched-card-head">
        <h2>Posting queue</h2>
        {queue.length > 0 && <span className="sched-chip chip-muted">{queue.length} selected</span>}
      </div>
      {queue.length === 0 ? (
        <p className="muted">Select videos on the left to build the queue.</p>
      ) : (
        <>
          <ol className="sched-queue">
            {queue.map((item, i) => (
              <li
                key={item.path}
                draggable
                onDragStart={() => (dragIndex.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex.current !== null) move(dragIndex.current, i);
                  dragIndex.current = null;
                }}
              >
                <span className="sched-drag" title="Drag to reorder" aria-hidden>
                  ⠿
                </span>
                <span className="sched-order">{i + 1}</span>
                <div className="sched-queue-main">
                  <span className="sched-queue-name" title={item.fileName}>
                    {item.fileName}
                  </span>
                  <input
                    type="text"
                    value={item.caption}
                    placeholder="Caption"
                    onChange={(e) => setCaption(i, e.target.value)}
                  />
                </div>
                <span className="sched-queue-time">
                  {startValid && times[i] !== undefined ? formatPublishTime(times[i]) : '—'}
                </span>
                <div className="sched-queue-actions">
                  <button onClick={() => move(i, i - 1)} disabled={i === 0} title="Move up">
                    ↑
                  </button>
                  <button
                    onClick={() => move(i, i + 1)}
                    disabled={i === queue.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => onQueueChange(queue.filter((_, j) => j !== i))}
                    title="Remove from queue"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="sched-options">
            <label>
              Start
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className={startValid ? '' : 'invalid'}
              />
            </label>
            <label>
              Gap
              <span className="sched-gap">
                <input
                  type="number"
                  min={0}
                  value={gapValue}
                  onChange={(e) => setGapValue(Math.max(0, Number(e.target.value)))}
                />
                <select
                  value={gapUnit}
                  onChange={(e) => setGapUnit(e.target.value as 'minutes' | 'hours')}
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </span>
            </label>
            <label>
              Privacy
              <select value={privacy} onChange={(e) => setPrivacy(e.target.value as TikTokPrivacy)}>
                {TIKTOK_PRIVACY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {PRIVACY_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!connected && (
            <p className="notice">Save a TikTok access token above before scheduling.</p>
          )}
          {error && <p className="error">{error}</p>}
          <button
            className="primary sched-schedule-button"
            onClick={schedule}
            disabled={busy || !connected || !startValid || queue.length === 0}
          >
            {busy
              ? 'Scheduling…'
              : `Schedule ${queue.length} video${queue.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </div>
  );
}
