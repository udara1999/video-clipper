import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVideoInfo, pickFile, streamUrl, type VideoInfo } from './lib/api';
import { formatTimestamp } from '../../shared/time';
import { normalizeSplits } from '../../shared/segments';
import { SplitEditor } from './components/SplitEditor';
import { Timeline } from './components/Timeline';
import { ExportPanel } from './components/ExportPanel';
import { CompositionPanel, type Selection } from './components/CompositionPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { defaultVideoPlacement, type ComposeLayout } from '../../shared/compose';

export default function App() {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'lossless' | 'vertical'>('lossless');
  const [layout, setLayout] = useState<ComposeLayout>({
    video: defaultVideoPlacement(16, 9),
    background: null,
    texts: [],
  });
  const [selection, setSelection] = useState<Selection>(null);

  function switchMode(next: 'lossless' | 'vertical') {
    const t = videoRef.current?.currentTime ?? currentTime;
    setMode(next);
    requestAnimationFrame(() => {
      if (videoRef.current) videoRef.current.currentTime = t;
    });
  }

  async function chooseVideo() {
    setError(null);
    try {
      const path = await pickFile();
      if (path === null) return; // user cancelled
      const info = await fetchVideoInfo(path);
      setVideo(info);
      setSplits([]);
      setLayout({
        video: defaultVideoPlacement(info.width || 16, info.height || 9),
        background: null,
        texts: [],
      });
      setSelection(null);
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
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
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
              <div className="mode-toggle">
                <button
                  className={mode === 'lossless' ? 'active' : ''}
                  onClick={() => switchMode('lossless')}
                >
                  Lossless split
                </button>
                <button
                  className={mode === 'vertical' ? 'active' : ''}
                  onClick={() => switchMode('vertical')}
                >
                  Vertical 9:16
                </button>
              </div>
              {mode === 'lossless' ? (
                <video
                  ref={videoRef}
                  src={streamUrl(video.path)}
                  controls
                  className="player"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
              ) : (
                <CompositionPanel
                  video={video}
                  videoRef={videoRef}
                  layout={layout}
                  onLayoutChange={setLayout}
                  selection={selection}
                  onSelect={setSelection}
                  onTimeUpdate={setCurrentTime}
                />
              )}
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
              {mode === 'vertical' && (
                <div className="panel">
                  <PropertiesPanel
                    layout={layout}
                    onLayoutChange={setLayout}
                    selection={selection}
                    onSelect={setSelection}
                    clipCount={splits.length + 1}
                  />
                </div>
              )}
              <div className="panel">
                <SplitEditor splits={splits} duration={video.durationSec} onChange={setNormalizedSplits} />
              </div>
              <div className="panel">
                <ExportPanel video={video} splits={splits} mode={mode} layout={layout} />
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
