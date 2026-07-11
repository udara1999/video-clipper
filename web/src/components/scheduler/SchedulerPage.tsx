import { useState } from 'react';
import { TikTokScheduler } from './TikTokScheduler';

const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok', available: true },
  { id: 'facebook', label: 'Facebook', available: false },
  { id: 'youtube', label: 'YouTube', available: false },
] as const;

type PlatformId = (typeof PLATFORMS)[number]['id'];

export function SchedulerPage() {
  const [platform, setPlatform] = useState<PlatformId>('tiktok');

  return (
    <div className="sched-page">
      <nav className="sched-tabs" role="tablist" aria-label="Platforms">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={platform === p.id}
            className={`sched-tab ${platform === p.id ? 'active' : ''}`}
            disabled={!p.available}
            onClick={() => setPlatform(p.id)}
          >
            {p.label}
            {!p.available && <span className="sched-soon">soon</span>}
          </button>
        ))}
      </nav>
      {platform === 'tiktok' && <TikTokScheduler />}
    </div>
  );
}
