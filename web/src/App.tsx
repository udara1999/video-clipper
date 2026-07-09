import { useRef, useState } from 'react';
import { fetchVideoInfo, pickFile, streamUrl, type VideoInfo } from './lib/api';
import { formatTimestamp } from '../../shared/time';

export default function App() {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  async function chooseVideo() {
    setError(null);
    try {
      const path = await pickFile();
      if (path === null) return; // user cancelled
      setVideo(await fetchVideoInfo(path));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main>
      <h1>Video Clipper</h1>
      <button onClick={chooseVideo}>{video ? 'Choose another video…' : 'Choose video…'}</button>
      {error && <p className="error">{error}</p>}
      {video && (
        <>
          <p className="video-info">
            <strong>{video.fileName}</strong> — {formatTimestamp(video.durationSec)} ·{' '}
            {video.width}×{video.height} · {video.videoCodec} · {video.container}
          </p>
          {!video.previewable && (
            <p className="notice">
              This format may not preview in the browser. You can still add split times
              manually below and export losslessly.
            </p>
          )}
          <video ref={videoRef} src={streamUrl(video.path)} controls className="player" />
        </>
      )}
    </main>
  );
}
