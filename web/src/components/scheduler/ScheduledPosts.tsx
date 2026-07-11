import type { PostStatus, ScheduledPost } from '../../../../shared/scheduler';
import { cancelPost, removePost, retryPost } from '../../lib/schedulerApi';

interface Props {
  posts: ScheduledPost[];
  onChanged: () => void;
  onError: (message: string) => void;
}

const STATUS_LABELS: Record<PostStatus, string> = {
  scheduled: 'Scheduled',
  uploading: 'Uploading…',
  posted: 'Posted',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ScheduledPosts({ posts, onChanged, onError }: Props) {
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  const ordered = [...posts].sort((a, b) => a.publishAt - b.publishAt);

  return (
    <div className="panel sched-card">
      <div className="sched-card-head">
        <h2>Scheduled posts</h2>
        {posts.length > 0 && <span className="sched-chip chip-muted">{posts.length}</span>}
      </div>
      <p className="sched-hint">
        Posts publish only while Video Clipper is running — keep the app open around each
        scheduled time.
      </p>
      {ordered.length === 0 ? (
        <p className="muted">Nothing scheduled yet.</p>
      ) : (
        <table className="sched-posts">
          <thead>
            <tr>
              <th>Video</th>
              <th>Caption</th>
              <th>Publish at</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordered.map((post) => (
              <tr key={post.id}>
                <td className="sched-post-name" title={post.videoPath}>
                  {post.fileName}
                </td>
                <td className="sched-post-caption" title={post.caption}>
                  {post.caption}
                </td>
                <td>{formatTime(post.publishAt)}</td>
                <td>
                  <span className={`sched-chip chip-${post.status}`} title={post.error}>
                    {STATUS_LABELS[post.status]}
                  </span>
                  {post.status === 'failed' && post.error && (
                    <div className="sched-post-error">{post.error}</div>
                  )}
                </td>
                <td className="sched-post-actions">
                  {post.status === 'scheduled' && (
                    <button onClick={() => run(() => cancelPost(post.id))}>Cancel</button>
                  )}
                  {(post.status === 'failed' || post.status === 'cancelled') && (
                    <button onClick={() => run(() => retryPost(post.id))}>Retry</button>
                  )}
                  {post.status !== 'uploading' && post.status !== 'scheduled' && (
                    <button onClick={() => run(() => removePost(post.id))}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
