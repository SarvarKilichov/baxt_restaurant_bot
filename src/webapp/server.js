import path from 'node:path';
import express from 'express';
import config from '../config/default.js';
import { telegramAuth } from './auth.middleware.js';
import { createApiRouter } from './api.routes.js';

// Веб-сервер для Mini App: отдаёт собранное React-приложение и API для него
export function createWebApp(botApi) {
  const app = express();
  app.disable('x-powered-by');

  app.use('/assets/restaurant', express.static(path.join(config.restaurantDir, 'images')));
  app.use('/api', telegramAuth, createApiRouter(botApi));
  app.use(express.static(path.join(config.rootDir, 'miniapp', 'dist')));

  return app;
}

export function startWebServer(botApi, port = config.webapp.port) {
  const app = createWebApp(botApi);
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}
