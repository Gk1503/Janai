import express from 'express';
import { fileURLToPath } from 'node:url';
import { dashboard, publicApi, device } from './routes.js';
import { ApiError, requeueStale } from './messages.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', dashboard);
  app.use('/v1', publicApi);
  app.use('/device', device);
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4000;
  setInterval(requeueStale, 60_000).unref();
  createApp().listen(port, () => console.log(`SMS gateway listening on http://localhost:${port}`));
}
