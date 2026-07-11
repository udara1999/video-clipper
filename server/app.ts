import express from 'express';
import { fileURLToPath } from 'node:url';
import { dialogRouter } from './dialogs';
import { videoRouter } from './video';
import { exportRouter } from './export';
import { createSchedulerRouter } from './scheduler/router';
import { SchedulerStore } from './scheduler/store';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

export function createApp(schedulerStore: SchedulerStore = new SchedulerStore()) {
  const app = express();
  // Vertical exports upload baked PNGs as base64 data URLs (a few MB each).
  app.use(express.json({ limit: '100mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(dialogRouter);
  app.use(videoRouter);
  app.use(exportRouter);
  app.use(createSchedulerRouter(schedulerStore));
  app.use(express.static(distDir));
  return app;
}
