import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVideoInfo, pickFile, streamUrl, type VideoInfo } from './lib/api';
import { formatTimestamp } from '../../shared/time';
import { normalizeSplits } from '../../shared/segments';
import { SplitEditor } from './components/SplitEditor';
import { Timeline } from './components/Timeline';
import { ExportPanel } from './components/ExportPanel';

export default function App() {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  async function chooseVideo() {
    setError(null);
    try {
      const path = await pickFile();
      if (path === null) return; // user cancelled
      const info = await fetchVideoInfo(path);
      setVideo(info);
      setSplits([]);
      setCurrentTime(0);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const setNormalizedSplits = useCallback(
    (next: number[]) => {
      if (!video) return;
      setSplits(normalizeSplits(next, video.durationSec));
    },
    [video],
  );

  const splitHere = useCallback(() => {
    const el = videoRef.current;
    if (!el || !video) return;
    setSplits((prev) => normalizeSplits([...prev, el.currentTime], video.durationSec));
  }, [video]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 's' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      splitHere();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [splitHere]);

  function seek(t: number) {
    const el = videoRef.current;
    if (el) el.currentTime = t;
  }

  return (
    <main>
      <header className="app-header">
        <h1>Video Clipper</h1>
        {video && (
          <p className="video-info">
            <strong>{video.fileName}</strong> — {formatTimestamp(video.durationSec)} ·{' '}
            {video.width}×{video.height} · {video.videoCodec} · {video.container}
          </p>
        )}
        <div className="spacer" />
        <button onClick={chooseVideo}>{video ? 'Choose another video…' : 'Choose video…'}</button>
      </header>
      {error && <p className="error">{error}</p>}
      {video && (
        <>
          {!video.previewable && (
            <p className="notice">
              This format may not preview in the browser. You can still add split times
              manually and export.
            </p>
          )}
          <div className="workspace">
            <div className="stage-col">
              <video
                ref={videoRef}
                src={streamUrl(video.path)}
                controls
                className="player"
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              />
              <div className="split-controls">
                <button onClick={splitHere}>Split here (S)</button>
                <span>at {formatTimestamp(currentTime)}</span>
              </div>
              <Timeline
                duration={video.durationSec}
                splits={splits}
                onRemoveSplit={(t) => setNormalizedSplits(splits.filter((x) => x !== t))}
                onSeek={seek}
              />
            </div>
            <aside className="side-col">
              <div className="panel">
                <SplitEditor splits={splits} duration={video.durationSec} onChange={setNormalizedSplits} />
              </div>
              <div className="panel">
                <ExportPanel video={video} splits={splits} />
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
