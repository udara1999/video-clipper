import { useEffect, useState } from 'react';
import {
  getExportJob,
  pickFolder,
  startExport,
  type ExportJob,
  type VideoInfo,
} from '../lib/api';
import { defaultPrefix } from '../../../shared/naming';
import { formatTimestamp } from '../../../shared/time';
import { bakeComposition, type BakedComposition } from '../lib/bake';
import type { ComposeLayout } from '../../../shared/compose';

interface ExportPanelProps {
  video: VideoInfo;
  splits: number[];
  mode: 'lossless' | 'vertical';
  layout: ComposeLayout;
}

export function ExportPanel({ video, splits, mode, layout }: ExportPanelProps) {
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [prefix, setPrefix] = useState(defaultPrefix(video.fileName));
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setPrefix(defaultPrefix(video.fileName));
    setError(null);
    setJob((prev) => (prev && prev.status === 'running' ? prev : null));
  }, [video.path, video.fileName]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await getExportJob(job.id);
        if (!cancelled) setJob(next);
      } catch {
        // transient poll failure — keep polling
      } finally {
        inFlight = false;
      }
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  async function chooseFolder() {
    setError(null);
    try {
      const dir = await pickFolder();
      if (dir !== null) setOutputDir(dir);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitExport(overwrite: boolean, compose?: BakedComposition) {
    if (!outputDir) return;
    setError(null);
    try {
      const res = await startExport({
        sourcePath: video.path,
        splitTimes: splits,
        outputDir,
        prefix,
        overwrite,
        mode,
        ...(mode === 'vertical' && compose && { compose }),
      });
      if (res.conflicts) {
        const ok = window.confirm(
          `These files already exist in the output folder:\n\n${res.conflicts.join('\n')}\n\nOverwrite them?`,
        );
        if (ok) await submitExport(true, compose);
        return;
      }
      if (!res.jobId) {
        setError('Export did not return a job id');
        return;
      }
      setJob({ id: res.jobId, status: 'running', percent: 0 });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function doExport(overwrite: boolean) {
    if (submitting) return;
    setSubmitting(true);
    try {
      let compose: BakedComposition | undefined;
      if (mode === 'vertical') {
        compose = await bakeComposition(layout, splits.length + 1);
      }
      await submitExport(overwrite, compose);
    } catch (err) {
      setError((err as Error).message); // bake failure (e.g. unreadable background image)
    } finally {
      setSubmitting(false);
    }
  }

  const canExport =
    splits.length > 0 && outputDir !== null && job?.status !== 'running' && !submitting;

  return (
    <section>
      <h2>Output</h2>
      <div className="output-row">
        <button onClick={chooseFolder}>Choose output folder…</button>
        <span className={outputDir ? '' : 'muted'}>{outputDir ?? 'No folder selected'}</span>
      </div>
      <div className="output-row">
        <label>
          Clip name prefix{' '}
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
      </div>
      <button className="export-button" disabled={!canExport} onClick={() => doExport(false)}>
        Export {splits.length + 1} clips{mode === 'vertical' ? ' (9:16 MP4)' : ''}
      </button>
      {splits.length === 0 && <p className="notice">Add at least one split point to export.</p>}
      {error && <p className="error">{error}</p>}
      {job?.status === 'running' && (
        <div className="progress">
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${job.percent}%` }} />
          </div>
          <span>
            {job.clipCount ? `Clip ${job.clipIndex ?? 1} of ${job.clipCount} · ` : ''}
            {Math.round(job.percent)}%
          </span>
        </div>
      )}
      {job?.status === 'error' && (
        <div className="error">
          <p>Export failed: {job.error}</p>
          {job.stderrTail && <pre className="stderr">{job.stderrTail}</pre>}
        </div>
      )}
      {job?.status === 'done' && job.results && (
        <div className="results">
          <p>Done — {job.results.length} clips written.</p>
          {job.mergedCuts ? (
            <p className="notice">
              {job.mergedCuts} split point(s) snapped to the same keyframe as a neighbour
              and were merged into a single cut.
            </p>
          ) : null}
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Start</th>
                <th>End</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {job.results.map((r) => (
                <tr key={r.fileName}>
                  <td>{r.fileName}</td>
                  <td>{formatTimestamp(r.start)}</td>
                  <td>{formatTimestamp(r.end)}</td>
                  <td>{formatTimestamp(r.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
