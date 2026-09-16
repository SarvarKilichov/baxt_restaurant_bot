import crypto from 'node:crypto';
import { GrammyError, webhookCallback } from 'grammy';
import { run } from '@grammyjs/runner';
import config, { assertConfig } from './config/default.js';
import { RestaurantDataError } from './core/restaurant.js';
import { miniApp } from './core/miniapp.js';
import { createBot } from './core/bot.js';
import { checkDatabase, prisma } from './database/connection.js';
import { loadSettings } from './models/Setting.js';
import { isAiEnabled } from './services/ai.service.js';
import { loadRestaurant, setupBotProfile } from './services/restaurant.service.js';
import { startWebServer } from './webapp/server.js';
import { startMiniAppTunnel } from './services/tunnel.service.js';
import { log } from './utils/logger.js';

const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'];

async function main() {
  assertConfig();

  log.info('Загружаю данные ресторана и подключаюсь к базе…');
  await checkDatabase();
  const menu = await loadRestaurant();
  await loadSettings();
  log.info(
    `Меню — категорий: ${menu.categories}, блюд: ${menu.products}` +
      (menu.created || menu.updated || menu.hidden
        ? ` (добавлено ${menu.created}, изменено ${menu.updated}, скрыто ${menu.hidden})`
        : ''),
  );

  const bot = createBot();
  try {
    await bot.init();
  } catch (error) {
    if (error instanceof GrammyError && error.error_code === 401) {
      throw new Error('Неверный BOT_TOKEN — скопируйте токен из @BotFather в файл .env заново');
    }
    throw error;
  }

  // На хостинге (Render) Telegram сам присылает сообщения на наш адрес — webhook.
  // На своём компьютере бот забирает сообщения сам — long polling.
  const publicUrl = config.webapp.publicUrl;
  let webServer;

  if (publicUrl) {
    const secret = crypto.createHash('sha256').update(config.botToken).digest('hex').slice(0, 32);
    const webhookPath = `/telegram/${secret}`;
    webServer = await startWebServer(bot.api, {
      webhook: { path: webhookPath, handler: webhookCallback(bot, 'express', { secretToken: secret }) },
    });
    await bot.api.setWebhook(`${publicUrl}${webhookPath}`, {
      secret_token: secret,
      allowed_updates: ALLOWED_UPDATES,
    });

    // Бесплатный хостинг усыпляет сервис без запросов — раз в 10 минут будим сами себя
    const keepAlive = setInterval(
      () => {
        fetch(`${publicUrl}/health`).catch(() => {});
      },
      10 * 60 * 1000,
    );
    keepAlive.unref();
  } else {
    await bot.api.deleteWebhook();
    try {
      await bot.api.getUpdates({ limit: 1, timeout: 0 });
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 409) {
        throw new Error('Этот бот уже запущен в другом окне или на другом компьютере. Остановите его и запустите снова.');
      }
      throw error;
    }
    webServer = await startWebServer(bot.api);
  }
  log.info(`Веб-сервер Mini App слушает порт ${config.webapp.port}`);
  miniApp.url = await startMiniAppTunnel(config.webapp.port);

  setupBotProfile(bot.api, miniApp.url).catch(() => {});

  const runner = publicUrl ? null : run(bot, { runner: { fetch: { allowed_updates: ALLOWED_UPDATES } } });

  log.info(`✅ Бот @${bot.botInfo.username} запущен: https://t.me/${bot.botInfo.username}`);
  if (miniApp.url) {
    log.info(`🍽 Mini App доступен по адресу: ${miniApp.url}`);
  } else {
    log.warn(
      'Mini App недоступен — не задан ни MINI_APP_URL, ни NGROK_AUTHTOKEN в .env. Кнопка «Меню» в боте показана не будет.',
    );
  }
  if (!config.adminIds.length && !config.ordersChatId) {
    log.warn('Администратор не указан — заказы никуда не придут. Отправьте боту /id и впишите свой ID в ADMIN_IDS в файле .env');
  }
  if (!isAiEnabled()) {
    log.warn('AI-помощник выключен: в .env нет ANTHROPIC_API_KEY. Всё остальное работает.');
  }
  log.info('Чтобы остановить бота, нажмите Ctrl+C');

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log.info('Останавливаю бота…');
    if (runner?.isRunning()) await runner.stop();
    await new Promise((resolve) => webServer.close(resolve));
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch(async (error) => {
  if (error instanceof RestaurantDataError) log.error(error.message);
  else log.error(error?.message ?? error);
  if (process.env.LOG_LEVEL === 'debug') console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
