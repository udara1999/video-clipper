import { computeSegments } from '../../../shared/segments';
import { formatTimestamp } from '../../../shared/time';

interface TimelineProps {
  duration: number;
  splits: number[];
  onRemoveSplit: (t: number) => void;
  onSeek: (t: number) => void;
}

export function Timeline({ duration, splits, onRemoveSplit, onSeek }: TimelineProps) {
  const segments = computeSegments(splits, duration);
  return (
    <div className="timeline">
      {segments.map((seg) => (
        <div
          key={seg.index}
          className="segment"
          style={{ width: `${(seg.duration / duration) * 100}%` }}
          onClick={() => onSeek(seg.start)}
          title={`Clip ${seg.index}: ${formatTimestamp(seg.start)} → ${formatTimestamp(seg.end)} (click to seek)`}
        >
          <span className="segment-label">Clip {seg.index}</span>
          <span className="segment-duration">{formatTimestamp(seg.duration)}</span>
        </div>
      ))}
      {splits.map((t) => (
        <button
          key={t}
          className="split-marker"
          style={{ left: `${(t / duration) * 100}%` }}
          onClick={() => onRemoveSplit(t)}
          title={`Delete split at ${formatTimestamp(t)}`}
        />
      ))}
    </div>
  );
}
