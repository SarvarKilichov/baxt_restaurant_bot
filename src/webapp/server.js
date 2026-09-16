import path from 'node:path';
import express from 'express';
import config from '../config/default.js';
import { telegramAuth } from './auth.middleware.js';
import { createApiRouter } from './api.routes.js';

// Веб-сервер для Mini App: отдаёт собранное React-приложение и API для него
export function createWebApp(botApi, webhook = null) {
  const app = express();
  app.disable('x-powered-by');

  // Проверка «сервис жив» — её использует хостинг и внешний пинг, чтобы сервис не засыпал
  app.get('/health', (req, res) => res.json({ ok: true }));

  // На хостинге Telegram присылает сообщения сюда (вместо постоянного опроса)
  if (webhook) app.use(webhook.path, express.json(), webhook.handler);

  app.use('/assets/restaurant', express.static(path.join(config.restaurantDir, 'images')));
  app.use('/api', telegramAuth, createApiRouter(botApi));
  app.use(express.static(path.join(config.rootDir, 'miniapp', 'dist')));

  return app;
}

export function startWebServer(botApi, options = {}) {
  const { port = config.webapp.port, webhook = null } = typeof options === 'number' ? { port: options } : options;
  const app = createWebApp(botApi, webhook);
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}
