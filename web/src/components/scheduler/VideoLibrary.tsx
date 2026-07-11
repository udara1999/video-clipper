import type { FolderVideo } from '../../../../shared/scheduler';
import { streamUrl } from '../../lib/api';

interface Props {
  folder: string | null;
  videos: FolderVideo[];
  loading: boolean;
  selectedPaths: Set<string>;
  onChooseFolder: () => void;
  onToggle: (video: FolderVideo) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function VideoLibrary({
  folder,
  videos,
  loading,
  selectedPaths,
  onChooseFolder,
  onToggle,
  onSelectAll,
  onClearSelection,
}: Props) {
  return (
    <div className="panel sched-card">
      <div className="sched-card-head">
        <h2>Videos</h2>
        {videos.length > 0 && (
          <div className="sched-card-actions">
            <button onClick={onSelectAll}>Select all</button>
            <button onClick={onClearSelection} disabled={selectedPaths.size === 0}>
              Clear
            </button>
          </div>
        )}
      </div>
      <div className="sched-folder-row">
        <button onClick={onChooseFolder} disabled={loading}>
          {folder ? 'Choose another folder…' : 'Choose folder…'}
        </button>
        {folder && <span className="sched-folder-path" title={folder}>{folder}</span>}
      </div>
      {loading && <p className="muted">Reading folder…</p>}
      {!loading && folder && videos.length === 0 && (
        <p className="muted">No video files found in this folder.</p>
      )}
      {videos.length > 0 && (
        <ul className="sched-video-grid">
          {videos.map((video) => {
            const selected = selectedPaths.has(video.path);
            return (
              <li key={video.path}>
                <button
                  className={`sched-video-tile ${selected ? 'selected' : ''}`}
                  onClick={() => onToggle(video)}
                  aria-pressed={selected}
                >
                  <span className="sched-thumb">
                    <video src={streamUrl(video.path)} preload="metadata" muted playsInline />
                    <span className="sched-check" aria-hidden>
                      {selected ? '✓' : ''}
                    </span>
                  </span>
                  <span className="sched-video-name" title={video.fileName}>
                    {video.fileName}
                  </span>
                  <span className="sched-video-meta">{formatSize(video.sizeBytes)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
