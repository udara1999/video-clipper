import express from 'express';
import { fileURLToPath } from 'node:url';
import { dialogRouter } from './dialogs';
import { videoRouter } from './video';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(dialogRouter);
  app.use(videoRouter);
  app.use(express.static(distDir));
  return app;
}
