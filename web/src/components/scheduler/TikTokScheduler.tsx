import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FolderVideo,
  ScheduledPost,
  SchedulerSettingsView,
} from '../../../../shared/scheduler';
import { pickFolder } from '../../lib/api';
import {
  createSchedule,
  fetchSchedulerState,
  listFolderVideos,
} from '../../lib/schedulerApi';
import { ConnectCard } from './ConnectCard';
import { VideoLibrary } from './VideoLibrary';
import { QueueBuilder, type QueueItem, type ScheduleOptions } from './QueueBuilder';
import { ScheduledPosts } from './ScheduledPosts';

const POLL_INTERVAL_MS = 5_000;

function defaultCaption(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function TikTokScheduler() {
  const [settings, setSettings] = useState<SchedulerSettingsView | null>(null);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [videos, setVideos] = useState<FolderVideo[]>([]);
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const state = await fetchSchedulerState();
      setSettings(state.settings);
      setPosts(state.posts);
    } catch {
      // Polling failures are transient (e.g. server restarting); keep last state.
    }
  }, []);

  useEffect(() => {
    void refreshState();
    const timer = setInterval(() => void refreshState(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshState]);

  async function chooseFolder() {
    setError(null);
    try {
      const dir = await pickFolder();
      if (dir === null) return; // user cancelled
      setLoadingFolder(true);
      setFolder(dir);
      setVideos(await listFolderVideos(dir));
      setQueue([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingFolder(false);
    }
  }

  const selectedPaths = useMemo(() => new Set(queue.map((q) => q.path)), [queue]);

  function toggleVideo(video: FolderVideo) {
    setQueue((prev) =>
      prev.some((q) => q.path === video.path)
        ? prev.filter((q) => q.path !== video.path)
        : [
            ...prev,
            { path: video.path, fileName: video.fileName, caption: defaultCaption(video.fileName) },
          ],
    );
  }

  async function schedule(options: ScheduleOptions) {
    setError(null);
    await createSchedule({
      videos: queue.map((q) => ({ path: q.path, caption: q.caption })),
      startAt: options.startAt,
      gapMinutes: options.gapMinutes,
      privacy: options.privacy,
    });
    setQueue([]);
    await refreshState();
  }

  return (
    <div className="sched-tab-body">
      {error && <p className="error">{error}</p>}
      <ConnectCard settings={settings} onSettingsChange={setSettings} />
      <div className="sched-columns">
        <VideoLibrary
          folder={folder}
          videos={videos}
          loading={loadingFolder}
          selectedPaths={selectedPaths}
          onChooseFolder={chooseFolder}
          onToggle={toggleVideo}
          onSelectAll={() =>
            setQueue(
              videos.map(
                (v) =>
                  queue.find((q) => q.path === v.path) ?? {
                    path: v.path,
                    fileName: v.fileName,
                    caption: defaultCaption(v.fileName),
                  },
              ),
            )
          }
          onClearSelection={() => setQueue([])}
        />
        <QueueBuilder
          queue={queue}
          onQueueChange={setQueue}
          onSchedule={schedule}
          connected={settings?.hasAccessToken ?? false}
        />
      </div>
      <ScheduledPosts posts={posts} onChanged={() => void refreshState()} onError={setError} />
    </div>
  );
}
